from pydantic import BaseModel, Field


class TemplateMeta(BaseModel):
    """Describes one template folder, loaded from its meta.json."""

    id: str
    name: str
    description: str = ""
    # Short tags shown on the gallery card, e.g. "Two column", "ATS safe".
    tags: list[str] = Field(default_factory=list)
    accent: str = "#2563EB"
    accent_presets: list[str] = Field(default_factory=list)
    # Page inset. Applied as @page margin in print and as .vn-sheet padding on
    # screen, so both contexts frame the page identically. Full-bleed designs
    # (the sidebar one) set "0" and inset their own columns instead.
    page_margin: str = "14mm"
    # True when the design is plain enough to survive resume parsers.
    ats_safe: bool = False
    # Section types this design lays out in its sidebar, if it has one.
    sidebar_sections: list[str] = Field(default_factory=list)
