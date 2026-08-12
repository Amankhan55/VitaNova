from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"

DEFAULT_JWT_SECRET = "dev-only-secret-change-me-in-production"


class Settings(BaseSettings):
    """Application settings, overridable via a .env file or VITANOVA_* env vars."""

    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="VITANOVA_", extra="ignore"
    )

    app_name: str = "VitaNova"
    api_v1_prefix: str = "/api/v1"
    debug: bool = True

    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "vitanova"

    jwt_secret: str = DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 30
    refresh_token_ttl_days: int = 7

    # Where the browser app lives. Verification and password-reset links are
    # built against this, so it must be the public URL in a deployment.
    frontend_base_url: str = "http://localhost:4200"

    email_verification_ttl_hours: int = 24
    password_reset_ttl_minutes: int = 60
    # Refuse to mint a second token of the same purpose within this window, so
    # "resend" cannot be used to mailbomb an address.
    email_resend_cooldown_seconds: int = 60

    # SMTP. Leave smtp_host empty and mail is written to the log instead of
    # sent -- local development works with no mail account at all.
    #   Gmail: smtp.gmail.com:587 with an App Password (not the login password).
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True  # False when talking to an implicit-TLS port (465)
    smtp_from: str = "VitaNova <no-reply@vitanova.app>"

    # OAuth client ID from the Google Cloud console. Empty disables the Google
    # button in the UI, which is how the app behaves when nobody set one up.
    google_client_id: str = ""

    cors_origins: list[str] = [
        "http://localhost:4200",
        "http://127.0.0.1:4200",
    ]
    # Only needed when the browser talks to this API cross-origin. The deployed
    # setup proxies /api through Vercel, so the request reaches us same-origin
    # and no CORS entry is required at all. Set this if you point the frontend
    # straight at the API instead -- Vercel preview deployments get a fresh
    # hostname each time, which a literal origin list cannot keep up with, e.g.
    #   VITANOVA_CORS_ORIGIN_REGEX=https://.*\.vercel\.app
    cors_origin_regex: str | None = None

    # Maximum resumes a single account may hold, a cheap guard against runaway writes.
    max_resumes_per_user: int = 50

    # Google Gemini API key for resume import (free tier: 15 req/min, 1M tokens/day).
    # Get one at https://aistudio.google.com
    gemini_api_key: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def check_production_config() -> None:
    """Refuse to start a non-debug deployment that cannot be used safely.

    Called from the app lifespan rather than at import time, so a failure
    arrives as a clear startup error instead of a stack trace during module
    loading.
    """
    if settings.debug:
        return
    if settings.jwt_secret == DEFAULT_JWT_SECRET:
        # Every JWT this app issues would be forgeable by anyone who has read
        # the repository.
        raise RuntimeError(
            "VITANOVA_JWT_SECRET is still the default value. Set a real secret "
            "before running with VITANOVA_DEBUG=false:\n"
            '  python -c "import secrets; print(secrets.token_urlsafe(48))"'
        )
    if not settings.smtp_host:
        # Sign-in requires a verified address, so with nowhere to send the
        # verification link every new account would be stranded at registration.
        raise RuntimeError(
            "VITANOVA_SMTP_HOST is not set. Accounts cannot be verified without "
            "outbound mail, which leaves every new sign-up unable to log in."
        )
