"""User-designed templates: ownership, rendering, and the spec's guarantees."""

import re

import pytest

from app.models.custom_template import CustomTemplateSpec
from app.services import custom_template_service
from app.services.custom_css import compile_spec
from tests.conftest import register

API = "/api/v1/custom-templates"


def make(client, account, **overrides) -> dict:
    payload = {"name": "My design", **overrides}
    response = client.post(API, json=payload, headers=account["headers"])
    assert response.status_code == 201, response.text
    return response.json()


def body_of(html: str) -> str:
    """The document without its inlined stylesheet — see tests/test_render.py."""
    return re.sub(r"<style>.*?</style>", "", html, flags=re.S)


def style_of(html: str) -> str:
    return re.search(r"<style>(.*?)</style>", html, re.S).group(1)


# --------------------------------------------------------------------------- #
# CRUD and ownership
# --------------------------------------------------------------------------- #


def test_create_returns_a_qualified_template_id(client, account):
    template = make(client, account, name="Studio")
    assert template["template_id"] == f"custom:{template['id']}"
    assert template["name"] == "Studio"


def test_based_on_starts_from_a_built_in_design(client, account):
    template = make(client, account, based_on="modern-professional")
    assert template["spec"]["layout"] == "sidebar-left"
    assert template["ats_safe"] is False


def test_based_on_an_unknown_design_falls_back_to_the_default_spec(client, account):
    template = make(client, account, based_on="no-such-design")
    assert template["spec"] == CustomTemplateSpec().model_dump()


def test_another_user_cannot_read_update_render_or_delete_your_design(client):
    alice = register(client)
    bob = register(client)
    template = make(client, alice)
    path = f"{API}/{template['id']}"

    assert client.get(path, headers=bob["headers"]).status_code == 404
    assert client.patch(path, json={"name": "Taken"}, headers=bob["headers"]).status_code == 404
    assert client.get(f"{path}/sample", headers=bob["headers"]).status_code == 404
    assert client.delete(path, headers=bob["headers"]).status_code == 404
    # ...and Alice's design is untouched by any of it.
    assert client.get(path, headers=alice["headers"]).json()["name"] == "My design"


def test_list_returns_only_your_own_designs(client):
    alice = register(client)
    bob = register(client)
    make(client, alice, name="Alice design")

    listing = client.get(API, headers=bob["headers"]).json()
    assert all(item["name"] != "Alice design" for item in listing["templates"])


def test_list_carries_a_template_meta_view_for_the_gallery(client, account):
    make(client, account, name="Gallery card", accent="#B45309")
    listing = client.get(API, headers=account["headers"]).json()
    meta = next(m for m in listing["metas"] if m["name"] == "Gallery card")
    assert meta["accent"] == "#B45309"
    assert meta["id"].startswith("custom:")


def test_update_replaces_the_spec_wholesale(client, account):
    template = make(client, account)
    spec = {**template["spec"], "heading_style": "band", "layout": "sidebar-right"}
    updated = client.patch(
        f"{API}/{template['id']}", json={"spec": spec}, headers=account["headers"]
    ).json()
    assert updated["spec"]["heading_style"] == "band"
    assert updated["ats_safe"] is False


def test_an_explicit_null_does_not_overwrite_a_field(client, account):
    """None on this model means "not supplied", never a value. Storing it would
    write a document that no longer validates — which would take out the whole
    listing for that account, with no route left able to repair it."""
    template = make(client, account, name="Keeps its spec")
    response = client.patch(
        f"{API}/{template['id']}",
        json={"spec": None, "theme": None, "accent": None},
        headers=account["headers"],
    )
    assert response.status_code == 200
    assert response.json()["spec"] == template["spec"]
    # The listing still loads, which is the failure this actually guards.
    assert client.get(API, headers=account["headers"]).status_code == 200


def test_duplicate_copies_the_design_under_a_new_id(client, account):
    template = make(client, account, name="Original")
    copy = client.post(
        f"{API}/{template['id']}/duplicate", json={}, headers=account["headers"]
    ).json()
    assert copy["id"] != template["id"]
    assert copy["name"] == "Original (copy)"
    assert copy["spec"] == template["spec"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("layout", "diagonal"),
        ("sidebar_width", 90),
        ("name_size_pt", 120),
        ("body_size_pt", 2),
        ("ink", "red; } body { display:none"),
        ("paper", "url(http://evil)"),
    ],
)
def test_a_spec_outside_the_allowed_vocabulary_is_rejected(client, account, field, value):
    """The design space is closed. Nothing a user sends becomes CSS unless it is
    a value this app chose, which is what keeps the generated stylesheet safe."""
    response = client.post(
        API, json={"name": "Bad", "spec": {field: value}}, headers=account["headers"]
    )
    assert response.status_code == 422, response.text


