from fastapi import APIRouter, HTTPException, status
from fastapi.responses import HTMLResponse

from app.models.resume import Theme
from app.schemas.template import TemplateMeta
from app.services import render_service, template_registry
from app.services.seed import demo_resume_data

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("", response_model=list[TemplateMeta])
async def list_templates() -> list[TemplateMeta]:
    return template_registry.list_templates()


@router.get("/{template_id}", response_model=TemplateMeta)
async def get_template(template_id: str) -> TemplateMeta:
    meta = template_registry.get_template(template_id)
    if meta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Template not found")
    return meta


@router.get("/{template_id}/sample", response_class=HTMLResponse)
async def sample_render(template_id: str) -> HTMLResponse:
    """The design rendered with demo content -- backs the gallery's live thumbnails,
    so a card can never show a preview that differs from the real output."""
    meta = template_registry.get_template(template_id)
    if meta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Template not found")
    html = render_service.render_html(
        demo_resume_data(), template_id, Theme(accent=meta.accent)
    )
    return HTMLResponse(html)
