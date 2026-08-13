from fastapi import APIRouter, HTTPException, Response, UploadFile, status
from fastapi.responses import HTMLResponse

from app.api.deps import CurrentUser, DbDep
from app.core.config import settings
from app.models.resume import ResumeData
from app.schemas.resume import ResumeCreate, ResumeRead, ResumeSummary, ResumeUpdate
from app.services import (
    custom_template_service,
    import_service,
    render_service,
    resume_service,
)

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
    # None for every built-in design; the spec itself when the resume is set in
    # one of this user's own. Resolved here because the renderer is synchronous.
    custom = await custom_template_service.spec_for(db, user.id, resume.template_id)
    html = render_service.render_html(
        ResumeData(basics=resume.basics, sections=resume.sections),
        resume.template_id,
        resume.theme,
        custom,
    )
    return HTMLResponse(html)


@router.get("/{resume_id}/export/pdf")
async def export_pdf(resume_id: str, user: CurrentUser, db: DbDep) -> Response:
    resume = await resume_service.get_resume(db, user.id, resume_id)
    if resume is None:
        raise NOT_FOUND
    custom = await custom_template_service.spec_for(db, user.id, resume.template_id)
    pdf = await render_service.render_pdf(
        ResumeData(basics=resume.basics, sections=resume.sections),
        resume.template_id,
        resume.theme,
        custom,
    )
    filename = render_service.pdf_filename(resume.basics.full_name, resume.template_id)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


async def _read_capped(file: UploadFile, limit: int) -> bytes:
    """Read an upload, refusing it as soon as it passes ``limit``.

    Reading first and measuring afterwards means a hostile client can make the
    server buffer an arbitrarily large body before anyone objects -- which on a
    512 MB Render instance is the whole attack.
    """
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(64 * 1024):
        total += len(chunk)
        if total > limit:
            raise HTTPException(
                status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"PDF is too large (max {limit // (1024 * 1024)} MB).",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/import", response_model=ResumeRead, status_code=status.HTTP_201_CREATED)
async def import_resume(
    file: UploadFile, user: CurrentUser, db: DbDep,
    template_id: str = "modern-professional",
) -> ResumeRead:
    """Upload a PDF resume, parse it with AI, and create a pre-filled resume."""
    if await resume_service.count_for_owner(db, user.id) >= settings.max_resumes_per_user:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Limit of {settings.max_resumes_per_user} resumes reached",
        )

    # Content-Type is whatever the client claimed, so this only filters honest
    # mistakes. pdfplumber is the real check.
    if not file.content_type or "pdf" not in file.content_type.lower():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Only PDF files are accepted.",
        )

    pdf_bytes = await _read_capped(file, import_service.MAX_PDF_SIZE)

    try:
        text = await import_service.extract_text_async(pdf_bytes)
        resume_data = await import_service.parse_resume_text(text)
    except import_service.UpstreamUnavailable as exc:
        # Gemini's problem, not this upload's. A 4xx here would tell the user
        # their perfectly good resume was rejected.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except import_service.BadDocument as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc

    name = resume_data.basics.full_name.strip()
    payload = ResumeCreate(
        title=f"{name} (imported)" if name else "Imported resume",
        template_id=template_id,
        basics=resume_data.basics,
        sections=resume_data.sections,
        seed_from_template=False,
    )
    resume = await resume_service.create_resume(
        db, user.id, payload,
        owner_name=user.full_name, owner_email=str(user.email),
    )
    return _read(resume)

