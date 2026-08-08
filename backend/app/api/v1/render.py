from fastapi import APIRouter, Response
from fastapi.responses import HTMLResponse

from app.models.resume import ResumeData
from app.schemas.resume import RenderRequest
from app.services import render_service

router = APIRouter(tags=["render"])


@router.post("/render", response_class=HTMLResponse)
async def render_draft(payload: RenderRequest) -> HTMLResponse:
    """Render an unsaved draft to standalone HTML.

    This is what drives the editor's live preview: the client posts its current
    in-memory state on every debounced keystroke, so the preview never waits on
    autosave. Deliberately unauthenticated -- it touches no stored data and only
    ever echoes back what the caller sent.
    """
    html = render_service.render_html(
        ResumeData(basics=payload.basics, sections=payload.sections),
        payload.template_id,
        payload.theme,
    )
    return HTMLResponse(html)


@router.post("/render/pdf")
async def render_draft_pdf(payload: RenderRequest) -> Response:
    pdf = await render_service.render_pdf(
        ResumeData(basics=payload.basics, sections=payload.sections),
        payload.template_id,
        payload.theme,
    )
    filename = render_service.pdf_filename(payload.basics.full_name, payload.template_id)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
