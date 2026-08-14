"""The guards that keep an unauthenticated caller from taking the API down.

/render and /render/pdf take no credentials by design, and PDF layout is the
most expensive thing this service does. Three separate bounds stand between
those two facts, and each is tested here on its own:

  * field caps, so no single value is unbounded;
  * a body cap, so no *number* of bounded values adds up to something huge;
  * a concurrency bound, so the renders that do get through cannot run forty at
    a time on a 512 MB instance.
"""

import json

import pytest

from app.core import rate_limit
from app.core.config import settings
from app.models import resume as resume_models
from tests.conftest import register

RENDER = "/api/v1/render"


def minimal(**overrides) -> dict:
    payload = {"basics": {"full_name": "Test Person"}, "sections": [],
               "template_id": "classic-ats"}
    payload.update(overrides)
    return payload


# --------------------------------------------------------------------------- #
# Field caps
# --------------------------------------------------------------------------- #


def test_an_overlong_field_is_refused(client):
    payload = minimal(basics={"full_name": "x" * 201})
    assert client.post(RENDER, json=payload).status_code == 422


def test_an_overlong_summary_is_refused(client):
    payload = minimal(sections=[{
        "id": "s", "type": "summary", "title": "Summary", "visible": True,
        "content": "x" * 5001,
    }])
    assert client.post(RENDER, json=payload).status_code == 422


def test_too_many_sections_are_refused(client):
    section = {"type": "summary", "title": "S", "visible": True, "content": "hi"}
    payload = minimal(sections=[dict(section, id=f"s{i}")
                                for i in range(resume_models.MAX_SECTIONS + 1)])
    assert client.post(RENDER, json=payload).status_code == 422


def test_too_many_items_in_a_section_are_refused(client):
    payload = minimal(sections=[{
        "id": "s", "type": "experience", "title": "Experience", "visible": True,
        "items": [{"id": f"i{i}", "role": "Engineer"}
                  for i in range(resume_models.MAX_ITEMS_PER_SECTION + 1)],
    }])
    assert client.post(RENDER, json=payload).status_code == 422


def test_too_many_bullets_are_refused(client):
    payload = minimal(sections=[{
        "id": "s", "type": "experience", "title": "Experience", "visible": True,
        "items": [{"id": "i", "role": "Engineer",
                   "bullets": ["did a thing"] * (resume_models.MAX_BULLETS + 1)}],
    }])
    assert client.post(RENDER, json=payload).status_code == 422


def test_a_realistic_resume_is_comfortably_inside_every_cap(client):
    """The caps must never be something a real document can trip over.

    The demo resume is the most complete one this project ships -- every section
    populated. If it ever fails to render, a cap has been set below real use.
    """
    from app.services.seed import demo_resume_data

    data = demo_resume_data()
    response = client.post(RENDER, json={
        "template_id": "modern-professional",
        "basics": data.basics.model_dump(),
        "sections": [s.model_dump() for s in data.sections],
    })
    assert response.status_code == 200, response.text


# --------------------------------------------------------------------------- #
# Body cap
# --------------------------------------------------------------------------- #


def test_an_oversized_body_is_refused_before_it_is_parsed(client):
    """413, not 422: the point is that it is turned away on size alone, without
    the body ever being buffered or validated."""
    blob = "x" * (settings.max_json_body_bytes + 1024)
    response = client.post(RENDER, content=json.dumps({"junk": blob}),
                           headers={"content-type": "application/json"})
    assert response.status_code == 413
    assert "too large" in response.json()["detail"].lower()


def test_the_body_cap_covers_saved_resumes_too(client, account):
    """Otherwise the cap is trivially bypassed: store an enormous resume, then
    ask for its PDF, and the export path renders it with no body limit in sight."""
    blob = "x" * (settings.max_json_body_bytes + 1024)
    response = client.post("/api/v1/resumes", content=json.dumps({"title": blob}),
                           headers={**account["headers"],
                                    "content-type": "application/json"})
    assert response.status_code == 413


def test_a_chunked_body_with_no_declared_length_is_still_capped(client):
    """The Content-Length fast path is not the only check -- a client that
    declares nothing must still be counted as its bytes arrive."""
    blob = "x" * (settings.max_json_body_bytes + 1024)
    body = json.dumps({"junk": blob}).encode()

    def chunks():
        for i in range(0, len(body), 16 * 1024):
            yield body[i : i + 16 * 1024]

    response = client.post(RENDER, content=chunks(),
                           headers={"content-type": "application/json"})
    assert response.status_code == 413


def test_an_ordinary_render_is_unaffected(client):
    assert client.post(RENDER, json=minimal()).status_code == 200


def test_the_pdf_import_endpoint_keeps_its_own_larger_cap(client, account):
    """It is under /api/v1/resumes but carries a PDF, not resume JSON, so the
    JSON cap must not apply to it. A 413 here would mean the exemption broke."""
    from app.services import import_service

    assert import_service.MAX_PDF_SIZE > settings.max_json_body_bytes
    payload = b"%PDF-1.4\n" + b"0" * (settings.max_json_body_bytes + 1024)
    response = client.post(
        "/api/v1/resumes/import",
        files={"file": ("cv.pdf", payload, "application/pdf")},
        headers=account["headers"],
    )
    # Rejected for being an unreadable PDF, not for its size.
    assert response.status_code != 413


# --------------------------------------------------------------------------- #
# PDF concurrency
# --------------------------------------------------------------------------- #


def test_pdf_rendering_is_bounded_to_the_configured_slots():
    from app.services import render_service

    assert render_service._pdf_slots.value == settings.max_concurrent_pdf_renders
    assert settings.max_concurrent_pdf_renders < 40, (
        "anyio's default thread limiter is 40; a bound at or above it does nothing"
    )


