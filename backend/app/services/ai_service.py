"""The four AI writing tools, and the prompts behind them.

Route handlers call into here and get typed results back; nothing about Gemini
leaks past this module. The transport lives in ``gemini``, the honesty check in
``grounding``, and what remains is the part that is actually about resumes:
deciding what to send, asking for it well, and refusing what comes back if it
claims things the user never said.

**On cost.** The API key is a free-tier one, so every method sends the smallest
context that can do the job. A bullet rewrite gets the bullet plus its role and
technologies — not the resume. Only the two whole-document analyses (ATS, job
match) see everything, and they see a digest rather than the JSON, which is
roughly a third of the tokens and reads more like the document a recruiter
would.
"""

import logging

from app.models.resume import ResumeData
from app.schemas.ai import (
    AtsRecommendation,
    AtsResponse,
    ContentKind,
    GeneratedVariant,
    GenerateRequest,
    GenerateResponse,
    JobMatchResponse,
    RewriteRequest,
    RewriteResponse,
    RewriteSuggestion,
    RewriteStyle,
    _GeneratedDraft,
    _RewriteDraft,
)
from app.services import gemini, grounding

logger = logging.getLogger(__name__)

# Digest cap. A resume that renders onto two pages lands far under this; the
# limit exists so a pathological document cannot blow up a free-tier request.
MAX_DIGEST_CHARS = 9_000


# --------------------------------------------------------------------------- #
# The rule that governs every prompt here
# --------------------------------------------------------------------------- #

_HONESTY_RULES = """\
ABSOLUTE RULE — you may only restate what the user gave you.

Never introduce: companies, job titles, technologies, tools, projects,
certifications, degrees, dates, years of experience, team sizes, metrics,
percentages, money, or responsibilities that are not present in the input.

Never add a number that is not already in the input. If the input says
"Fixed bugs", an acceptable rewrite is "Diagnosed and resolved software defects";
"Resolved 150+ production defects" is forbidden, because 150 came from nowhere.

If the input is thin, write the strongest honest sentence you can and stop.
A shorter true statement is always correct; an impressive invented one is not.
Do not use placeholders such as "X%" or "[number]" — write the sentence without
the figure instead.
"""

_STYLE_BRIEF = {
    "improve": "clearer and better written, same meaning and length",
    "concise": "shorter and denser, no filler, one line",
    "professional": "formal register, third-person-implied resume voice",
    "impactful": "lead with the outcome, strong verb first — but invent no metrics",
    "technical": "name the technologies already given and be specific about the engineering",
    "ats": "plain wording built from terms already in the input, no jargon a parser would miss",
}

_KIND_BRIEF: dict[ContentKind, str] = {
    "summary": "a professional summary of 2–3 sentences, first person implied, no pronouns",
    "experience": "3–5 resume bullets describing this role's work",
    "project": "2–4 resume bullets describing this project",
    "achievement": "1–3 achievement statements, each a single line",
    "skills": "one short line describing this skill group's depth",
    "objective": "a 1–2 sentence career objective",
}

# Prose kinds return `variants` the user picks between; the rest return bullets.
_BULLET_KINDS = frozenset({"experience", "project", "achievement"})


def _writer_system(kind: ContentKind) -> str:
    return (
        "You write resume content. You are given facts about one entry and you "
        "rewrite or draft that entry only.\n\n"
        f"{_HONESTY_RULES}\n"
        f"Produce {_KIND_BRIEF[kind]}.\n"
        "Return JSON only. For bullet output fill `bullets` and leave `variants` "
        "empty; for prose fill `variants` with 2 alternatives and leave `bullets` "
        "empty. Never start a bullet with a dash or bullet character."
    )


_REWRITER_SYSTEM = f"""\
You rewrite a single resume bullet. You are given that bullet and the role it
belongs to.

{_HONESTY_RULES}

Return JSON only: one suggestion per requested style, each a single sentence
with no leading dash or bullet character, each preserving the original meaning.
"""

_ATS_SYSTEM = f"""\
You assess how well a resume aligns with common ATS parsing and recruiter
expectations. You are not any specific vendor's ATS and you never claim to be.

Score 0–100 on: keyword_match, experience, skills, formatting, content_quality.
overall_score is your holistic judgement, not necessarily their mean.

Judge only what is present. Do not invent gaps that are not visible in the text,
and do not tell the user to add a skill, employer or credential they have not
shown — say "if you have X, consider adding it" instead.

Recommendations must be concrete and actionable. Set `action` to "summary" when
the fix is the professional summary, "bullet" when it is a specific experience
bullet, "skills" when it is the skills section, and "" for anything else. Put
the affected role or section name in `target`.

Return JSON only.
"""

