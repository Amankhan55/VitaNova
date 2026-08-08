"""Resume persistence.

Every query is scoped by ``owner_id`` as well as ``_id`` so one user can never
read or mutate another's document, even given a valid id.
"""

from datetime import UTC, datetime

from pymongo import DESCENDING
from pymongo.asynchronous.database import AsyncDatabase

from app.core.security import new_id
from app.models.resume import ResumeDoc
from app.schemas.resume import ResumeCreate, ResumeSummary, ResumeUpdate
from app.services import template_registry
from app.services.seed import starter_resume_data


def _to_doc(resume: ResumeDoc) -> dict:
    data = resume.model_dump(mode="python")
    data["_id"] = data.pop("id")
    return data


def _from_doc(doc: dict) -> ResumeDoc:
    data = dict(doc)
    data["id"] = data.pop("_id")
    return ResumeDoc(**data)


async def count_for_owner(db: AsyncDatabase, owner_id: str) -> int:
    return await db.resumes.count_documents({"owner_id": owner_id})


async def list_resumes(db: AsyncDatabase, owner_id: str) -> list[ResumeSummary]:
    cursor = db.resumes.find(
        {"owner_id": owner_id},
        projection={
            "title": 1, "template_id": 1, "updated_at": 1,
            "created_at": 1, "basics.full_name": 1, "basics.headline": 1,
        },
    ).sort("updated_at", DESCENDING)
    out: list[ResumeSummary] = []
    async for doc in cursor:
        basics = doc.get("basics") or {}
        out.append(
            ResumeSummary(
                id=doc["_id"],
                title=doc.get("title", "Untitled Resume"),
                template_id=doc.get("template_id", ""),
                full_name=basics.get("full_name", ""),
                headline=basics.get("headline", ""),
                updated_at=doc["updated_at"],
                created_at=doc["created_at"],
            )
        )
    return out


async def create_resume(
    db: AsyncDatabase, owner_id: str, payload: ResumeCreate, owner_name: str = "",
    owner_email: str = "",
) -> ResumeDoc:
    template_id = template_registry.resolve_template_id(payload.template_id)
    meta = template_registry.get_template(template_id)

    if payload.sections is not None or payload.basics is not None:
        starter = starter_resume_data(owner_name, owner_email)
        basics = payload.basics or starter.basics
        sections = payload.sections if payload.sections is not None else starter.sections
    elif payload.seed_from_template:
        starter = starter_resume_data(owner_name, owner_email)
        basics, sections = starter.basics, starter.sections
    else:
        basics, sections = starter_resume_data().basics, []

    theme = payload.theme
    if theme is None:
        theme = ResumeDoc.model_fields["theme"].default_factory()
        if meta:
            theme.accent = meta.accent

    resume = ResumeDoc(
        owner_id=owner_id,
        title=payload.title,
        template_id=template_id,
        theme=theme,
        basics=basics,
        sections=sections,
    )
    await db.resumes.insert_one(_to_doc(resume))
    return resume


async def get_resume(db: AsyncDatabase, owner_id: str, resume_id: str) -> ResumeDoc | None:
    doc = await db.resumes.find_one({"_id": resume_id, "owner_id": owner_id})
    return _from_doc(doc) if doc else None


async def update_resume(
    db: AsyncDatabase, owner_id: str, resume_id: str, payload: ResumeUpdate
) -> ResumeDoc | None:
    changes = payload.model_dump(exclude_unset=True, mode="python")
    if "template_id" in changes:
        changes["template_id"] = template_registry.resolve_template_id(
            changes["template_id"]
        )
    changes["updated_at"] = datetime.now(UTC)

    doc = await db.resumes.find_one_and_update(
        {"_id": resume_id, "owner_id": owner_id},
        {"$set": changes},
        return_document=True,
    )
    return _from_doc(doc) if doc else None


async def delete_resume(db: AsyncDatabase, owner_id: str, resume_id: str) -> bool:
    result = await db.resumes.delete_one({"_id": resume_id, "owner_id": owner_id})
    return result.deleted_count == 1


async def duplicate_resume(
    db: AsyncDatabase, owner_id: str, resume_id: str
) -> ResumeDoc | None:
    original = await get_resume(db, owner_id, resume_id)
    if original is None:
        return None
    now = datetime.now(UTC)
    clone = original.model_copy(
        update={
            "id": new_id(),
            "title": f"{original.title} (copy)",
            "created_at": now,
            "updated_at": now,
        }
    )
    await db.resumes.insert_one(_to_doc(clone))
    return clone
