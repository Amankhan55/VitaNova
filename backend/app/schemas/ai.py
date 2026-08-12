"""Request and response shapes for the AI writing tools.

Field names are snake_case, like every other payload this API serves, so the
Angular models stay uniform.

The response models do double duty: they are what FastAPI documents *and* what
Gemini is constrained to produce, passed through as ``response_schema``. That
means one definition governs both ends and they cannot drift. It also imposes a
restriction worth knowing — Gemini's constrained decoding does not accept
free-form maps or discriminated unions, so every object here has explicitly
named fields.

Scores are bounded at the type level. A model that answers 120 is a validation
error, not a progress bar drawn past its end.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.models.resume import ResumeData

# What a rewrite can be asked for. Mirrored by RewriteStyle in the Angular model.
RewriteStyle = Literal[
    "improve",
    "concise",
    "professional",
    "impactful",
    "technical",
    "ats",
]

# The kinds of prose the writer can produce.
ContentKind = Literal[
    "summary",
    "experience",
    "project",
    "achievement",
    "skills",
    "objective",
]

MAX_INPUT_CHARS = 4_000
MAX_JOB_DESCRIPTION_CHARS = 12_000


# --------------------------------------------------------------------------- #
# 1. Resume writer
# --------------------------------------------------------------------------- #


class GenerateRequest(BaseModel):
    """Everything the writer is allowed to know.

    ``context`` is the whole point: the model may draw on this and nothing else.
    Callers send the surrounding facts they already hold — job title, employer,
    the technologies listed on that entry — and never the entire resume, which
    would cost tokens and invite the model to borrow details from one role for
    another.
    """

    kind: ContentKind
    # The user's current text. Empty is legitimate: writing from scratch.
    current: str = Field(default="", max_length=MAX_INPUT_CHARS)
    role: str = Field(default="", max_length=200)
    organization: str = Field(default="", max_length=200)
    tech: list[str] = Field(default_factory=list, max_length=60)
    # Free-form extra facts the user supplied elsewhere on the same entry.
    context: str = Field(default="", max_length=MAX_INPUT_CHARS)


class GeneratedVariant(BaseModel):
    text: str
    # Present when a variant is bullet-shaped rather than prose.
    style: str = ""


class GenerateResponse(BaseModel):
    kind: ContentKind
    variants: list[GeneratedVariant]
    # Bullet-shaped output for experience and project entries; empty for prose.
    bullets: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class _GeneratedDraft(BaseModel):
    """What Gemini is asked for. Narrower than the response: the grounding
    filter runs between the two, so the endpoint's ``notes`` are ours, not the
    model's."""

    variants: list[GeneratedVariant] = Field(default_factory=list)
    bullets: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# 2. Bullet rewriter
# --------------------------------------------------------------------------- #


class RewriteRequest(BaseModel):
    bullet: str = Field(min_length=1, max_length=MAX_INPUT_CHARS)
    styles: list[RewriteStyle] = Field(default_factory=lambda: ["professional", "impactful", "concise"])
    role: str = Field(default="", max_length=200)
    organization: str = Field(default="", max_length=200)
    tech: list[str] = Field(default_factory=list, max_length=60)


class RewriteSuggestion(BaseModel):
    text: str
    style: str


class RewriteResponse(BaseModel):
    original: str
    suggestions: list[RewriteSuggestion]
    # Set when the grounding filter withheld something, so the UI can say why
    # rather than silently returning fewer options than were asked for.
    notes: list[str] = Field(default_factory=list)


class _RewriteDraft(BaseModel):
    suggestions: list[RewriteSuggestion] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# 3. ATS readiness
# --------------------------------------------------------------------------- #


class AtsCategories(BaseModel):
    """Named fields rather than a map: Gemini's structured output has no way to
    express "an object with arbitrary keys", and a fixed set is what the
    dashboard renders anyway."""

    keyword_match: int = Field(ge=0, le=100)
    experience: int = Field(ge=0, le=100)
    skills: int = Field(ge=0, le=100)
    formatting: int = Field(ge=0, le=100)
    content_quality: int = Field(ge=0, le=100)


class AtsRecommendation(BaseModel):
    title: str
    detail: str
    # Which AI tool can act on this, so the UI knows whether to offer "Fix with
    # AI" and which panel to open. None means advice only.
    action: Optional[Literal["summary", "bullet", "skills"]] = None
    # Where the fix applies, when we can point at it. Free text, e.g. a role.
    target: str = ""


class AtsRequest(ResumeData):
    """Scores the draft on screen, not the last saved copy.

    Autosave is debounced, so a user who clicks Analyse straight after typing
    would otherwise be scored on text they have already changed. This is the
    same reasoning that makes ``RenderRequest`` carry the document.
    """


class AtsResponse(BaseModel):
    overall_score: int = Field(ge=0, le=100)
    categories: AtsCategories
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    recommendations: list[AtsRecommendation] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# 4. Job description matcher
# --------------------------------------------------------------------------- #


class MatchedSkill(BaseModel):
    skill: str
    strength: Literal["strong", "moderate"] = "strong"
    # Where in the resume it was found, so the claim is checkable.
    evidence: str = ""


class PartialSkill(BaseModel):
    skill: str
    reason: str


class MissingSkill(BaseModel):
    skill: str
    importance: Literal["high", "medium", "low"] = "medium"


class ExperienceAlignment(BaseModel):
    score: int = Field(ge=0, le=100)
    summary: str


class JobMatchRequest(ResumeData):
    """The draft on screen, plus the posting to compare it against."""

    job_description: str = Field(min_length=40, max_length=MAX_JOB_DESCRIPTION_CHARS)


class JobMatchResponse(BaseModel):
    match_score: int = Field(ge=0, le=100)
    matched_skills: list[MatchedSkill] = Field(default_factory=list)
    partial_skills: list[PartialSkill] = Field(default_factory=list)
    missing_skills: list[MissingSkill] = Field(default_factory=list)
    matching_keywords: list[str] = Field(default_factory=list)
    missing_keywords: list[str] = Field(default_factory=list)
    experience_alignment: ExperienceAlignment
    recommendations: list[str] = Field(default_factory=list)
