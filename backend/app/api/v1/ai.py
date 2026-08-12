"""The AI writing tools.

Every route here costs a call against a free-tier key, so all four are
authenticated (unlike ``/render``, which only echoes back what it was sent) and
all four go through ``_single_flight``.

Error mapping is the whole reason these handlers are more than one line each:

  ``AiRateLimited``  → 429  the user should wait, not retry
  ``AiUnavailable``  → 503  Gemini's problem; retrying is reasonable
  ``AiBadResponse``  → 502  the model answered, unusably; our upstream, our fault

Nothing from Gemini reaches the client verbatim. The messages that go out are
the ones written in ``gemini.py`` — no keys, no stack traces, no model output.
"""

import logging
from collections import defaultdict
from contextlib import asynccontextmanager

from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser
from app.models.resume import ResumeData
from app.schemas.ai import (
    AtsRequest,
    AtsResponse,
    GenerateRequest,
    GenerateResponse,
    JobMatchRequest,
    JobMatchResponse,
    RewriteRequest,
    RewriteResponse,
)
from app.services import ai_service, gemini

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])

# One in-flight AI request per user. A double-clicked button, or two editor tabs
# analysing at once, otherwise spends two of a very small number of free-tier
# calls to compute the same answer twice. Process-local, which is the right
# scope: it guards the click, not the quota, and the quota has its own 429.
_in_flight: defaultdict[str, bool] = defaultdict(bool)

_BUSY = HTTPException(
    status.HTTP_429_TOO_MANY_REQUESTS,
    detail="An AI request is already running. Please wait for it to finish.",
)


@asynccontextmanager
async def _single_flight(user_id: str):
    if _in_flight[user_id]:
        raise _BUSY
    _in_flight[user_id] = True
    try:
        yield
    finally:
        # A pop rather than a False, so the map cannot grow one dead entry per
        # user who ever used the feature.
        _in_flight.pop(user_id, None)


@asynccontextmanager
async def _translated_errors():
    """The one place Gemini's failure modes become HTTP."""
    try:
        yield
    except gemini.AiRateLimited as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc)) from exc
    except gemini.AiUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except gemini.AiBadResponse as exc:
        # 502, not 422: the request was fine, our upstream answered badly. A 4xx
        # here would tell the user to fix input that has nothing wrong with it.
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail="AI is temporarily unavailable. Please try again.",
        ) from exc


@asynccontextmanager
async def _guarded(user_id: str):
    async with _single_flight(user_id), _translated_errors():
        yield


@router.post("/resume/generate", response_model=GenerateResponse)
async def generate_content(payload: GenerateRequest, user: CurrentUser) -> GenerateResponse:
    """Draft or improve one section's prose, from that section's facts alone."""
    async with _guarded(user.id):
        return await ai_service.generate_resume_content(payload)


@router.post("/resume/rewrite-bullet", response_model=RewriteResponse)
async def rewrite_bullet(payload: RewriteRequest, user: CurrentUser) -> RewriteResponse:
    """Offer alternative phrasings of a single bullet."""
    if not payload.bullet.strip():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="There is nothing to rewrite — the bullet is empty.",
        )
    async with _guarded(user.id):
        return await ai_service.rewrite_bullet(payload)


@router.post("/resume/ats-score", response_model=AtsResponse)
async def ats_score(payload: AtsRequest, user: CurrentUser) -> AtsResponse:
    """An estimate of how well this resume reads to an ATS and a recruiter."""
    async with _guarded(user.id):
        return await ai_service.calculate_ats_score(
            ResumeData(basics=payload.basics, sections=payload.sections)
        )


@router.post("/resume/job-match", response_model=JobMatchResponse)
async def job_match(payload: JobMatchRequest, user: CurrentUser) -> JobMatchResponse:
    """Compare this resume against a pasted job description."""
    async with _guarded(user.id):
        return await ai_service.match_job_description(
            ResumeData(basics=payload.basics, sections=payload.sections),
            payload.job_description,
        )
