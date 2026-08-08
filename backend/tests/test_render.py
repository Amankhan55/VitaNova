import pytest

from app.services import template_registry
from app.services.seed import demo_resume_data

TEMPLATE_IDS = [meta.id for meta in template_registry.load_registry(force=True).values()]


def draft(template_id: str) -> dict:
    data = demo_resume_data()
    return {
        "template_id": template_id,
        "theme": {"accent": "#0D9488", "font_scale": 1.0, "page_size": "A4", "density": "normal"},
        "basics": data.basics.model_dump(),
        "sections": [section.model_dump() for section in data.sections],
    }


def test_all_nine_designs_are_registered(client):
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
    html = client.post("/api/v1/render", json=payload).text
    assert "Professional Summary" not in html
    assert "Projects" not in html


def test_hidden_sections_are_left_out(client):
    payload = draft("classic-ats")
    for section in payload["sections"]:
        if section["type"] == "languages":
            section["visible"] = False
    html = client.post("/api/v1/render", json=payload).text
    assert "Languages" not in html


def test_accent_is_restricted_to_a_hex_colour(client):
    """The accent lands inside a <style> block, so anything else must be dropped."""
    payload = draft("modern-professional")
    payload["theme"]["accent"] = "red;} body{display:none} .x{color:red"
    html = client.post("/api/v1/render", json=payload).text
    assert "display:none" not in html
    assert "--vn-accent:#2563EB" in html