def test_the_design_limit_is_enforced(client, account, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "max_custom_templates_per_user", 1)
    make(client, account, name="Only one")
    response = client.post(API, json={"name": "Second"}, headers=account["headers"])
    assert response.status_code == 409


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #


def test_preview_renders_an_unsaved_spec(client, account):
    """A design with no id yet still previews — this is what the editor calls on
    every change, before anything has been saved."""
    response = client.post(
        f"{API}/preview",
        json={"spec": {"layout": "sidebar-left", "heading_style": "band"}},
        headers=account["headers"],
    )
    assert response.status_code == 200
    assert "Alex Morgan" in body_of(response.text)


def test_a_sidebar_contact_block_labels_links_readably(client, account):
    """`Link.icon` names an icon, not a heading — printed raw it puts "LINKEDIN"
    and, worse, "LINK" on the page above the address."""
    template = make(client, account)
    client.patch(
        f"{API}/{template['id']}",
        json={"spec": {"layout": "sidebar-left", "contacts_in_sidebar": True}},
        headers=account["headers"],
    )
    body = body_of(client.get(f"{API}/{template['id']}/sample", headers=account["headers"]).text)
    assert "LinkedIn" in body and "GitHub" in body
    assert "linkedin.com/in/alex-morgan-dev" in body


def test_sample_renders_the_saved_design_with_demo_content(client, account):
    template = make(client, account, based_on="harvard-classic")
    html = client.get(f"{API}/{template['id']}/sample", headers=account["headers"]).text
    assert "Alex Morgan" in body_of(html)
    assert 'class="vn-doc vn-custom"' in html


def test_a_resume_can_be_set_in_a_custom_design_and_exports_in_it(client, account):
    template = make(client, account, based_on="serif-book")
    resume = client.post(
        "/api/v1/resumes",
        json={"title": "CV", "template_id": template["template_id"]},
        headers=account["headers"],
    ).json()
    assert resume["template_id"] == template["template_id"]

    preview = client.get(
        f"/api/v1/resumes/{resume['id']}/preview", headers=account["headers"]
    )
    assert 'class="vn-doc vn-custom"' in preview.text

    pdf = client.get(f"/api/v1/resumes/{resume['id']}/export/pdf", headers=account["headers"])
    assert pdf.status_code == 200
    assert pdf.content[:4] == b"%PDF"
    # The id is opaque and contains a colon; neither belongs in a filename.
    assert ":" not in pdf.headers["content-disposition"].split("filename=")[1]


def test_a_new_resume_adopts_the_whole_theme_the_design_was_authored_with(client, account):
    """Page size and spacing are part of what the author approved in the builder,
    so taking only the colour would hand them a different page from the one they
    signed off on."""
    template = make(client, account, accent="#B45309")
    client.patch(
        f"{API}/{template['id']}",
        json={"theme": {"accent": "#111111", "font_scale": 1.15,
                        "page_size": "Letter", "density": "relaxed"}},
        headers=account["headers"],
    )
    resume = client.post(
        "/api/v1/resumes",
        json={"title": "CV", "template_id": template["template_id"]},
        headers=account["headers"],
    ).json()

    assert resume["theme"]["page_size"] == "Letter"
    assert resume["theme"]["density"] == "relaxed"
    assert resume["theme"]["font_scale"] == 1.15
    # The design's own accent wins over whatever the stored theme happens to
    # carry — the accent picker is the one place that colour is chosen.
    assert resume["theme"]["accent"] == "#B45309"


def test_a_resume_cannot_be_set_in_someone_elses_design(client):
    alice = register(client)
    bob = register(client)
    template = make(client, alice)

    resume = client.post(
        "/api/v1/resumes",
        json={"title": "Borrowed", "template_id": template["template_id"]},
        headers=bob["headers"],
    ).json()
    # Silently falls back to the default design rather than rendering Alice's.
    assert resume["template_id"] == "modern-professional"


def test_deleting_a_design_moves_its_resumes_to_the_default(client, account):
    template = make(client, account)
    resume = client.post(
        "/api/v1/resumes",
        json={"title": "Orphan", "template_id": template["template_id"]},
        headers=account["headers"],
    ).json()

    response = client.delete(f"{API}/{template['id']}", headers=account["headers"])
    assert response.status_code == 200
    assert response.json()["resumes_reassigned"] == 1

    after = client.get(f"/api/v1/resumes/{resume['id']}", headers=account["headers"]).json()
    assert after["template_id"] == "modern-professional"


