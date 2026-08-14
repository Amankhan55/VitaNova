"""Test fixtures.

These are integration tests: they run against a real MongoDB on localhost, in a
throwaway database. Mocking the driver would test the mock, not the ownership
scoping and unique indexes that actually protect user data.
"""

import os
import re
import sys
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Point at a scratch database *before* app.core.config builds its settings singleton.
os.environ["VITANOVA_MONGO_DB"] = f"vitanova_test_{uuid.uuid4().hex[:8]}"
os.environ["VITANOVA_JWT_SECRET"] = "test-secret"
# Otherwise a test that registers and immediately resends would be told to wait.
os.environ["VITANOVA_EMAIL_RESEND_COOLDOWN_SECONDS"] = "0"
# Force mail into email_service.outbox even on a machine whose .env points at a
# real SMTP server: `register()` reads the verification link back out of that
# outbox, and a developer with working mail settings would otherwise watch every
# authenticated test error out -- while sending themselves the mail.
os.environ["VITANOVA_SMTP_HOST"] = ""
# The suite registers and signs in far more often than any real user would, and
# shares one client across the session. The limiters get their own tests, which
# turn them back on deliberately.
os.environ["VITANOVA_RATE_LIMIT_ENABLED"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.main import app  # noqa: E402


# --------------------------------------------------------------------------- #
# A scripted Gemini
#
# No test in this suite may reach the real API: it costs quota, needs a key
# nobody has in CI, and cannot be made to return a 503 on demand. Everything
# that would call Gemini goes through app.services.gemini, so replacing that
# module's client covers import *and* the AI writing tools.
# --------------------------------------------------------------------------- #


class _FakeResponse:
    def __init__(self, text):
        self.text = text


class _FakeClient:
    """Replays a scripted list of outcomes, one per generate_content call."""

    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0
        self.configs = []
        client = self

        class _Models:
            async def generate_content(self, **kwargs):
                client.calls += 1
                client.configs.append(kwargs.get("config"))
                outcome = client.outcomes.pop(0)
                if isinstance(outcome, Exception):
                    raise outcome
                return _FakeResponse(outcome)

        self.aio = type("_Aio", (), {"models": _Models()})()


@pytest.fixture
def fake_gemini(monkeypatch):
    """Installs a scripted Gemini and removes the retry delay.

    Call the returned function with one outcome per expected round trip: a
    string to answer with, or an exception to raise.
    """
    from app.services import gemini

    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(gemini, "RETRY_DELAY_SECONDS", 0)

    def install(*outcomes):
        fake = _FakeClient(outcomes)
        monkeypatch.setattr(gemini.genai, "Client", lambda **_: fake)
        return fake

    return install


def api_error(code: int):
    """A google-genai APIError with the given status, for scripting failures."""
    from google.genai import errors

    cls = errors.ServerError if code >= 500 else errors.ClientError
    return cls(code, {"error": {"code": code, "message": "boom"}}, None)


@pytest.fixture(scope="session")
def client():
    # The context manager runs the app lifespan, so Mongo connects and the
    # template registry loads exactly as it does in production.
    with TestClient(app) as test_client:
        yield test_client

    from pymongo import MongoClient

    with MongoClient(settings.mongo_uri) as cleanup:
        cleanup.drop_database(settings.mongo_db)


def last_link(to: str) -> str:
    """The URL from the most recent mail sent to an address.

    SMTP is unconfigured under test, so app.services.email_service files
    messages in its outbox instead of sending them. Reading the link back out is
    how a test gets hold of a token that otherwise only exists in an inbox.
    """
    from app.services import email_service

    for message in reversed(email_service.outbox):
        if message.to == to:
            match = re.search(r"https?://\S+", message.text)
            assert match, f"no link in mail to {to}: {message.text}"
            return match.group(0)
    raise AssertionError(f"no mail was sent to {to}")


def token_from_link(link: str) -> str:
    return parse_qs(urlparse(link).query)["token"][0]


def register(client, email: str | None = None, password: str = "correct horse 42") -> dict:
    """Creates a *verified* account and returns {'headers', 'user', 'tokens'}.

    Registration alone no longer yields tokens — the address has to be confirmed
    first — so this walks the verification link the way a real user would.
    """
    email = email or f"user-{uuid.uuid4().hex[:10]}@example.com"
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Test Person"},
    )
    assert response.status_code == 201, response.text

    verified = client.post(
        "/api/v1/auth/verify-email",
        json={"token": token_from_link(last_link(email))},
    )
    assert verified.status_code == 200, verified.text
    body = verified.json()
    return {
        "headers": {"Authorization": f"Bearer {body['tokens']['access_token']}"},
        "user": body["user"],
        "tokens": body["tokens"],
        "email": email,
        "password": password,
    }


@pytest.fixture
def account(client) -> dict:
    return register(client)