_MATCH_SYSTEM = f"""\
You compare a resume against a job description.

A skill is `matched` only if the resume actually evidences it; put the evidence
in `evidence`. A skill is `partial` when the resume shows something adjacent —
say what, in `reason`. Everything the posting wants and the resume does not show
is `missing`.

Never instruct the user to claim a skill they have not demonstrated. Phrase
every such recommendation conditionally: "If you have worked with X, consider
adding it to your Skills or Experience section."

{_HONESTY_RULES}

Return JSON only.
"""


# --------------------------------------------------------------------------- #
# Context building
# --------------------------------------------------------------------------- #


def _entry_context(request: GenerateRequest | RewriteRequest) -> str:
    """The facts a single-entry operation is allowed to draw on.

    Doubles as the grounding corpus, which is the reason it is built once and
    passed to both the prompt and the check: if the model may see it, the filter
    must accept it, and vice versa. Two separate strings would drift apart and
    start rejecting honest suggestions.
    """
    parts: list[str] = []
    if request.role:
        parts.append(f"Job title: {request.role}")
    if request.organization:
        parts.append(f"Employer: {request.organization}")
    if request.tech:
        parts.append("Technologies: " + ", ".join(request.tech))
    if isinstance(request, GenerateRequest):
        if request.current:
            parts.append(f"Existing text: {request.current}")
        if request.context:
            parts.append(f"Further detail: {request.context}")
    else:
        parts.append(f"Bullet: {request.bullet}")
    return "\n".join(parts)


def resume_digest(data: ResumeData) -> str:
    """A compact plain-text rendering of a resume, for the whole-document tools.

    Sending ``model_dump_json`` would work and cost roughly three times as much,
    most of it braces and ids the model has no use for. Hidden sections are
    skipped: they are not on the page, so they should not be scored.
    """
    lines: list[str] = []
    basics = data.basics
    if basics.full_name:
        lines.append(basics.full_name)
    if basics.headline:
        lines.append(basics.headline)
    if basics.location:
        lines.append(basics.location)

    for section in data.sections:
        if not section.visible:
            continue
        title = section.title or section.type.title()
        lines.append(f"\n## {title}")

        if section.type == "summary":
            lines.append(section.content)
            continue

        for item in section.items:
            match section.type:
                case "experience":
                    period = f"{item.start}–{'Present' if item.current else item.end}".strip("–")
                    lines.append(f"- {item.role} at {item.organization} ({period})")
                    lines.extend(f"  • {bullet}" for bullet in item.bullets if bullet)
                    if item.tech:
                        lines.append("  Tech: " + ", ".join(item.tech))
                case "education":
                    lines.append(f"- {item.degree}, {item.institution} ({item.start}–{item.end})")
                    lines.extend(f"  • {detail}" for detail in item.details if detail)
                case "skills":
                    lines.append(f"- {item.label}: " + ", ".join(item.keywords))
                case "projects":
                    lines.append(f"- {item.name} ({item.period})")
                    if item.tech:
                        lines.append("  Tech: " + ", ".join(item.tech))
                    lines.extend(f"  • {bullet}" for bullet in item.bullets if bullet)
                case "certifications":
                    lines.append(f"- {item.name} — {item.issuer} ({item.date})")
                case "languages":
                    lines.append(f"- {item.name}: {item.level}")
                case "custom":
                    lines.append(f"- {item.title} — {item.subtitle} ({item.meta})")
                    lines.extend(f"  • {bullet}" for bullet in item.bullets if bullet)

    return "\n".join(line for line in lines if line is not None)[:MAX_DIGEST_CHARS]


def _clean(text: str) -> str:
    """Strip the bullet glyphs models add back however firmly you ask them not to."""
    return text.strip().lstrip("-•*·").strip()


# --------------------------------------------------------------------------- #
# 1. Resume writer
# --------------------------------------------------------------------------- #