def test_draft_render_uses_an_inline_spec(client):
    """The draft endpoint is unauthenticated and stateless, so the editor sends
    the design with the content rather than having the server look it up."""
    response = client.post(
        "/api/v1/render",
        json={
            "template_id": "custom:whatever",
            "theme": {"accent": "#0D9488", "font_scale": 1.0,
                      "page_size": "A4", "density": "normal"},
            "basics": {"full_name": "Dana Reed"},
            "sections": [{"type": "summary", "title": "Summary", "content": "Hello."}],
            "custom_template": {"layout": "sidebar-right", "tag_style": "pill"},
        },
    )
    assert response.status_code == 200
    assert "Dana Reed" in body_of(response.text)
    assert 'class="vn-doc vn-custom"' in response.text


def test_a_custom_template_id_with_no_spec_falls_back_to_a_built_in(client):
    """Nothing may 500 because a design went missing: a resume whose custom
    template was deleted still has to render."""
    response = client.post(
        "/api/v1/render",
        json={
            "template_id": "custom:gone",
            "theme": {"accent": "#0D9488", "font_scale": 1.0,
                      "page_size": "A4", "density": "normal"},
            "basics": {"full_name": "Dana Reed"},
            "sections": [],
        },
    )
    assert response.status_code == 200
    assert "vn-modern-professional" in response.text


# --------------------------------------------------------------------------- #
# The generated stylesheet
# --------------------------------------------------------------------------- #


ALL_SPECS = {
    name: custom_template_service.spec_from_base(name)
    for name in custom_template_service.BASE_SPECS
} | {
    "default": CustomTemplateSpec(),
    "sidebar-accent": CustomTemplateSpec(
        layout="sidebar-right", sidebar_tone="accent", heading_style="band",
        tag_style="pill", bullet_style="dash", entry_divider="hairline",
    ),
    "sidebar-plain": CustomTemplateSpec(
        layout="sidebar-left", sidebar_tone="plain", heading_style="boxed",
        header_style="split", contacts_in_sidebar=False,
    ),
    "banner-sidebar": CustomTemplateSpec(
        layout="sidebar-left", header_style="banner", show_monogram=True,
        heading_style="bar", tag_style="bracket",
    ),
    "extremes": CustomTemplateSpec(
        name_size_pt=34, heading_size_pt=16, body_size_pt=8.5, line_height=1.8,
        heading_tracking=0.24, rule_weight_pt=3.0, page_margin_mm=6,
        section_gap_px=26, entry_gap_px=20, sidebar_width=44,
        bullet_style="none", heading_align="center", name_case="upper",
        header_rule=False, entry_divider="dotted",
    ),
}


@pytest.mark.parametrize("name", sorted(ALL_SPECS))
def test_every_spec_produces_a_well_formed_stylesheet(name):
    css = compile_spec(ALL_SPECS[name])
    # One unbalanced brace silently discards every rule after it.
    assert css.count("{") == css.count("}")
    assert "None" not in css


@pytest.mark.parametrize("name", sorted(ALL_SPECS))
def test_every_spec_renders_the_whole_document(client, name):
    from app.models.resume import Theme
    from app.services import render_service
    from app.services.seed import demo_resume_data

    html = render_service.render_html(
        demo_resume_data(), theme=Theme(accent="#0D9488"), custom=ALL_SPECS[name]
    )
    body = body_of(html)
    for expected in ("Alex Morgan", "Nexus Cloud Solutions", "Professional Summary",
                     "TypeScript", "AWS Certified Developer"):
        assert expected in body, f"{name} lost {expected!r}"
    assert "{{" not in html and "{%" not in html


def test_a_single_column_spec_is_reported_ats_safe_and_a_sidebar_is_not():
    assert CustomTemplateSpec(layout="single").ats_safe
    assert not CustomTemplateSpec(layout="sidebar-left").ats_safe


def test_the_page_margin_bleeds_only_when_something_needs_it():
    assert CustomTemplateSpec(page_margin_mm=14).page_margin() == "14mm"
    assert CustomTemplateSpec(header_style="banner").page_margin() == "14mm 0"
    assert CustomTemplateSpec(layout="sidebar-left").page_margin() == "14mm 0"


def test_the_theme_wins_over_the_generated_stylesheet(client, account):
    """The accent picker has to keep working on a custom design, so :root from
    the theme is inlined after the compiled spec, not before it."""
    template = make(client, account)
    html = client.get(f"{API}/{template['id']}/sample", headers=account["headers"]).text
    css = style_of(html)
    assert css.index("--vc-ink") < css.index("--vn-accent")
