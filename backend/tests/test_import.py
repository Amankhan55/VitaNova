"""Resume import.

Everything here runs offline. The two pure stages -- pulling JSON out of the
model's reply and shaping it into a ResumeData -- are where the interesting
failures live, and neither needs Gemini. The one Gemini-dependent path we do
cover is the one that must never reach it: an unconfigured server.
"""

import io

import pytest

from app.core.config import settings
from app.services import import_service
from app.services.import_service import BadDocument, UpstreamUnavailable
from tests.conftest import api_error


# --------------------------------------------------------------------------- #
# _extract_json
# --------------------------------------------------------------------------- #


def test_extract_json_reads_a_bare_object():
    assert import_service._extract_json('{"basics": {"full_name": "Ada"}}') == {
        "basics": {"full_name": "Ada"}
    }


@pytest.mark.parametrize(
    "fenced",
    [
        '```json\n{"a": 1}\n```',
        '```\n{"a": 1}\n```',
        'Here you go:\n```json\n{"a": 1}\n```\nHope that helps!',
    ],
)
def test_extract_json_survives_markdown_fences(fenced):
    """The prompt forbids fences; models add them anyway."""
    assert import_service._extract_json(fenced) == {"a": 1}


def test_extract_json_rejects_prose_as_a_bad_document():
    with pytest.raises(BadDocument):
        import_service._extract_json("I'm sorry, I can't parse that resume.")


def test_extract_json_rejects_a_json_array():
    """Valid JSON, wrong shape -- this used to escape as an AttributeError 500."""
    with pytest.raises(BadDocument):
        import_service._extract_json('[{"basics": {}}]')


# --------------------------------------------------------------------------- #
# _to_resume_data
# --------------------------------------------------------------------------- #


def test_to_resume_data_builds_only_the_sections_present():
    data = import_service._to_resume_data(
        {
            "basics": {"full_name": "Ada Lovelace", "email": "ada@example.com"},
            "summary": "First programmer.",
            "experience": [{"role": "Analyst", "organization": "AEC", "current": True}],
        }
    )
    assert data.basics.full_name == "Ada Lovelace"
    assert [section.type for section in data.sections] == ["summary", "experience"]
    # "current" wins over any end date the model may also have supplied.
    assert data.sections[1].items[0].current is True
    assert data.sections[1].items[0].end == ""


def test_to_resume_data_accepts_an_empty_object():
    data = import_service._to_resume_data({})
    assert data.basics.full_name == ""
    assert data.sections == []


def test_to_resume_data_normalises_an_unknown_link_icon():
    data = import_service._to_resume_data(
        {"basics": {"links": [{"label": "x.com/ada", "url": "…", "icon": "twitter"}]}}
    )
    assert data.basics.links[0].icon == "link"


@pytest.mark.parametrize(
    "malformed",
    [
        {"basics": "Ada Lovelace"},               # string where an object belongs
        {"experience": [{"bullets": "one bullet"}]},  # string where a list belongs
        {"skills": [None]},                        # null item
        {"basics": {"links": ["linkedin.com"]}},   # string where a link object belongs
    ],
)
def test_to_resume_data_reports_wrong_shapes_as_bad_documents(malformed):
    """These are the model's fault, not the server's: 422, never a 500."""
    with pytest.raises(BadDocument):
        import_service._to_resume_data(malformed)


# --------------------------------------------------------------------------- #
# extract_text
# --------------------------------------------------------------------------- #


def test_extract_text_rejects_an_oversized_pdf_before_parsing():
    with pytest.raises(BadDocument, match="too large"):
        import_service.extract_text(b"%PDF-" + b"\0" * import_service.MAX_PDF_SIZE)


def test_extract_text_rejects_a_file_that_is_not_a_pdf():
    with pytest.raises(BadDocument, match="Could not read"):
        import_service.extract_text(b"this is plainly not a pdf")


def test_extract_text_reads_a_real_rendered_resume():
    """Round-trips our own output: render a sample to PDF, then read it back."""
    from app.models.resume import Theme
    from app.services import render_service
    from app.services.seed import demo_resume_data

    pdf = render_service._html_to_pdf(
        render_service.render_html(demo_resume_data(), "classic-ats", Theme())
    )
    text = import_service.extract_text(pdf)
    assert "ALEX MORGAN" in text.upper()