async def generate_resume_content(request: GenerateRequest) -> GenerateResponse:
    """Draft or improve one piece of resume prose.

    Anything the grounding filter rejects is dropped, with a note explaining
    why. When *everything* is rejected the caller gets an empty result rather
    than a polished fabrication — the UI offers Regenerate, and the user's own
    text is still sitting untouched in the editor behind the panel.
    """
    context = _entry_context(request)
    prompt = (
        f"{context}\n\n"
        f"Task: write the {request.kind} for this entry using only the facts above."
    )

    draft = await gemini.generate_model(
        system=_writer_system(request.kind),
        prompt=prompt,
        schema=_GeneratedDraft,
        temperature=0.4,
    )

    notes: list[str] = []

    bullets = [_clean(b) for b in draft.bullets if _clean(b)]
    kept_bullets, rejected_bullets = grounding.filter_grounded(bullets, context)

    variants = [
        GeneratedVariant(text=_clean(v.text), style=v.style)
        for v in draft.variants
        if _clean(v.text)
    ]
    kept_variants: list[GeneratedVariant] = []
    rejected_variants = 0
    for variant in variants:
        if grounding.is_grounded(variant.text, context):
            kept_variants.append(variant)
        else:
            rejected_variants += 1

    withheld = len(rejected_bullets) + rejected_variants
    if withheld:
        # Named, not silent: a user who sees two suggestions where they expected
        # three should know the third was withheld rather than never written.
        notes.append(
            f"{withheld} suggestion{'s' if withheld > 1 else ''} withheld for "
            "introducing details you had not provided."
        )
        logger.info("grounding filter withheld %d writer suggestion(s)", withheld)

    if request.kind in _BULLET_KINDS and not kept_bullets and kept_variants:
        # The model answered in the wrong shape. Its text is fine; move it.
        kept_bullets = [variant.text for variant in kept_variants]
        kept_variants = []

    return GenerateResponse(
        kind=request.kind, variants=kept_variants, bullets=kept_bullets, notes=notes
    )


# --------------------------------------------------------------------------- #
# 2. Bullet rewriter
# --------------------------------------------------------------------------- #


async def rewrite_bullet(request: RewriteRequest) -> RewriteResponse:
    """Offer alternative phrasings of one bullet, in the requested styles."""
    context = _entry_context(request)
    styles: list[RewriteStyle] = list(dict.fromkeys(request.styles)) or ["professional"]
    style_lines = "\n".join(f"- {style}: {_STYLE_BRIEF[style]}" for style in styles)

    prompt = (
        f"{context}\n\n"
        f"Rewrite the bullet once per style:\n{style_lines}\n\n"
        "Set each suggestion's `style` to the style name it answers."
    )

    draft = await gemini.generate_model(
        system=_REWRITER_SYSTEM, prompt=prompt, schema=_RewriteDraft, temperature=0.5
    )

    suggestions: list[RewriteSuggestion] = []
    withheld = 0
    seen: set[str] = set()
    for suggestion in draft.suggestions:
        text = _clean(suggestion.text)
        if not text or text.lower() in seen:
            continue
        if not grounding.is_grounded(text, context):
            withheld += 1
            continue
        seen.add(text.lower())
        suggestions.append(RewriteSuggestion(text=text, style=suggestion.style or "improve"))

    notes: list[str] = []
    if withheld:
        notes.append(
            f"{withheld} rewrite{'s' if withheld > 1 else ''} withheld for adding "
            "figures or technologies that were not in your bullet."
        )
        logger.info("grounding filter withheld %d rewrite(s)", withheld)
    if not suggestions:
        notes.append("No grounded rewrite could be produced. Your bullet is unchanged.")

    return RewriteResponse(original=request.bullet, suggestions=suggestions, notes=notes)


# --------------------------------------------------------------------------- #
# 3. ATS readiness
# --------------------------------------------------------------------------- #


async def calculate_ats_score(data: ResumeData) -> AtsResponse:
    """Estimate how well a resume reads to an ATS and to a recruiter."""
    digest = resume_digest(data)
    if len(digest.strip()) < 80:
        # Nothing to judge. Asking Gemini to score an empty page spends a
        # free-tier call to be told the page is empty.
        return AtsResponse(
            overall_score=0,
            categories={
                "keyword_match": 0, "experience": 0, "skills": 0,
                "formatting": 0, "content_quality": 0,
            },
            weaknesses=["There is not enough content in this resume to analyse yet."],
            recommendations=[
                AtsRecommendation(
                    title="Add your experience",
                    detail="Fill in a summary and at least one role, then run the "
                            "analysis again.",
                    action=None,
                    target="",
                )
            ],
        )

    return await gemini.generate_model(
        system=_ATS_SYSTEM,
        prompt=f"Assess this resume:\n\n{digest}",
        schema=AtsResponse,
        temperature=0.2,
    )


# --------------------------------------------------------------------------- #
# 4. Job description matcher
# --------------------------------------------------------------------------- #


async def match_job_description(data: ResumeData, job_description: str) -> JobMatchResponse:
    """Compare a resume against a posting and report where it lands."""
    digest = resume_digest(data)
    return await gemini.generate_model(
        system=_MATCH_SYSTEM,
        prompt=(
            f"JOB DESCRIPTION:\n{job_description.strip()}\n\n"
            f"RESUME:\n{digest}\n\n"
            "Compare them."
        ),
        schema=JobMatchResponse,
        temperature=0.2,
    )
