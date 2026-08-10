"""Resume import: extract text from an uploaded PDF and parse it into structured
resume data using Google Gemini.

The pipeline is intentionally two-stage so each step can be tested and debugged
independently:

  1. ``extract_text`` — pull plain text from a PDF with pdfplumber.  This is a
     pure function with no network calls.
  2. ``parse_resume_text`` — send that text to Gemini with a structured prompt
     that mirrors VitaNova's section schema, then validate the JSON response
     into a ``ResumeData`` instance.

The Gemini call goes through the ``google-genai`` SDK against ``gemini-3.6-flash``.

Failures are split into two kinds, because they mean opposite things to the
caller. ``BadDocument`` is the upload's fault and will fail again identically
(a scanned image, a corrupt file) -- there is nothing to retry.
``UpstreamUnavailable`` is Gemini's fault and very likely succeeds on a second
attempt; reporting it as a client error would tell people their perfectly good
resume was rejected.
"""

import json
import logging
import re
from io import BytesIO

import anyio
import pdfplumber
from google import genai
from google.genai import errors as genai_errors
from google.genai.types import GenerateContentConfig, HttpOptions
from pydantic import ValidationError

from app.core.config import settings
from app.models.resume import (
    Basics,
    CertificationItem,
    CertificationsSection,
    EducationItem,
    EducationSection,
    ExperienceItem,
    ExperienceSection,
    LanguageItem,
    LanguagesSection,
    Link,
    ProjectItem,
    ProjectsSection,
    ResumeData,
    SkillGroupItem,
    SkillsSection,
    SummarySection,
)

logger = logging.getLogger(__name__)

MAX_PDF_SIZE = 5 * 1024 * 1024  # 5 MB
MAX_TEXT_LENGTH = 30_000  # characters — generous for any resume

MODEL = "gemini-3.6-flash"
REQUEST_TIMEOUT_MS = 60_000
MAX_ATTEMPTS = 2
RETRY_DELAY_SECONDS = 2.0

# Statuses where trying again is reasonable: rate limits and Gemini-side faults.
_TRANSIENT_STATUSES = frozenset({429, 500, 502, 503, 504})


class ImportFailed(Exception):
    """Base for anything that stops an import."""


class BadDocument(ImportFailed):
    """The upload is the problem. Retrying changes nothing."""


class UpstreamUnavailable(ImportFailed):
    """The AI service cannot serve this request: down, busy, rate-limiting, or
    not configured. Never the upload's fault, and usually worth trying again."""


# --------------------------------------------------------------------------- #
# Stage 1: text extraction
# --------------------------------------------------------------------------- #


def extract_text(pdf_bytes: bytes) -> str:
    """Return the concatenated text of every page in a PDF.

    Synchronous and CPU-bound. Callers on the event loop must go through
    ``extract_text_async``.
    """
    if len(pdf_bytes) > MAX_PDF_SIZE:
        raise BadDocument("PDF is too large (max 5 MB).")

    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            pages = [page.extract_text() or "" for page in pdf.pages]
    except Exception as exc:
        logger.warning("pdfplumber could not read the uploaded file: %s", exc)
        raise BadDocument("Could not read the PDF. Is the file corrupt?") from exc

    text = "\n\n".join(pages).strip()
    if len(text) < 40:
        raise BadDocument(
            "Could not extract enough text from this PDF. "
            "It may be a scanned image — try a text-based PDF instead."
        )
    return text[:MAX_TEXT_LENGTH]


async def extract_text_async(pdf_bytes: bytes) -> str:
    """``extract_text`` off the event loop.

    pdfplumber is CPU-bound and blocking -- the same reason
    ``render_service.render_pdf`` hands WeasyPrint to a worker thread. Left
    inline, a large upload stalls every other request on the worker.
    """
    return await anyio.to_thread.run_sync(extract_text, pdf_bytes)


# --------------------------------------------------------------------------- #
# Stage 2: Gemini parsing
# --------------------------------------------------------------------------- #

