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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def check_production_config() -> None:
    """Refuse to start a non-debug deployment that is still signing with the
    shipped secret.

    Every JWT this app issues would be forgeable by anyone who has read the
    repository. Called from the app lifespan rather than at import time, so the
    failure arrives as a clear startup error instead of a stack trace during
    module loading.
    """
    if settings.debug:
        return
    if settings.jwt_secret == DEFAULT_JWT_SECRET:
        raise RuntimeError(
            "VITANOVA_JWT_SECRET is still the default value. Set a real secret "
            "before running with VITANOVA_DEBUG=false:\n"
            '  python -c "import secrets; print(secrets.token_urlsafe(48))"'
        )
