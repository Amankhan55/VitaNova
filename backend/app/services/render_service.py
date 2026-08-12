"""Turns resume data into a self-contained HTML document, and that document into a PDF.

The single most important property of this module: **preview and PDF are the same
document**. `render_html` produces one standalone HTML string with its CSS inlined;
the Angular editor drops it straight into `iframe[srcdoc]`, and `render_pdf` hands
that identical string to WeasyPrint. There is no second renderer to drift from.

Screen-vs-print framing is handled entirely by `@media` rules inside the document:
browsers apply the `screen` block (grey backdrop, page shadow), WeasyPrint applies
the `print` block (`@page` margins, no backdrop). Same content either way.
"""

import logging
import re
from functools import lru_cache

import anyio
from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup, escape

from app.core.config import TEMPLATES_DIR
from app.models.resume import ResumeData, Theme
from app.services import template_registry

logger = logging.getLogger(__name__)

PAGE_DIMENSIONS = {
    "A4": ("210mm", "297mm"),
    "Letter": ("8.5in", "11in"),
}

DENSITY_SCALE = {"compact": 0.88, "normal": 1.0, "relaxed": 1.12}


@lru_cache
def _env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(["html"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["date_range"] = _date_range
    env.filters["paragraphs"] = _paragraphs
    env.filters["visible"] = _visible_sections
    env.globals["find_section"] = _find_section
    env.globals["sections_of"] = _sections_of
    env.globals["contact_entries"] = _contact_entries
    return env


# --------------------------------------------------------------------------- #
# Jinja helpers
# --------------------------------------------------------------------------- #


def _date_range(item, dash: str = "—") -> str:
    """'2019 — 2022', '2022 — Present', or just one side when the other is blank."""
    start = (getattr(item, "start", "") or "").strip()
    end = (getattr(item, "end", "") or "").strip()
    if getattr(item, "current", False):
        end = "Present"
    if start and end:
        return f"{start} {dash} {end}"
    return start or end


def _paragraphs(text: str) -> Markup:
    """Blank-line-separated prose into <p> tags, with the text escaped."""
    if not text:
        return Markup("")
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text.strip()) if b.strip()]
    return Markup("").join(
        Markup("<p>%s</p>") % Markup("<br>").join(
            escape(line) for line in block.splitlines()
        )
        for block in blocks
    )


def _visible_sections(sections):
    """Drop hidden sections and ones with nothing in them, so templates never
    render a heading above empty space."""
    kept = []
    for section in sections:
        if not section.visible:
            continue
        if section.type == "summary":
            if section.content.strip():
                kept.append(section)
            continue
        if any(_item_has_content(item) for item in section.items):
            kept.append(section)
    return kept


def _item_has_content(item) -> bool:
    for value in item.model_dump(exclude={"id"}).values():
        if isinstance(value, str) and value.strip():
            return True
        if isinstance(value, list) and any(str(v).strip() for v in value):
            return True
    return False


def _sections_of(sections, *types: str):
    """Sections whose type is one of `types`, in the user's chosen order."""
    wanted = set(types)
    return [s for s in sections if s.type in wanted]


def _find_section(sections, section_type: str):
    for section in sections:
        if section.type == section_type:
            return section
    return None


def _contact_entries(basics) -> list[str]:
    """The header contact run: location, phone, email, then labelled links.

    A list rather than a Jinja macro because a macro can only return a string,
    and every caller wants to iterate. Blank fields are dropped here so no
    template has to guard against printing an empty separator.
    """
    entries = [basics.location, basics.phone, basics.email]
    entries += [link.label for link in basics.links]
    return [entry.strip() for entry in entries if entry and entry.strip()]


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #


def _read_css(template_id: str) -> str:
    base = (TEMPLATES_DIR / "_shared" / "base.css").read_text("utf-8")
    style_path = template_registry.template_dir(template_id) / "style.css"
    style = style_path.read_text("utf-8") if style_path.exists() else ""
    return f"{base}\n\n{style}"


_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
# One to four CSS lengths, i.e. a margin shorthand. Full-bleed designs use
# "13mm 0" so pages keep a vertical inset while artwork runs to the paper edge.
_MARGIN_RE = re.compile(r"^(?:0|\d+(?:\.\d+)?(?:mm|cm|in|pt|px))(?: (?:0|\d+(?:\.\d+)?(?:mm|cm|in|pt|px))){0,3}$")


def _theme_css(theme: Theme, page_margin: str) -> str:
    width, height = PAGE_DIMENSIONS.get(theme.page_size, PAGE_DIMENSIONS["A4"])
    density = DENSITY_SCALE.get(theme.density, 1.0)
    # The accent lands inside a <style> block, so anything that is not a plain
    # hex colour is discarded rather than trusted.
    accent = theme.accent if _HEX_RE.match(theme.accent or "") else "#2563EB"
    margin = page_margin if _MARGIN_RE.match(page_margin or "") else "14mm"
    return (
        ":root{"
        f"--vn-accent:{accent};"
        f"--vn-font-scale:{theme.font_scale};"
        f"--vn-density:{density};"
        f"--vn-page-width:{width};"
        f"--vn-page-height:{height};"
        f"--vn-page-margin:{margin};"
        "}\n"
        # A literal margin, not a var(): @page is resolved before :root custom
        # properties are available in some engines, and this must not be fragile.
        f"@media print{{@page{{size:{theme.page_size};margin:{margin};}}}}"
    )


def render_html(
    data: ResumeData, template_id: str | None = None, theme: Theme | None = None
) -> str:
    """Render a complete, self-contained HTML document for a resume."""
    template_id = template_registry.resolve_template_id(template_id)
    theme = theme or Theme()
    meta = template_registry.get_template(template_id)

    body = _env().get_template(f"{template_id}/template.html").render(
        basics=data.basics,
        sections=_visible_sections(data.sections),
        all_sections=data.sections,
        theme=theme,
        meta=meta,
        monogram=data.basics.monogram(),
    )

    title = data.basics.full_name or "Resume"
    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{escape(title)} — Resume</title>\n"
        f'<meta name="author" content="{escape(title)}">\n'
        '<meta name="generator" content="VitaNova">\n'
        f"<style>\n{_read_css(template_id)}\n"
        f"{_theme_css(theme, meta.page_margin if meta else '14mm')}\n</style>\n"
        f"</head>\n<body class=\"vn-doc vn-{template_id}\">\n{body}\n</body>\n</html>\n"
    )


def _html_to_pdf(html: str) -> bytes:
    from weasyprint import HTML  # imported lazily; pulls in cairo/pango

    return HTML(string=html, base_url=str(TEMPLATES_DIR)).write_pdf()


async def render_pdf(
    data: ResumeData, template_id: str | None = None, theme: Theme | None = None
) -> bytes:
    """Render to PDF off the event loop -- WeasyPrint is CPU-bound and blocking."""
    html = render_html(data, template_id, theme)
    return await anyio.to_thread.run_sync(_html_to_pdf, html)


def pdf_filename(full_name: str, template_id: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9]+", "_", full_name).strip("_") or "resume"
    return f"{stem}_{template_id}.pdf"