@pytest.mark.asyncio
async def test_no_more_than_the_slot_count_render_at_once(monkeypatch):
    """Drives the real semaphore with a stand-in for WeasyPrint, so the assertion
    is about the concurrency control rather than about PDF output."""
    import asyncio
    import threading
    import time

    from app.models.resume import ResumeData
    from app.services import render_service

    lock = threading.Lock()
    live = 0
    peak = 0

    def fake_pdf(html: str) -> bytes:
        nonlocal live, peak
        with lock:
            live += 1
            peak = max(peak, live)
        try:
            time.sleep(0.05)  # long enough that overlap is observable
            return b"%PDF-"
        finally:
            with lock:
                live -= 1

    monkeypatch.setattr(render_service, "_html_to_pdf", fake_pdf)
    await asyncio.gather(*(
        render_service.render_pdf(ResumeData(), "classic-ats") for _ in range(12)
    ))

    assert peak <= settings.max_concurrent_pdf_renders, (
        f"{peak} renders ran at once, limit is {settings.max_concurrent_pdf_renders}"
    )


# --------------------------------------------------------------------------- #
# Rate limits
#
# The suite disables these globally (see conftest), so each test here turns them
# back on and clears the counters it is about to use.
# --------------------------------------------------------------------------- #


@pytest.fixture
def limits_on(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    rate_limit.reset_all()
    yield
    rate_limit.reset_all()


def test_repeated_bad_passwords_are_eventually_refused(client, account, limits_on):
    attempts = settings.login_max_attempts
    for _ in range(attempts):
        response = client.post("/api/v1/auth/login",
                               json={"email": account["email"], "password": "wrong"})
        assert response.status_code == 401

    blocked = client.post("/api/v1/auth/login",
                          json={"email": account["email"], "password": "wrong"})
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers


def test_the_login_limit_is_per_account(client, limits_on):
    """One user being attacked must never lock anybody else out -- which is the
    failure mode of limiting by IP when every request arrives via one proxy."""
    victim = register(client)
    bystander = register(client)

    for _ in range(settings.login_max_attempts + 1):
        client.post("/api/v1/auth/login",
                    json={"email": victim["email"], "password": "wrong"})

    assert client.post("/api/v1/auth/login",
                       json={"email": victim["email"], "password": "wrong"}
                       ).status_code == 429
    ok = client.post("/api/v1/auth/login",
                     json={"email": bystander["email"], "password": bystander["password"]})
    assert ok.status_code == 200, "an unrelated account was caught by another's limit"


def test_signing_in_successfully_clears_the_budget(client, account, limits_on):
    for _ in range(settings.login_max_attempts - 1):
        client.post("/api/v1/auth/login",
                    json={"email": account["email"], "password": "wrong"})

    good = client.post("/api/v1/auth/login",
                       json={"email": account["email"], "password": account["password"]})
    assert good.status_code == 200

    # Budget reset, so a fresh run of wrong guesses is allowed again.
    for _ in range(settings.login_max_attempts - 1):
        assert client.post("/api/v1/auth/login",
                           json={"email": account["email"], "password": "wrong"}
                           ).status_code == 401


def test_password_reset_mail_is_capped_per_address(client, account, limits_on):
    for _ in range(settings.email_send_max):
        assert client.post("/api/v1/auth/forgot-password",
                           json={"email": account["email"]}).status_code == 202

    assert client.post("/api/v1/auth/forgot-password",
                       json={"email": account["email"]}).status_code == 429


def test_the_mail_limit_applies_to_addresses_with_no_account(client, limits_on):
    """Applying it only to real accounts would turn the limit into an oracle:
    429 would mean registered, 202 would mean not."""
    unknown = "nobody-here@example.com"
    for _ in range(settings.email_send_max):
        assert client.post("/api/v1/auth/forgot-password",
                           json={"email": unknown}).status_code == 202
    assert client.post("/api/v1/auth/forgot-password",
                       json={"email": unknown}).status_code == 429


def test_sign_ups_are_capped_per_client_address(client, limits_on):
    import uuid

    headers = {"X-Forwarded-For": "203.0.113.7"}
    for _ in range(settings.register_max):
        response = client.post("/api/v1/auth/register", headers=headers, json={
            "email": f"u-{uuid.uuid4().hex[:10]}@example.com",
            "password": "correct horse 42", "full_name": "T",
        })
        assert response.status_code == 201

    blocked = client.post("/api/v1/auth/register", headers=headers, json={
        "email": f"u-{uuid.uuid4().hex[:10]}@example.com",
        "password": "correct horse 42", "full_name": "T",
    })
    assert blocked.status_code == 429

    # A different client address has its own budget.
    other = client.post("/api/v1/auth/register",
                        headers={"X-Forwarded-For": "198.51.100.4"}, json={
                            "email": f"u-{uuid.uuid4().hex[:10]}@example.com",
                            "password": "correct horse 42", "full_name": "T",
                        })
    assert other.status_code == 201


def test_the_limiter_does_not_grow_without_bound(limits_on):
    """An attacker cycling through addresses must not be able to grow the
    counter map indefinitely -- that is the exhaustion this exists to prevent,
    arriving by another route."""
    limiter = rate_limit.RateLimiter(limit=5, window=0, message="nope")
    for i in range(rate_limit._SWEEP_THRESHOLD + 500):
        limiter.check(f"key-{i}")
    # A zero-second window means every entry is expired the moment it is made,
    # so the sweep should have collected nearly all of them.
    assert len(limiter._hits) <= rate_limit._SWEEP_THRESHOLD + 1
