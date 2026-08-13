"""A user-designed template, stored as a *spec* rather than as markup.

The fifteen built-in designs are folders of Jinja + CSS written by hand. A user
template could have been the same thing -- a text box that takes HTML and CSS --
and that is exactly what this module refuses to be, for three reasons:

  * Jinja from a user is remote code execution, not a styling feature.
  * Free CSS breaks WeasyPrint long before it breaks the browser, so the preview
    would stop predicting the PDF -- the one property the renderer is built to
    guarantee.
  * "Your resume looks broken" is unanswerable when the user wrote the layout.

So a custom template is a *spec*: a fixed set of design decisions, every one of
them an enum or a clamped number. `custom_css.compile_spec` turns the spec into
a stylesheet, and `_custom/template.html` lays the document out from the same
values. Nothing a user types ever reaches the renderer as code -- the free-text
fields (name, description, tags) are metadata and never enter the document.

The resulting design space is deliberately wide enough to reproduce most of the
built-ins, which is what makes "start from Serif Book and change three things"
a real workflow rather than a marketing line.
"""

from datetime import UTC, datetime
from typing import Literal

from pydantic import Field, field_validator

from app.core.security import new_id
from app.models.resume import SectionType, Theme, VitaModel
from app.schemas.template import TemplateMeta

# --------------------------------------------------------------------------- #
# The vocabulary
# --------------------------------------------------------------------------- #

Layout = Literal["single", "sidebar-left", "sidebar-right"]
HeaderStyle = Literal["left", "centered", "split", "banner"]
HeadingStyle = Literal["plain", "underline", "rule", "band", "bar", "boxed"]
FontChoice = Literal["sans", "grotesk", "serif", "book", "mono"]
CaseStyle = Literal["normal", "upper"]
Alignment = Literal["left", "center"]
BulletStyle = Literal["disc", "square", "dash", "none"]
TagStyle = Literal["inline", "pill", "bracket"]
DividerStyle = Literal["none", "hairline", "dotted"]
# How the sidebar is set apart, not what colour it is -- `fill` takes its colours
# from sidebar_bg/sidebar_text, so "dark sidebar" and "tinted sidebar" are the
# same tone with different swatches rather than two entries here.
SidebarTone = Literal["fill", "accent", "plain"]

DEFAULT_SIDEBAR_SECTIONS: list[SectionType] = ["skills", "languages", "certifications"]


