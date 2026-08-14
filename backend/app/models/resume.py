"""The canonical, template-agnostic resume document.

Every template renders from this one shape, so switching template never asks the
user to re-enter anything. Sections are an ordered *list* rather than fixed
fields, which is what makes reordering, renaming and hiding them possible --
the four reference designs each label and order their sections differently.
"""

from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.security import new_id

SectionType = Literal[
    "summary",
    "experience",
    "education",
    "skills",
    "projects",
    "certifications",
    "languages",
    "custom",
]


class VitaModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)


# --------------------------------------------------------------------------- #
# Size limits
#
# /render and /render/pdf are unauthenticated by design -- they store nothing and
# read nothing -- so these bounds are what stands between a hostile caller and
# handing WeasyPrint a thousand-page document to lay out. The request body is
# capped separately (settings.max_render_body_bytes); this is the second lock,
# and the one that also applies to anything already sitting in Mongo.
#
# Calibrated against the fully-populated demo resume in services/seed.py, whose
# longest field is 381 characters and which serialises to about 5 KB. Every
# limit here is far above what a real document needs -- an editor should never
# be able to produce something the API then refuses to render.
# --------------------------------------------------------------------------- #

# Names, roles, organisations, locations, dates: one line of a form.
Short = Annotated[str, Field(max_length=200)]
# Headlines, links, notes: a long line.
Line = Annotated[str, Field(max_length=500)]
# One bullet, or one paragraph of an entry's summary.
Prose = Annotated[str, Field(max_length=2000)]
# The summary section, which is the only genuinely long-form field.
LongProse = Annotated[str, Field(max_length=5000)]
# A single skill keyword or technology tag.
Keyword = Annotated[str, Field(max_length=100)]

MAX_SECTIONS = 30
MAX_ITEMS_PER_SECTION = 60
MAX_BULLETS = 40
MAX_KEYWORDS = 60
MAX_LINKS = 15

Bullets = Annotated[list[Prose], Field(default_factory=list, max_length=MAX_BULLETS)]
Keywords = Annotated[list[Keyword], Field(default_factory=list, max_length=MAX_KEYWORDS)]


# --------------------------------------------------------------------------- #
# Basics
# --------------------------------------------------------------------------- #


class Link(VitaModel):
    label: Short = ""
    url: Line = ""
    # Maps to an icon in the frontend's icon set.
    icon: Literal["link", "github", "linkedin", "globe", "mail", "phone", "pin"] = "link"


class Basics(VitaModel):
    full_name: Short = ""
    headline: Line = ""
    email: Short = ""
    phone: Short = ""
    location: Short = ""
    links: list[Link] = Field(default_factory=list, max_length=MAX_LINKS)
    # Monogram for the sidebar template. Derived from full_name when blank.
    initials: Annotated[str, Field(max_length=8)] = ""

    def monogram(self) -> str:
        if self.initials:
            return self.initials[:2].upper()
        parts = [p for p in self.full_name.split() if p]
        if not parts:
            return ""
        if len(parts) == 1:
            return parts[0][:2].upper()
        return (parts[0][0] + parts[-1][0]).upper()


# --------------------------------------------------------------------------- #
# Section items
# --------------------------------------------------------------------------- #


class ItemBase(VitaModel):
    id: Annotated[str, Field(max_length=64)] = Field(default_factory=new_id)


class ExperienceItem(ItemBase):
    role: Short = ""
    organization: Short = ""
    location: Short = ""
    start: Short = ""
    end: Short = ""
    current: bool = False
    summary: Prose = ""
    bullets: Bullets
    tech: Keywords


class EducationItem(ItemBase):
    degree: Short = ""
    institution: Short = ""
    location: Short = ""
    start: Short = ""
    end: Short = ""
    current: bool = False
    details: Bullets


class SkillGroupItem(ItemBase):
    label: Short = ""
    keywords: Keywords


class ProjectItem(ItemBase):
    name: Short = ""
    link: Line = ""
    period: Short = ""
    tech: Keywords
    bullets: Bullets


class CertificationItem(ItemBase):
    name: Short = ""
    issuer: Short = ""
    date: Short = ""
    note: Line = ""


class LanguageItem(ItemBase):
    name: Short = ""
    level: Short = ""


class CustomItem(ItemBase):
    title: Short = ""
    subtitle: Short = ""
    meta: Line = ""
    bullets: Bullets


# --------------------------------------------------------------------------- #
# Sections
# --------------------------------------------------------------------------- #


Items = Field(default_factory=list, max_length=MAX_ITEMS_PER_SECTION)


class SectionBase(VitaModel):
    id: Annotated[str, Field(max_length=64)] = Field(default_factory=new_id)
    title: Short = ""
    visible: bool = True


class SummarySection(SectionBase):
    """Free prose. Kept as a section (not a `basics` field) because the reference
    designs title it differently: 'Professional Summary', 'Professional Profile',
    plain 'Summary'."""

    type: Literal["summary"] = "summary"
    title: Short = "Professional Summary"
    content: LongProse = ""


class ExperienceSection(SectionBase):
    type: Literal["experience"] = "experience"
    title: Short = "Professional Experience"
    items: list[ExperienceItem] = Items


class EducationSection(SectionBase):
    type: Literal["education"] = "education"
    title: Short = "Education"
    items: list[EducationItem] = Items


class SkillsSection(SectionBase):
    type: Literal["skills"] = "skills"
    title: Short = "Skills"
    items: list[SkillGroupItem] = Items


class ProjectsSection(SectionBase):
    type: Literal["projects"] = "projects"
    title: Short = "Projects"
    items: list[ProjectItem] = Items


class CertificationsSection(SectionBase):
    type: Literal["certifications"] = "certifications"
    title: Short = "Certifications"
    items: list[CertificationItem] = Items


class LanguagesSection(SectionBase):
    type: Literal["languages"] = "languages"
    title: Short = "Languages"
    items: list[LanguageItem] = Items


class CustomSection(SectionBase):
    type: Literal["custom"] = "custom"
    title: Short = "Additional"
    items: list[CustomItem] = Items


Section = Annotated[
    SummarySection
    | ExperienceSection
    | EducationSection
    | SkillsSection
    | ProjectsSection
    | CertificationsSection
    | LanguagesSection
    | CustomSection,
    Field(discriminator="type"),
]


# --------------------------------------------------------------------------- #
# Theme + document
# --------------------------------------------------------------------------- #


class Theme(VitaModel):
    # Re-validated as a hex colour in render_service._theme_css before it reaches
    # a <style> block; the cap here just stops an unbounded string being stored.
    accent: Annotated[str, Field(max_length=64)] = "#2563EB"
    font_scale: float = Field(default=1.0, ge=0.8, le=1.25)
    page_size: Literal["A4", "Letter"] = "A4"
    density: Literal["compact", "normal", "relaxed"] = "normal"


class ResumeData(VitaModel):
    """The renderable payload -- everything a template needs, nothing more."""

    basics: Basics = Field(default_factory=Basics)
    sections: list[Section] = Field(default_factory=list, max_length=MAX_SECTIONS)


class ResumeDoc(ResumeData):
    id: str = Field(default_factory=new_id)
    owner_id: str
    title: Short = "Untitled Resume"
    template_id: str = "modern-professional"
    theme: Theme = Field(default_factory=Theme)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
