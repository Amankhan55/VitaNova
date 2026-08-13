"""Persistence for user-designed templates.

Every query is scoped by ``owner_id`` as well as ``_id``, exactly as resumes
are: a design is private to the account that made it, and a valid id from
another account must not be enough to read, render or overwrite one.
"""

from datetime import UTC, datetime

from pymongo import DESCENDING
from pymongo.asynchronous.database import AsyncDatabase

from app.core.security import new_id
from app.models.custom_template import (
    CustomTemplateDoc,
    CustomTemplateSpec,
    is_custom_id,
    qualified_id,
    raw_id,
)
from app.schemas.custom_template import CustomTemplateCreate, CustomTemplateUpdate
from app.services import template_registry

COLLECTION = "custom_templates"

# --------------------------------------------------------------------------- #
# Starting points
# --------------------------------------------------------------------------- #

# Forking a built-in gives a user somewhere to start that already looks like a
# resume. These are *approximations* in the spec's vocabulary, not ports: the
# built-ins are hand-written CSS and several of them do things the spec has no
# knob for. What they reliably carry over is the design's character -- its
# layout, its type, and how its headings are set -- which is what somebody who
# picks "start from Serif Book" is actually asking for.
#
# A built-in with no entry here starts from the plain default, which is a
# perfectly good blank page rather than a failure.
BASE_SPECS: dict[str, dict] = {
    "classic-ats": {
        "heading_style": "rule", "heading_accent": False, "ink": "#111827",
        "body_colour": "#1F2937", "heading_tracking": 0.06,
    },
    "harvard-classic": {
        "header_style": "centered", "body_font": "serif", "heading_font": "serif",
        "heading_style": "underline", "heading_accent": False, "name_case": "upper",
        "page_margin_mm": 16, "line_height": 1.4, "ink": "#111111",
        "body_colour": "#1C1C1C",
    },
    "serif-book": {
        "body_font": "book", "heading_font": "book", "heading_style": "underline",
        "heading_tracking": 0.14, "line_height": 1.6, "page_margin_mm": 18,
        "body_size_pt": 10.5, "ink": "#2A2118", "body_colour": "#3B3229",
    },
    "modern-professional": {
        "layout": "sidebar-left", "sidebar_tone": "fill", "sidebar_bg": "#0F1D33",
        "sidebar_text": "#C6D2E2", "name_case": "upper", "heading_style": "underline",
        "page_margin_mm": 13, "show_monogram": True,
    },
    "creative-split": {
        "layout": "sidebar-right", "header_style": "banner", "sidebar_tone": "fill",
        "sidebar_bg": "#F1F5F9", "sidebar_text": "#334155", "heading_style": "bar",
    },
    "banner-bold": {
        "header_style": "banner", "name_size_pt": 25, "heading_style": "underline",
        "heading_accent": False, "page_margin_mm": 16,
    },
    "executive-bar": {
        "heading_style": "bar", "rule_weight_pt": 1.0, "page_margin_mm": 15,
        "ink": "#1E293B", "name_case": "upper",
    },
    "section-bands": {
        "heading_style": "band", "heading_case": "upper", "rule_weight_pt": 0.6,
    },
    "minimalist-swiss": {
        "body_font": "grotesk", "heading_font": "grotesk", "heading_style": "underline",
        "rule_weight_pt": 1.4, "heading_tracking": 0.12, "ink": "#0F172A",
    },
    "centered-mono": {
        "header_style": "centered", "heading_font": "mono", "heading_style": "rule",
        "heading_align": "center", "tag_style": "bracket", "heading_accent": False,
        "page_margin_mm": 15,
    },
    "compact-dense": {
        "body_size_pt": 9.4, "line_height": 1.28, "section_gap_px": 7,
        "entry_gap_px": 5, "page_margin_mm": 12, "heading_size_pt": 10,
    },
    "quiet-professional": {
        "heading_style": "plain", "heading_accent": False, "header_rule": False,
        "page_margin_mm": 17, "heading_tracking": 0.16, "ink": "#111827",
    },
    "tech-compact": {
        "body_font": "grotesk", "tag_style": "bracket", "body_size_pt": 9.6,
        "section_gap_px": 8, "page_margin_mm": 12, "heading_style": "underline",
    },
    "nordic-clean": {
        "body_font": "grotesk", "heading_font": "grotesk", "heading_style": "plain",
        "tag_style": "pill", "line_height": 1.55, "section_gap_px": 14,
        "ink": "#1E293B", "body_colour": "#475569",
    },
    "timeless-elegant": {
        "header_style": "centered", "body_font": "book", "heading_font": "book",
        "name_case": "upper", "heading_align": "center", "heading_style": "underline",
        "heading_tracking": 0.18, "paper": "#FDFBF5", "page_margin_mm": 16,
        "ink": "#2B2418", "body_colour": "#3D372C",
    },
}