def _hex_field(default: str) -> str:
    return Field(default=default, pattern=r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


class CustomTemplateSpec(VitaModel):
    """Every knob a user template has. No field here is free-form.

    The numeric ranges are not arbitrary: each is the interval over which the
    generated stylesheet still produces a page that reads as a resume. A name at
    40pt or a 60% sidebar does not; letting the slider go there would only give
    the user a way to make something unusable and blame the app.
    """

    # ---- structure
    layout: Layout = "single"
    # Percent of the measure given to the sidebar. Below ~24% a skills list
    # wraps every second word; above ~44% the main column stops being the main
    # column.
    sidebar_width: int = Field(default=32, ge=24, le=44)
    sidebar_tone: SidebarTone = "fill"
    # Which sections move into the sidebar. Ignored for the single-column layout.
    sidebar_sections: list[SectionType] = Field(
        default_factory=lambda: list(DEFAULT_SIDEBAR_SECTIONS)
    )
    # Contact details in the sidebar as a labelled block, rather than in the
    # header as one wrapping line. Only meaningful when there *is* a sidebar.
    contacts_in_sidebar: bool = True

    # ---- header
    header_style: HeaderStyle = "left"
    name_case: CaseStyle = "normal"
    show_monogram: bool = False
    show_headline: bool = True
    # A rule under the whole header block, the way most of the built-ins close it.
    header_rule: bool = True

    # ---- section headings
    heading_style: HeadingStyle = "underline"
    heading_case: CaseStyle = "upper"
    heading_align: Alignment = "left"
    heading_accent: bool = True

    # ---- type
    body_font: FontChoice = "sans"
    # "same" is not an option: a template that wants one face sets both to it.
    heading_font: FontChoice = "sans"
    name_size_pt: float = Field(default=24.0, ge=15.0, le=34.0)
    heading_size_pt: float = Field(default=11.0, ge=8.5, le=16.0)
    body_size_pt: float = Field(default=10.2, ge=8.5, le=12.0)
    line_height: float = Field(default=1.42, ge=1.15, le=1.8)
    heading_tracking: float = Field(default=0.09, ge=0.0, le=0.24)

    # ---- detail
    bullet_style: BulletStyle = "disc"
    tag_style: TagStyle = "inline"
    entry_divider: DividerStyle = "none"
    rule_weight_pt: float = Field(default=0.8, ge=0.3, le=3.0)

    # ---- page
    page_margin_mm: float = Field(default=14.0, ge=6.0, le=25.0)
    section_gap_px: float = Field(default=11.0, ge=4.0, le=26.0)
    entry_gap_px: float = Field(default=8.0, ge=2.0, le=20.0)

    # ---- colour
    # The accent is *not* here: it lives on the resume's Theme, so the editor's
    # existing accent picker keeps working on a custom design exactly as it does
    # on a built-in one.
    ink: str = _hex_field("#16202E")  # headings and the name
    body_colour: str = _hex_field("#33404F")
    muted_colour: str = _hex_field("#6B7787")
    paper: str = _hex_field("#FFFFFF")
    sidebar_bg: str = _hex_field("#F1F5F9")
    sidebar_text: str = _hex_field("#33404F")

    @field_validator("sidebar_sections")
    @classmethod
    def _dedupe(cls, value: list[SectionType]) -> list[SectionType]:
        seen: list[SectionType] = []
        for item in value:
            if item not in seen:
                seen.append(item)
        return seen

    @property
    def has_sidebar(self) -> bool:
        return self.layout != "single"

    @property
    def ats_safe(self) -> bool:
        """One column, in reading order.

        The generated markup never puts text in decoration and never reorders
        content with CSS, so a single-column spec is genuinely parseable however
        it is coloured. A sidebar is not: it is a table cell, and extracted text
        interleaves the two columns.
        """
        return not self.has_sidebar

    def page_margin(self) -> str:
        """The @page margin, as the shorthand `_theme_css` expects.

        A banner runs to the paper edge, so pages get their inset vertically
        only and the columns supply their own horizontal padding -- the same
        trick the full-bleed built-ins use.
        """
        if self.header_style == "banner" or self.has_sidebar:
            return f"{self.page_margin_mm:g}mm 0"
        return f"{self.page_margin_mm:g}mm"


# --------------------------------------------------------------------------- #
# The stored document
# --------------------------------------------------------------------------- #

# Template ids are namespaced so a custom design can travel through every place
# that already carries a `template_id` string -- the resume document, the render
# request, the editor's design panel -- without any of them growing a second
# field to say which kind it is.
CUSTOM_PREFIX = "custom:"


def qualified_id(raw_id: str) -> str:
    return f"{CUSTOM_PREFIX}{raw_id}"


def is_custom_id(template_id: str | None) -> bool:
    return bool(template_id) and template_id.startswith(CUSTOM_PREFIX)


def raw_id(template_id: str) -> str:
    """The stored document id behind a qualified `custom:...` template id."""
    return template_id[len(CUSTOM_PREFIX):] if is_custom_id(template_id) else template_id


class CustomTemplateDoc(VitaModel):
    id: str = Field(default_factory=new_id)
    owner_id: str
    name: str = Field(default="My design", min_length=1, max_length=60)
    description: str = Field(default="", max_length=400)
    tags: list[str] = Field(default_factory=list)
    # The accent this design is presented with, and the one a resume adopts when
    # it switches to it. Mirrors TemplateMeta.accent on the built-ins.
    accent: str = _hex_field("#2563EB")
    spec: CustomTemplateSpec = Field(default_factory=CustomTemplateSpec)
    # Remembered so "use this design" reproduces what the author saw, page size
    # and spacing included -- not just the colours.
    theme: Theme = Field(default_factory=Theme)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @property
    def template_id(self) -> str:
        return qualified_id(self.id)

    def to_meta(self) -> TemplateMeta:
        """The same shape the built-in gallery and design panel already consume,
        so neither has to learn a second kind of template."""
        return TemplateMeta(
            id=self.template_id,
            name=self.name,
            description=self.description,
            tags=self.tags,
            accent=self.accent,
            accent_presets=[self.accent],
            page_margin=self.spec.page_margin(),
            ats_safe=self.spec.ats_safe,
            sidebar_sections=list(self.spec.sidebar_sections)
            if self.spec.has_sidebar
            else [],
        )