_SYSTEM_PROMPT = """\
You are a resume parser.  You will receive the raw text extracted from a PDF resume.
Your job is to parse it into a structured JSON object that matches the schema below.

Return ONLY valid JSON — no markdown fences, no explanation, no extra keys.

JSON Schema:
{
  "basics": {
    "full_name": "",
    "headline": "",
    "email": "",
    "phone": "",
    "location": "",
    "links": [{"label": "", "url": "", "icon": "link"}]
  },
  "summary": "",
  "experience": [
    {
      "role": "",
      "organization": "",
      "location": "",
      "start": "",
      "end": "",
      "current": false,
      "bullets": [""]
    }
  ],
  "education": [
    {
      "degree": "",
      "institution": "",
      "location": "",
      "start": "",
      "end": "",
      "details": [""]
    }
  ],
  "skills": [
    { "label": "", "keywords": [""] }
  ],
  "projects": [
    { "name": "", "period": "", "tech": [""], "bullets": [""] }
  ],
  "certifications": [
    { "name": "", "issuer": "", "date": "" }
  ],
  "languages": [
    { "name": "", "level": "" }
  ]
}

Rules:
- For "icon" in links, use "linkedin" for LinkedIn URLs, "github" for GitHub URLs, and "link" for everything else.
- For "label" in links, use the readable URL without the scheme (e.g. "linkedin.com/in/username").
- For "current", set to true if the end date says "Present", "Current", "Now", or is blank for the most recent role.
- Use short date formats like "2022" or "Jan 2022" — do not invent dates.
- Omit empty arrays or empty strings only if the section truly is absent.
- Group skills logically (e.g. "Programming Languages", "Frameworks", "Tools").
- If you cannot identify a field, leave it as an empty string, do NOT guess.
"""


def _extract_json(text: str) -> dict:
    """Extract the JSON object from Gemini's response, tolerating markdown fences.

    Raises ``BadDocument`` rather than letting a JSONDecodeError -- or a
    perfectly valid JSON *array* -- escape as a 500 from the endpoint.
    """
    text = text.strip()
    # Strip ```json ... ``` fences if present
    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        logger.error("Gemini returned non-JSON: %.500s", text)
        raise BadDocument("The AI response could not be parsed. Please try again.") from exc

    if not isinstance(parsed, dict):
        logger.error("Gemini returned a %s, not an object: %.500s", type(parsed).__name__, text)
        raise BadDocument("The AI response could not be parsed. Please try again.")
    return parsed


def _build_link(raw: dict) -> Link:
    icon = raw.get("icon", "link")
    if icon not in ("link", "github", "linkedin", "globe", "mail", "phone", "pin"):
        icon = "link"
    return Link(label=raw.get("label", ""), url=raw.get("url", ""), icon=icon)


def _to_resume_data(parsed: dict) -> ResumeData:
    """Convert the raw parsed dict into a validated ResumeData.

    Every failure here is a ``BadDocument``: the JSON parsed but does not
    describe a resume -- a number where a string belongs, a string where a list
    belongs, a null section. Left unwrapped these surface as pydantic
    ValidationErrors and AttributeErrors, i.e. a 500 blamed on the server for
    something the model did.
    """
    try:
        return _build_resume_data(parsed)
    except (ValidationError, AttributeError, TypeError, KeyError) as exc:
        logger.error("Gemini JSON did not fit the resume schema: %s", exc)
        raise BadDocument(
            "The AI returned data in an unexpected shape. Please try again."
        ) from exc