def spec_from_base(template_id: str | None) -> CustomTemplateSpec:
    """A spec in the character of a built-in design, or the plain default."""
    return CustomTemplateSpec(**BASE_SPECS.get(template_id or "", {}))


# --------------------------------------------------------------------------- #
# Storage
# --------------------------------------------------------------------------- #


def _to_doc(template: CustomTemplateDoc) -> dict:
    data = template.model_dump(mode="python")
    data["_id"] = data.pop("id")
    return data


def _from_doc(doc: dict) -> CustomTemplateDoc:
    data = dict(doc)
    data["id"] = data.pop("_id")
    return CustomTemplateDoc(**data)


async def count_for_owner(db: AsyncDatabase, owner_id: str) -> int:
    return await db[COLLECTION].count_documents({"owner_id": owner_id})


async def list_for_owner(db: AsyncDatabase, owner_id: str) -> list[CustomTemplateDoc]:
    cursor = db[COLLECTION].find({"owner_id": owner_id}).sort("updated_at", DESCENDING)
    return [_from_doc(doc) async for doc in cursor]


async def get(
    db: AsyncDatabase, owner_id: str, template_id: str
) -> CustomTemplateDoc | None:
    doc = await db[COLLECTION].find_one(
        {"_id": raw_id(template_id), "owner_id": owner_id}
    )
    return _from_doc(doc) if doc else None


async def create(
    db: AsyncDatabase, owner_id: str, payload: CustomTemplateCreate
) -> CustomTemplateDoc:
    spec = payload.spec or spec_from_base(payload.based_on)
    template = CustomTemplateDoc(
        owner_id=owner_id,
        name=payload.name,
        description=payload.description,
        tags=payload.tags,
        accent=payload.accent,
        spec=spec,
        theme=payload.theme or CustomTemplateDoc.model_fields["theme"].default_factory(),
    )
    await db[COLLECTION].insert_one(_to_doc(template))
    return template


async def update(
    db: AsyncDatabase, owner_id: str, template_id: str, payload: CustomTemplateUpdate
) -> CustomTemplateDoc | None:
    # `exclude_unset` keeps out the fields the caller left alone; this drops the
    # ones it sent as an explicit null. On this model None never means a value,
    # only "not supplied" -- and writing it would store a document that no longer
    # validates, which would take out the whole listing for that account and
    # leave no route able to repair it.
    changes = {
        field: value
        for field, value in payload.model_dump(exclude_unset=True, mode="python").items()
        if value is not None
    }
    changes["updated_at"] = datetime.now(UTC)
    doc = await db[COLLECTION].find_one_and_update(
        {"_id": raw_id(template_id), "owner_id": owner_id},
        {"$set": changes},
        return_document=True,
    )
    return _from_doc(doc) if doc else None


async def duplicate(
    db: AsyncDatabase, owner_id: str, template_id: str
) -> CustomTemplateDoc | None:
    original = await get(db, owner_id, template_id)
    if original is None:
        return None
    now = datetime.now(UTC)
    clone = original.model_copy(
        update={
            "id": new_id(),
            "name": f"{original.name} (copy)"[:60],
            "created_at": now,
            "updated_at": now,
        }
    )
    await db[COLLECTION].insert_one(_to_doc(clone))
    return clone


async def delete(db: AsyncDatabase, owner_id: str, template_id: str) -> int | None:
    """Delete a design and move its resumes onto the default one.

    Returns the number of resumes reassigned, or None when there was nothing to
    delete. The reassignment is deliberate rather than left to the renderer's
    fallback: those resumes *are* changing design, and a template_id pointing at
    a design that no longer exists is a lie the editor would go on displaying.
    """
    key = raw_id(template_id)
    result = await db[COLLECTION].delete_one({"_id": key, "owner_id": owner_id})
    if result.deleted_count == 0:
        return None
    reassigned = await db.resumes.update_many(
        {"owner_id": owner_id, "template_id": qualified_id(key)},
        {"$set": {
            "template_id": template_registry.DEFAULT_TEMPLATE_ID,
            "updated_at": datetime.now(UTC),
        }},
    )
    return reassigned.modified_count


# --------------------------------------------------------------------------- #
# Render-time lookup
# --------------------------------------------------------------------------- #


async def spec_for(
    db: AsyncDatabase, owner_id: str, template_id: str | None
) -> CustomTemplateSpec | None:
    """The spec a render should use, or None to render a built-in design.

    Returning None for a missing or foreign id is what makes every render path
    degrade to the default design instead of erroring: a resume whose custom
    template was deleted still exports.
    """
    if not is_custom_id(template_id):
        return None
    template = await get(db, owner_id, template_id)
    return template.spec if template else None
