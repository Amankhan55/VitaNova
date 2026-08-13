"""User-designed templates.

Mounted at /custom-templates rather than under /templates because the built-in
router already owns ``/templates/{template_id}`` -- a sibling path there would
be shadowed by it for every id that is not a literal match.
"""

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import HTMLResponse

from app.api.deps import CurrentUser, DbDep
from app.core.config import settings
from app.schemas.custom_template import (
    CustomTemplateCreate,
    CustomTemplateList,
    CustomTemplatePreview,
    CustomTemplateRead,
    CustomTemplateUpdate,
)
from app.services import custom_template_service, render_service
from app.services.seed import demo_resume_data

router = APIRouter(prefix="/custom-templates", tags=["custom templates"])

NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, detail="Template not found")


@router.get("", response_model=CustomTemplateList)
async def list_custom_templates(user: CurrentUser, db: DbDep) -> CustomTemplateList:
    templates = await custom_template_service.list_for_owner(db, user.id)
    return CustomTemplateList(
        templates=[CustomTemplateRead.of(doc) for doc in templates],
        metas=[doc.to_meta() for doc in templates],
    )


@router.post("", response_model=CustomTemplateRead, status_code=status.HTTP_201_CREATED)
async def create_custom_template(
    payload: CustomTemplateCreate, user: CurrentUser, db: DbDep
) -> CustomTemplateRead:
    if (
        await custom_template_service.count_for_owner(db, user.id)
        >= settings.max_custom_templates_per_user
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Limit of {settings.max_custom_templates_per_user} designs reached",
        )
    doc = await custom_template_service.create(db, user.id, payload)
    return CustomTemplateRead.of(doc)


@router.post("/preview", response_class=HTMLResponse)
async def preview_spec(
    payload: CustomTemplatePreview, user: CurrentUser, db: DbDep
) -> HTMLResponse:
    """Render an *unsaved* spec against demo content.

    This is what drives the template editor's live preview, and it is why a new
    design can be previewed before it has ever been saved. Nothing is read or
    written here -- the spec comes from the request and the content is the
    gallery's demo resume -- so the preview never waits on autosave.
    """
    html = render_service.render_html(
        demo_resume_data(), theme=payload.theme, custom=payload.spec
    )
    return HTMLResponse(html)


@router.get("/{template_id}", response_model=CustomTemplateRead)
async def get_custom_template(
    template_id: str, user: CurrentUser, db: DbDep
) -> CustomTemplateRead:
    doc = await custom_template_service.get(db, user.id, template_id)
    if doc is None:
        raise NOT_FOUND
    return CustomTemplateRead.of(doc)


@router.patch("/{template_id}", response_model=CustomTemplateRead)
async def update_custom_template(
    template_id: str, payload: CustomTemplateUpdate, user: CurrentUser, db: DbDep
) -> CustomTemplateRead:
    doc = await custom_template_service.update(db, user.id, template_id, payload)
    if doc is None:
        raise NOT_FOUND
    return CustomTemplateRead.of(doc)


@router.post(
    "/{template_id}/duplicate",
    response_model=CustomTemplateRead,
    status_code=status.HTTP_201_CREATED,
)
async def duplicate_custom_template(
    template_id: str, user: CurrentUser, db: DbDep
) -> CustomTemplateRead:
    if (
        await custom_template_service.count_for_owner(db, user.id)
        >= settings.max_custom_templates_per_user
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Limit of {settings.max_custom_templates_per_user} designs reached",
        )
    doc = await custom_template_service.duplicate(db, user.id, template_id)
    if doc is None:
        raise NOT_FOUND
    return CustomTemplateRead.of(doc)


@router.delete("/{template_id}")
async def delete_custom_template(
    template_id: str, user: CurrentUser, db: DbDep
) -> dict:
    reassigned = await custom_template_service.delete(db, user.id, template_id)
    if reassigned is None:
        raise NOT_FOUND
    # Reported rather than swallowed: deleting a design silently restyles every
    # resume that used it, and the UI needs to be able to say so.
    return {"resumes_reassigned": reassigned}


@router.get("/{template_id}/sample", response_class=HTMLResponse)
async def sample_render(
    template_id: str, user: CurrentUser, db: DbDep
) -> HTMLResponse:
    """The saved design rendered with demo content -- backs its gallery card,
    exactly as /templates/{id}/sample does for the built-ins."""
    doc = await custom_template_service.get(db, user.id, template_id)
    if doc is None:
        raise NOT_FOUND
    theme = doc.theme.model_copy(update={"accent": doc.accent})
    html = render_service.render_html(demo_resume_data(), theme=theme, custom=doc.spec)
    return HTMLResponse(html)
