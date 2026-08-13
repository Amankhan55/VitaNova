from datetime import datetime

from pydantic import BaseModel, Field

from app.models.custom_template import CustomTemplateSpec
from app.models.resume import Theme
from app.schemas.template import TemplateMeta


class CustomTemplateCreate(BaseModel):
    name: str = Field(default="My design", min_length=1, max_length=60)
    description: str = Field(default="", max_length=400)
    tags: list[str] = Field(default_factory=list, max_length=6)
    accent: str = Field(
        default="#2563EB", pattern=r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"
    )
    spec: CustomTemplateSpec | None = None
    theme: Theme | None = None
    # Seeds the new design from a built-in one, so "start from Serif Book" is a
    # first move rather than a rebuild. Ignored when `spec` is supplied.
    based_on: str | None = None


class CustomTemplateUpdate(BaseModel):
    """Every field optional -- this backs the template editor's autosave."""

    name: str | None = Field(default=None, min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=400)
    tags: list[str] | None = Field(default=None, max_length=6)
    accent: str | None = Field(
        default=None, pattern=r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"
    )
    # Replaced wholesale rather than merged: a spec is one coherent design, and
    # a half-applied patch of it is a page nobody chose.
    spec: CustomTemplateSpec | None = None
    theme: Theme | None = None


class CustomTemplateRead(BaseModel):
    id: str
    # The qualified "custom:<id>" form -- what a resume stores in template_id.
    template_id: str
    name: str
    description: str
    tags: list[str]
    accent: str
    spec: CustomTemplateSpec
    theme: Theme
    ats_safe: bool
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, doc) -> "CustomTemplateRead":
        return cls(
            **doc.model_dump(exclude={"owner_id"}),
            template_id=doc.template_id,
            ats_safe=doc.spec.ats_safe,
        )


class CustomTemplatePreview(BaseModel):
    """Renders a spec against demo content without saving it.

    The template editor posts this on every change, which is what lets the live
    preview show an unsaved design -- and, on a brand-new design, one that has no
    id yet to save under.
    """

    spec: CustomTemplateSpec = Field(default_factory=CustomTemplateSpec)
    theme: Theme = Field(default_factory=Theme)


class CustomTemplateList(BaseModel):
    """The user's designs in both shapes the frontend needs: the full documents
    for the editor, and the TemplateMeta view the gallery and the design panel
    already know how to render."""

    templates: list[CustomTemplateRead]
    metas: list[TemplateMeta]
