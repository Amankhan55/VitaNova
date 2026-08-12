"""Shared plumbing for every Google Gemini call this app makes.

Two callers today — resume import (``import_service``) and the writing tools
(``ai_service``) — and both want the same four things: a client, a deadline, a
retry for the failures that are worth retrying, and a way to turn the reply
into something typed. Keeping that here means a change to the model name, the
timeout, or the retry policy is made once.

Failures are split by *who can fix them*, because that decides the status code
the endpoint returns:

  ``AiUnavailable``   — the service cannot serve this request: down, busy,
                        rate-limiting, or unconfigured. Never the caller's
                        fault. Usually worth trying again → 503.
  ``AiRateLimited``   — an ``AiUnavailable`` we can name precisely, so the user
                        is told to wait rather than to retry → 429.
  ``AiBadResponse``   — the model answered and the answer was unusable. Trying
                        the identical request again may well work, but the
                        caller decides what to blame → 502 or 422.
"""

import json
import logging
import re
from typing import TypeVar

import anyio
from google import genai
from google.genai import errors as genai_errors
from google.genai.types import GenerateContentConfig, HttpOptions
from pydantic import BaseModel, ValidationError

from app.core.config import settings

logger = logging.getLogger(__name__)

MODEL = "gemini-3.6-flash"
REQUEST_TIMEOUT_MS = 60_000
MAX_ATTEMPTS = 2
RETRY_DELAY_SECONDS = 2.0

# Statuses where trying again is reasonable: rate limits and Gemini-side faults.
_TRANSIENT_STATUSES = frozenset({429, 500, 502, 503, 504})

ModelT = TypeVar("ModelT", bound=BaseModel)


class AiUnavailable(Exception):
    """The AI service cannot serve this request. Not the caller's fault."""


class AiRateLimited(AiUnavailable):
    """Quota or rate limit. Retrying *now* will fail the same way."""


class AiNotConfigured(AiUnavailable):
    """No API key. An operator problem, invisible to the user until they click."""


class AiBadResponse(Exception):
    """The model answered, but the answer could not be used."""


def _is_transient(exc: genai_errors.APIError) -> bool:
    return getattr(exc, "code", None) in _TRANSIENT_STATUSES


def _client() -> genai.Client:
    if not settings.gemini_api_key:
        raise AiNotConfigured(
            "AI features are not configured on this server — "
            "VITANOVA_GEMINI_API_KEY is not set."
        )
    return genai.Client(api_key=settings.gemini_api_key)


async def generate_text(
    *,
    system: str,
    prompt: str,
    temperature: float = 0.2,
    response_schema: type[BaseModel] | None = None,
) -> str:
    """One Gemini round trip, retried once when the failure looks temporary.

    A 503 'high demand' is common enough on the free tier that a single retry
    turns most of them into a success the user never sees.

    ``response_schema`` constrains the model at the API level rather than by
    asking nicely in the prompt. We still read ``response.text`` and validate it
    ourselves — a constrained decode is a strong hint, not a guarantee, and
    reading the raw text keeps this function testable without the SDK's
    response-parsing machinery.
    """
    client = _client()
    config = GenerateContentConfig(
        system_instruction=system,
        temperature=temperature,
        # Without this the request inherits no deadline, so a stalled upstream
        # would hold the connection -- and a worker slot -- indefinitely.
        http_options=HttpOptions(timeout=REQUEST_TIMEOUT_MS),
    )
    if response_schema is not None:
        config.response_mime_type = "application/json"
        config.response_schema = response_schema

    last_status: int | None = None

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = await client.aio.models.generate_content(
                model=MODEL, contents=prompt, config=config
            )
        except genai_errors.APIError as exc:
            last_status = getattr(exc, "code", None)
            retryable = _is_transient(exc) and attempt < MAX_ATTEMPTS
            logger.warning(
                "Gemini %s on attempt %d/%d%s",
                last_status or "error",
                attempt,
                MAX_ATTEMPTS,
                " — retrying" if retryable else "",
            )
            if retryable:
                await anyio.sleep(RETRY_DELAY_SECONDS)
                continue
            if last_status == 429:
                raise AiRateLimited(
                    "AI usage limit reached. Please try again later."
                ) from exc
            if _is_transient(exc):
                raise AiUnavailable(
                    "The AI service is busy right now. Please try again in a moment."
                ) from exc
            # 400/401/403 — our key or our request is wrong, not the caller's input.
            logger.error("Gemini rejected the request: %s", exc)
            raise AiUnavailable(
                "The AI service rejected the request. Please try again later."
            ) from exc
        except Exception as exc:  # network failure, DNS, timeout
            logger.exception("Gemini call failed on attempt %d", attempt)
            if attempt < MAX_ATTEMPTS:
                await anyio.sleep(RETRY_DELAY_SECONDS)
                continue
            raise AiUnavailable(
                "Could not reach the AI service. Please try again in a moment."
            ) from exc

        text = response.text
        if text:
            return text
        # An empty body is not an error the SDK reports; treat it as transient.
        logger.warning("Gemini returned an empty response on attempt %d", attempt)
        if attempt < MAX_ATTEMPTS:
            await anyio.sleep(RETRY_DELAY_SECONDS)

    raise AiUnavailable("The AI service returned nothing. Please try again.")


def extract_json(text: str) -> dict:
    """Extract the JSON object from a model reply, tolerating markdown fences.

    Raises ``AiBadResponse`` rather than letting a JSONDecodeError -- or a
    perfectly valid JSON *array* -- escape as a 500 from the endpoint.
    """
    text = text.strip()
    # Strip ```json ... ``` fences if present.
    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        logger.error("Gemini returned non-JSON (%d chars)", len(text))
        raise AiBadResponse("The AI response could not be parsed.") from exc

    if not isinstance(parsed, dict):
        logger.error("Gemini returned a %s, not an object", type(parsed).__name__)
        raise AiBadResponse("The AI response could not be parsed.")
    return parsed


async def generate_model(
    *,
    system: str,
    prompt: str,
    schema: type[ModelT],
    temperature: float = 0.2,
) -> ModelT:
    """Generate and validate in one step: the typed result or ``AiBadResponse``.

    Nothing downstream of this ever handles a raw dict from the model, which is
    what keeps a hallucinated key or a string-where-a-list-belongs from becoming
    a 500 three layers away.
    """
    raw = await generate_text(
        system=system, prompt=prompt, temperature=temperature, response_schema=schema
    )
    parsed = extract_json(raw)
    try:
        return schema.model_validate(parsed)
    except ValidationError as exc:
        logger.error("Gemini JSON did not fit %s: %s", schema.__name__, exc)
        raise AiBadResponse("The AI returned data in an unexpected shape.") from exc
