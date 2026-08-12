import re

import pytest

from app.services import template_registry
from app.services.seed import demo_resume_data

_REGISTRY = template_registry.load_registry(force=True).values()
TEMPLATE_IDS = [meta.id for meta in _REGISTRY]
ATS_SAFE_IDS = [meta.id for meta in _REGISTRY if meta.ats_safe]


def body_of(html: str) -> str:
    """The rendered document without its inlined stylesheet.

    Every design's CSS is inlined into the same file as the content, so a naive
    `"Languages" not in html` also matches the word in a comment or a selector.
    Assertions about what the document *says* belong here; assertions about how
    it looks belong against the full string.
    """
    return re.sub(r"<style>.*?</style>", "", html, flags=re.S)


def draft(template_id: str) -> dict:
    data = demo_resume_data()
    return {
        "template_id": template_id,
        "theme": {"accent": "#0D9488", "font_scale": 1.0, "page_size": "A4", "density": "normal"},
        "basics": data.basics.model_dump(),
        "sections": [section.model_dump() for section in data.sections],
    }


def test_every_design_is_registered(client):
    listed = {meta["id"] for meta in client.get("/api/v1/templates").json()}
    assert listed == {
        "modern-professional",
        "classic-ats",
        "timeless-elegant",
        "centered-mono",
        "minimalist-swiss",
        "creative-split",
        "tech-compact",
        "executive-bar",
        "nordic-clean",
        "harvard-classic",
        "banner-bold",
        "compact-dense",
        "serif-book",
        "section-bands",
        "quiet-professional",
    }


@pytest.mark.parametrize("template_id", TEMPLATE_IDS)
def test_every_template_renders_html(client, template_id):
    response = client.post("/api/v1/render", json=draft(template_id))
    assert response.status_code == 200
    html = response.text

    assert html.startswith("<!DOCTYPE html>")
    assert "Alex Morgan" in html
    # Self-contained: the preview iframe and WeasyPrint both need zero external
    # fetches, so there must be no stylesheet or script references at all.
    assert "<style>" in html
    assert "<link" not in html
    assert "<script" not in html


@pytest.mark.parametrize("template_id", ATS_SAFE_IDS)
def test_ats_safe_headings_carry_no_decoration(client, template_id):
    """A design claiming ats_safe must not put decoration into extractable text.

    Regression guard: tech-compact used to write its "// " prefix straight into
    the heading, so a parser read "// Professional Summary" and could fail to
    recognise the section at all. Decoration belongs in ::before, which is not
    part of the document's text. Any design that reintroduces the mistake fails
    here rather than silently shipping a broken ATS promise.
    """
    body = body_of(client.post("/api/v1/render", json=draft(template_id)).text)
    titles = {section.title for section in demo_resume_data().sections}

    headings = re.findall(r"<h2[^>]*>(.*?)</h2>", body, re.S)
    assert headings, f"{template_id} rendered no section headings at all"
    for heading in headings:
        text = re.sub(r"<[^>]+>", "", heading).strip()
        assert text in titles, (
            f"{template_id} heading {text!r} is not a bare section title — "
            "move the decoration into CSS"
        )


@pytest.mark.parametrize("template_id", ATS_SAFE_IDS)
def test_ats_safe_designs_keep_prose_in_one_column(client, template_id):
    """Nothing a parser reads as prose may be split across table cells.

    .vn-cols is the project's two-column primitive (display:table). A parser
    walks cells one after another, so a paragraph or a job entry laid across two
    of them comes out interleaved and unreadable.

    Skills are the one exception, and centered-mono relies on it: that design
    puts whole skill groups in each cell and fills the left column top-to-bottom
    before starting the right, so extraction yields every left-hand group intact
    and then every right-hand one. No single "Label: values" pair is ever split,
    which is the property that actually matters. Prose sections get no such
    latitude.
    """
    meta = template_registry.get_template(template_id)
    assert meta.sidebar_sections == [], f"{template_id} claims ats_safe but declares a sidebar"

    body = body_of(client.post("/api/v1/render", json=draft(template_id)).text)
    prose_only = re.sub(
        r'<section class="[^"]*vn-section--skills[^"]*">.*?</section>', "", body, flags=re.S
    )
    assert "vn-cols" not in prose_only, (
        f"{template_id} lays prose out in columns; a parser will interleave it"
    )


@pytest.mark.parametrize("template_id", TEMPLATE_IDS)
def test_every_template_renders_a_pdf(client, template_id):
    response = client.post("/api/v1/render/pdf", json=draft(template_id))
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-")
    assert len(response.content) > 3_000


def test_preview_and_export_render_the_same_document(client, account):
    """The core guarantee: what the editor shows is what the PDF is made from."""
    resume = client.post(
        "/api/v1/resumes",
        json={"title": "Parity", "template_id": "classic-ats"},
        headers=account["headers"],
    ).json()

    client.patch(
        f"/api/v1/resumes/{resume['id']}",
        json={"basics": {**resume["basics"], "full_name": "Parity Check"}},
        headers=account["headers"],
    )
    saved = client.get(f"/api/v1/resumes/{resume['id']}", headers=account["headers"]).json()

    from_preview = client.get(
        f"/api/v1/resumes/{resume['id']}/preview", headers=account["headers"]
    ).text
    from_draft = client.post(
        "/api/v1/render",
        json={
            "template_id": saved["template_id"],
            "theme": saved["theme"],
            "basics": saved["basics"],
            "sections": saved["sections"],
        },
    ).text

    assert from_preview == from_draft


def test_empty_sections_do_not_render_a_stray_heading(client):
    payload = draft("classic-ats")
    payload["sections"] = [
        {"id": "a", "type": "summary", "title": "Professional Summary", "visible": True, "content": ""},
        {"id": "b", "type": "projects", "title": "Projects", "visible": True, "items": []},
    ]
    body = body_of(client.post("/api/v1/render", json=payload).text)
    assert "Professional Summary" not in body
    assert "Projects" not in body


def test_hidden_sections_are_left_out(client):
    payload = draft("classic-ats")
    for section in payload["sections"]:
        if section["type"] == "languages":
            section["visible"] = False
    body = body_of(client.post("/api/v1/render", json=payload).text)
    assert "Languages" not in body


def test_accent_is_restricted_to_a_hex_colour(client):
    """The accent lands inside a <style> block, so anything else must be dropped."""
    payload = draft("modern-professional")
    payload["theme"]["accent"] = "red;} body{display:none} .x{color:red"
    html = client.post("/api/v1/render", json=payload).text
    assert "display:none" not in html
    assert "--vn-accent:#2563EB" in html
