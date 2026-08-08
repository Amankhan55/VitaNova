from datetime import datetime

from pydantic import BaseModel, Field

from app.models.resume import Basics, ResumeData, Section, Theme


class ResumeCreate(BaseModel):
    title: str = "Untitled Resume"
    template_id: str = "modern-professional"
    theme: Theme | None = None
    basics: Basics | None = None
    sections: list[Section] | None = None
    # When true and no sections are supplied, the new resume is pre-filled with
    # the starter content defined by the chosen template.
    seed_from_template: bool = True


class ResumeUpdate(BaseModel):
    """Every field optional -- this backs the editor's autosave PATCH."""

    title: str | None = None
    template_id: str | None = None
    theme: Theme | None = None
    basics: Basics | None = None
    sections: list[Section] | None = None


class ResumeSummary(BaseModel):
    """Lightweight shape for the dashboard listing."""

    id: str
    title: str
    template_id: str
    full_name: str = ""
    headline: str = ""
    updated_at: datetime
    created_at: datetime


class ResumeRead(BaseModel):
    id: str
    title: str
    template_id: str
    theme: Theme
    basics: Basics
    sections: list[Section]
    created_at: datetime
    updated_at: datetime


class RenderRequest(ResumeData):
    """Renders an *unsaved* draft.

    The editor posts its in-memory state here on every debounced keystroke, which
    keeps the live preview instant and fully decoupled from autosave.
    """

    template_id: str = "modern-professional"
    theme: Theme = Field(default_factory=Theme)
