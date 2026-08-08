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
# Basics
# --------------------------------------------------------------------------- #


class Link(VitaModel):
    label: str = ""
    url: str = ""
    # Maps to an icon in the frontend's icon set.
    icon: Literal["link", "github", "linkedin", "globe", "mail", "phone", "pin"] = "link"


class Basics(VitaModel):
    full_name: str = ""
    headline: str = ""
    email: str = ""
    phone: str = ""
    location: str = ""
    links: list[Link] = Field(default_factory=list)
    # Monogram for the sidebar template. Derived from full_name when blank.
    initials: str = ""

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
    id: str = Field(default_factory=new_id)


class ExperienceItem(ItemBase):
    role: str = ""
    organization: str = ""
    location: str = ""
    start: str = ""
    end: str = ""
    current: bool = False
    summary: str = ""
    bullets: list[str] = Field(default_factory=list)
    tech: list[str] = Field(default_factory=list)


class EducationItem(ItemBase):
    degree: str = ""
    institution: str = ""
    location: str = ""
    start: str = ""
    end: str = ""
    current: bool = False
    details: list[str] = Field(default_factory=list)


class SkillGroupItem(ItemBase):
    label: str = ""
    keywords: list[str] = Field(default_factory=list)


class ProjectItem(ItemBase):
    name: str = ""
    link: str = ""
    period: str = ""
    tech: list[str] = Field(default_factory=list)
    bullets: list[str] = Field(default_factory=list)


class CertificationItem(ItemBase):
    name: str = ""
    issuer: str = ""
    date: str = ""
    note: str = ""


class LanguageItem(ItemBase):
    name: str = ""
    level: str = ""


class CustomItem(ItemBase):
    title: str = ""
    subtitle: str = ""
    meta: str = ""
    bullets: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Sections
# --------------------------------------------------------------------------- #


class SectionBase(VitaModel):
    id: str = Field(default_factory=new_id)
    title: str = ""
    visible: bool = True


class SummarySection(SectionBase):
    """Free prose. Kept as a section (not a `basics` field) because the reference
    designs title it differently: 'Professional Summary', 'Professional Profile',
    plain 'Summary'."""

    type: Literal["summary"] = "summary"
    title: str = "Professional Summary"
    content: str = ""


class ExperienceSection(SectionBase):
    type: Literal["experience"] = "experience"
    title: str = "Professional Experience"
    items: list[ExperienceItem] = Field(default_factory=list)


class EducationSection(SectionBase):
    type: Literal["education"] = "education"
    title: str = "Education"
    items: list[EducationItem] = Field(default_factory=list)


class SkillsSection(SectionBase):
    type: Literal["skills"] = "skills"
    title: str = "Skills"
    items: list[SkillGroupItem] = Field(default_factory=list)


class ProjectsSection(SectionBase):
    type: Literal["projects"] = "projects"
    title: str = "Projects"
    items: list[ProjectItem] = Field(default_factory=list)


class CertificationsSection(SectionBase):
    type: Literal["certifications"] = "certifications"
    title: str = "Certifications"
    items: list[CertificationItem] = Field(default_factory=list)


class LanguagesSection(SectionBase):
    type: Literal["languages"] = "languages"
    title: str = "Languages"
    items: list[LanguageItem] = Field(default_factory=list)


class CustomSection(SectionBase):
    type: Literal["custom"] = "custom"
    title: str = "Additional"
    items: list[CustomItem] = Field(default_factory=list)


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
    accent: str = "#2563EB"
    font_scale: float = Field(default=1.0, ge=0.8, le=1.25)
    page_size: Literal["A4", "Letter"] = "A4"
    density: Literal["compact", "normal", "relaxed"] = "normal"


class ResumeData(VitaModel):
    """The renderable payload -- everything a template needs, nothing more."""

    basics: Basics = Field(default_factory=Basics)
    sections: list[Section] = Field(default_factory=list)


class ResumeDoc(ResumeData):
    id: str = Field(default_factory=new_id)
    owner_id: str
    title: str = "Untitled Resume"
    template_id: str = "modern-professional"
    theme: Theme = Field(default_factory=Theme)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
