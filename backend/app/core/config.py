from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"


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

    jwt_secret: str = "dev-only-secret-change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 30
    refresh_token_ttl_days: int = 7

    cors_origins: list[str] = [
        "http://localhost:4200",
        "http://127.0.0.1:4200",
    ]

    # Maximum resumes a single account may hold, a cheap guard against runaway writes.
    max_resumes_per_user: int = 50


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
