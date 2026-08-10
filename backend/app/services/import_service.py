"""Resume import: extract text from an uploaded PDF and parse it into structured
resume data using Google Gemini.

The pipeline is intentionally two-stage so each step can be tested and debugged
independently:

  1. ``extract_text`` — pull plain text from a PDF with pdfplumber.  This is a
     pure function with no network calls.
  2. ``parse_resume_text`` — send that text to Gemini with a structured prompt
     that mirrors VitaNova's section schema, then validate the JSON response
     into a ``ResumeData`` instance.

The Gemini call uses the free tier of ``google-generativeai`` (Gemini 2.0 Flash),
which allows 15 req/min and 1 M tokens/day — more than enough for resume imports.
"""

import json
import logging
import re
from io import BytesIO

import pdfplumber
from google import genai
from google.genai.types import GenerateContentConfig

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


class ImportError_(Exception):
    """User-facing error raised when an import cannot proceed."""


# --------------------------------------------------------------------------- #
# Stage 1: text extraction
# --------------------------------------------------------------------------- #


def extract_text(pdf_bytes: bytes) -> str:
    """Return the concatenated text of every page in a PDF."""
    if len(pdf_bytes) > MAX_PDF_SIZE:
        raise ImportError_("PDF is too large (max 5 MB).")

    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            pages = [page.extract_text() or "" for page in pdf.pages]
    except Exception as exc:
        logger.warning("pdfplumber could not read the uploaded file: %s", exc)
        raise ImportError_("Could not read the PDF. Is the file corrupt?") from exc

    text = "\n\n".join(pages).strip()
    if len(text) < 40:
        raise ImportError_(
            "Could not extract enough text from this PDF. "
            "It may be a scanned image — try a text-based PDF instead."
        )
    return text[:MAX_TEXT_LENGTH]


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
    """Extract the JSON object from Gemini's response, tolerating markdown fences."""
    text = text.strip()
    # Strip ```json ... ``` fences if present
    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()
    return json.loads(text)


def _build_link(raw: dict) -> Link:
    icon = raw.get("icon", "link")
    if icon not in ("link", "github", "linkedin", "globe", "mail", "phone", "pin"):
        icon = "link"
    return Link(label=raw.get("label", ""), url=raw.get("url", ""), icon=icon)


def _to_resume_data(parsed: dict) -> ResumeData:
    """Convert the raw parsed dict into a validated ResumeData."""
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


async def parse_resume_text(text: str) -> ResumeData:
    """Send extracted text to Gemini and return structured ResumeData."""
    if not settings.gemini_api_key:
        raise ImportError_(
            "Resume import is not configured. The VITANOVA_GEMINI_API_KEY "
            "environment variable is missing."
        )

    client = genai.Client(api_key=settings.gemini_api_key)

    try:
        response = await client.aio.models.generate_content(
            model="gemini-3.6-flash",
            contents=f"Parse this resume:\n\n{text}",
            config=GenerateContentConfig(
                system_instruction=_SYSTEM_PROMPT,
                temperature=0.1,
            ),
        )
    except Exception as exc:
        logger.exception("Gemini API call failed")
        raise ImportError_(
            "Could not reach the AI service. Please try again in a moment."
        ) from exc

    raw_text = response.text
    if not raw_text:
        raise ImportError_("The AI returned an empty response. Please try again.")

    try:
        parsed = _extract_json(raw_text)
    except json.JSONDecodeError:
        logger.error("Gemini returned non-JSON: %.500s", raw_text)
        raise ImportError_(
            "The AI response could not be parsed. Please try again."
        )

    return _to_resume_data(parsed)
