from fastapi import APIRouter, HTTPException, Response, status
from fastapi.responses import HTMLResponse

from app.api.deps import CurrentUser, DbDep
from app.core.config import settings
from app.models.resume import ResumeData
from app.schemas.resume import ResumeCreate, ResumeRead, ResumeSummary, ResumeUpdate
from app.services import render_service, resume_service

router = APIRouter(prefix="/resumes", tags=["resumes"])

NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, detail="Resume not found")


def _read(resume) -> ResumeRead:
    return ResumeRead(**resume.model_dump())


@router.get("", response_model=list[ResumeSummary])
async def list_resumes(user: CurrentUser, db: DbDep) -> list[ResumeSummary]:
    return await resume_service.list_resumes(db, user.id)


@router.post("", response_model=ResumeRead, status_code=status.HTTP_201_CREATED)
async def create_resume(payload: ResumeCreate, user: CurrentUser, db: DbDep) -> ResumeRead:
    if await resume_service.count_for_owner(db, user.id) >= settings.max_resumes_per_user:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Limit of {settings.max_resumes_per_user} resumes reached",
        )
    resume = await resume_service.create_resume(
        db, user.id, payload, owner_name=user.full_name, owner_email=str(user.email)
    )
    return _read(resume)


@router.get("/{resume_id}", response_model=ResumeRead)
async def get_resume(resume_id: str, user: CurrentUser, db: DbDep) -> ResumeRead:
    resume = await resume_service.get_resume(db, user.id, resume_id)
    if resume is None:
        raise NOT_FOUND
    return _read(resume)


@router.patch("/{resume_id}", response_model=ResumeRead)
async def update_resume(
    resume_id: str, payload: ResumeUpdate, user: CurrentUser, db: DbDep
) -> ResumeRead:
    resume = await resume_service.update_resume(db, user.id, resume_id, payload)
    if resume is None:
        raise NOT_FOUND
    return _read(resume)


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resume(resume_id: str, user: CurrentUser, db: DbDep) -> None:
    if not await resume_service.delete_resume(db, user.id, resume_id):
        raise NOT_FOUND


@router.post("/{resume_id}/duplicate", response_model=ResumeRead,
             status_code=status.HTTP_201_CREATED)
async def duplicate_resume(resume_id: str, user: CurrentUser, db: DbDep) -> ResumeRead:
    resume = await resume_service.duplicate_resume(db, user.id, resume_id)
    if resume is None:
        raise NOT_FOUND
    return _read(resume)


@router.get("/{resume_id}/preview", response_class=HTMLResponse)
async def preview_resume(resume_id: str, user: CurrentUser, db: DbDep) -> HTMLResponse:
    """The saved document as standalone HTML -- the same string the PDF is made from."""
    resume = await resume_service.get_resume(db, user.id, resume_id)
    if resume is None:
        raise NOT_FOUND
    html = render_service.render_html(
        ResumeData(basics=resume.basics, sections=resume.sections),
        resume.template_id,
        resume.theme,
    )
    return HTMLResponse(html)


@router.get("/{resume_id}/export/pdf")
async def export_pdf(resume_id: str, user: CurrentUser, db: DbDep) -> Response:
    resume = await resume_service.get_resume(db, user.id, resume_id)
    if resume is None:
        raise NOT_FOUND
    pdf = await render_service.render_pdf(
        ResumeData(basics=resume.basics, sections=resume.sections),
        resume.template_id,
        resume.theme,
    )
    filename = render_service.pdf_filename(resume.basics.full_name, resume.template_id)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