def _build_resume_data(parsed: dict) -> ResumeData:
    basics_raw = parsed.get("basics", {})
    basics = Basics(
        full_name=basics_raw.get("full_name", ""),
        headline=basics_raw.get("headline", ""),
        email=basics_raw.get("email", ""),
        phone=basics_raw.get("phone", ""),
        location=basics_raw.get("location", ""),
        links=[_build_link(link) for link in basics_raw.get("links", [])],
    )

    sections = []

    # Summary
    summary = parsed.get("summary", "")
    if summary:
        sections.append(SummarySection(content=summary))

    # Experience
    experience_items = parsed.get("experience", [])
    if experience_items:
        sections.append(
            ExperienceSection(
                items=[
                    ExperienceItem(
                        role=item.get("role", ""),
                        organization=item.get("organization", ""),
                        location=item.get("location", ""),
                        start=item.get("start", ""),
                        end="" if item.get("current") else item.get("end", ""),
                        current=bool(item.get("current", False)),
                        bullets=item.get("bullets", []),
                        tech=item.get("tech", []),
                    )
                    for item in experience_items
                ]
            )
        )

    # Education
    education_items = parsed.get("education", [])
    if education_items:
        sections.append(
            EducationSection(
                items=[
                    EducationItem(
                        degree=item.get("degree", ""),
                        institution=item.get("institution", ""),
                        location=item.get("location", ""),
                        start=item.get("start", ""),
                        end=item.get("end", ""),
                        details=item.get("details", []),
                    )
                    for item in education_items
                ]
            )
        )

    # Skills
    skills_items = parsed.get("skills", [])
    if skills_items:
        sections.append(
            SkillsSection(
                items=[
                    SkillGroupItem(
                        label=item.get("label", ""),
                        keywords=item.get("keywords", []),
                    )
                    for item in skills_items
                ]
            )
        )

    # Projects
    project_items = parsed.get("projects", [])
    if project_items:
        sections.append(
            ProjectsSection(
                items=[
                    ProjectItem(
                        name=item.get("name", ""),
                        period=item.get("period", ""),
                        tech=item.get("tech", []),
                        bullets=item.get("bullets", []),
                    )
                    for item in project_items
                ]
            )
        )

    # Certifications
    cert_items = parsed.get("certifications", [])
    if cert_items:
        sections.append(
            CertificationsSection(
                items=[
                    CertificationItem(
                        name=item.get("name", ""),
                        issuer=item.get("issuer", ""),
                        date=item.get("date", ""),
                    )
                    for item in cert_items
                ]
            )
        )

    # Languages
    lang_items = parsed.get("languages", [])
    if lang_items:
        sections.append(
            LanguagesSection(
                items=[
                    LanguageItem(
                        name=item.get("name", ""),
                        level=item.get("level", ""),
                    )
                    for item in lang_items
                ]
            )
        )

    return ResumeData(basics=basics, sections=sections)


def _is_transient(exc: genai_errors.APIError) -> bool:
    return getattr(exc, "code", None) in _TRANSIENT_STATUSES


async def _generate(text: str) -> str:
    """One Gemini round trip, retried once when the failure looks temporary.

    A 503 'high demand' is common enough on the free tier that a single retry
    turns most of them into a success the user never sees.
    """
    client = genai.Client(api_key=settings.gemini_api_key)
    config = GenerateContentConfig(
        system_instruction=_SYSTEM_PROMPT,
        temperature=0.1,
        # Without this the request inherits no deadline, so a stalled upstream
        # would hold the connection -- and a worker slot -- indefinitely.
        http_options=HttpOptions(timeout=REQUEST_TIMEOUT_MS),
    )

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = await client.aio.models.generate_content(
                model=MODEL,
                contents=f"Parse this resume:\n\n{text}",
                config=config,
            )
        except genai_errors.APIError as exc:
            retryable = _is_transient(exc) and attempt < MAX_ATTEMPTS
            logger.warning(
                "Gemini %s on attempt %d/%d%s",
                getattr(exc, "code", "error"),
                attempt,
                MAX_ATTEMPTS,
                " — retrying" if retryable else "",
            )
            if retryable:
                await anyio.sleep(RETRY_DELAY_SECONDS)
                continue
            if _is_transient(exc):
                raise UpstreamUnavailable(
                    "The AI service is busy right now. Please try again in a moment."
                ) from exc
            # 400/401/403 — our key or our request is wrong, not the user's PDF.
            logger.error("Gemini rejected the request: %s", exc)
            raise UpstreamUnavailable(
                "The AI service rejected the request. Please try again later."
            ) from exc
        except Exception as exc:  # network failure, DNS, timeout
            logger.exception("Gemini call failed on attempt %d", attempt)
            if attempt < MAX_ATTEMPTS:
                await anyio.sleep(RETRY_DELAY_SECONDS)
                continue
            raise UpstreamUnavailable(
                "Could not reach the AI service. Please try again in a moment."
            ) from exc

        raw_text = response.text
        if raw_text:
            return raw_text
        # An empty body is not an error the SDK reports; treat it as transient.
        logger.warning("Gemini returned an empty response on attempt %d", attempt)
        if attempt < MAX_ATTEMPTS:
            await anyio.sleep(RETRY_DELAY_SECONDS)

    raise UpstreamUnavailable("The AI service returned nothing. Please try again.")


async def parse_resume_text(text: str) -> ResumeData:
    """Send extracted text to Gemini and return structured ResumeData."""
    if not settings.gemini_api_key:
        # Not the upload's fault and not fixable by retrying with a better PDF,
        # so it belongs with the other "service can't serve this" failures.
        raise UpstreamUnavailable(
            "Resume import is not configured on this server — "
            "VITANOVA_GEMINI_API_KEY is not set."
        )

    raw_text = await _generate(text)
    return _to_resume_data(_extract_json(raw_text))