# --------------------------------------------------------------------------- #
# parse_resume_text — the one guard that must hold without a key
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_parse_resume_text_without_a_key_is_an_upstream_failure(monkeypatch):
    """A missing key is the operator's problem. Blaming the upload with a 4xx
    would send the user off looking for a better PDF."""
    monkeypatch.setattr(settings, "gemini_api_key", "")
    with pytest.raises(UpstreamUnavailable, match="not configured"):
        await import_service.parse_resume_text("Some resume text, long enough to pass.")


# --------------------------------------------------------------------------- #
# Retry and failure classification
#
# Gemini is faked here rather than called: these tests are about what we do with
# each kind of failure, and a real 503 cannot be summoned on demand. The
# `fake_gemini` fixture and `api_error` helper live in conftest, because
# tests/test_ai.py scripts the same client.
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_transient_failure_is_retried_and_can_succeed(fake_gemini):
    """The 503 'high demand' that a free-tier key hits regularly."""
    client = fake_gemini(api_error(503), '{"basics": {"full_name": "Ada"}}')
    data = await import_service.parse_resume_text("Long enough resume text here.")
    assert data.basics.full_name == "Ada"
    assert client.calls == 2


@pytest.mark.asyncio
async def test_a_persistent_transient_failure_gives_up_as_upstream(fake_gemini):
    client = fake_gemini(api_error(503), api_error(503))
    with pytest.raises(UpstreamUnavailable, match="busy"):
        await import_service.parse_resume_text("Long enough resume text here.")
    assert client.calls == import_service.MAX_ATTEMPTS


@pytest.mark.asyncio
async def test_a_rejected_request_is_not_retried(fake_gemini):
    """A 400 is our key or our prompt. Retrying it just wastes the user's time."""
    client = fake_gemini(api_error(400))
    with pytest.raises(UpstreamUnavailable):
        await import_service.parse_resume_text("Long enough resume text here.")
    assert client.calls == 1


@pytest.mark.asyncio
async def test_an_empty_response_is_retried(fake_gemini):
    client = fake_gemini("", '{"basics": {"full_name": "Grace"}}')
    data = await import_service.parse_resume_text("Long enough resume text here.")
    assert data.basics.full_name == "Grace"
    assert client.calls == 2


@pytest.mark.asyncio
async def test_unparseable_output_is_the_documents_problem_not_the_services(fake_gemini):
    """Gemini answered, so it is up; the answer was simply unusable -- 422."""
    fake_gemini("I could not find a resume in that text.")
    with pytest.raises(BadDocument):
        await import_service.parse_resume_text("Long enough resume text here.")


# --------------------------------------------------------------------------- #
# The endpoint
# --------------------------------------------------------------------------- #


def test_import_rejects_a_non_pdf_upload(client, account):
    response = client.post(
        "/api/v1/resumes/import",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
        headers=account["headers"],
    )
    assert response.status_code == 422
    assert "Only PDF files" in response.json()["detail"]


def test_import_rejects_an_oversized_upload_with_413(client, account):
    """Refused while streaming, so the body is never fully buffered."""
    oversized = b"%PDF-1.4\n" + b"\0" * (import_service.MAX_PDF_SIZE + 1024)
    response = client.post(
        "/api/v1/resumes/import",
        files={"file": ("huge.pdf", io.BytesIO(oversized), "application/pdf")},
        headers=account["headers"],
    )
    assert response.status_code == 413
    assert "too large" in response.json()["detail"]


def test_import_reports_an_unconfigured_server_as_503(client, account, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "")

    from app.models.resume import Theme
    from app.services import render_service
    from app.services.seed import demo_resume_data

    pdf = render_service._html_to_pdf(
        render_service.render_html(demo_resume_data(), "classic-ats", Theme())
    )
    response = client.post(
        "/api/v1/resumes/import",
        files={"file": ("resume.pdf", io.BytesIO(pdf), "application/pdf")},
        headers=account["headers"],
    )
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]
