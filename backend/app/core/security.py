"""Password hashing and JWT issuing.

Uses ``bcrypt`` directly rather than passlib, which is unmaintained and breaks
against bcrypt 4.x.
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import bcrypt
import jwt

from app.core.config import settings

# bcrypt silently truncates at 72 bytes; reject longer input rather than let two
# different passwords authenticate the same account.
MAX_PASSWORD_BYTES = 72


def hash_password(password: str) -> str:
    pw = password.encode("utf-8")
    if len(pw) > MAX_PASSWORD_BYTES:
        raise ValueError("Password must be at most 72 bytes")
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def _create_token(
    subject: str, token_type: Literal["access", "refresh"], ttl: timedelta
) -> tuple[str, datetime]:
    now = datetime.now(UTC)
    expires_at = now + ttl
    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expires_at


def create_access_token(subject: str) -> tuple[str, datetime]:
    return _create_token(
        subject, "access", timedelta(minutes=settings.access_token_ttl_minutes)
    )


def create_refresh_token(subject: str) -> tuple[str, datetime]:
    return _create_token(
        subject, "refresh", timedelta(days=settings.refresh_token_ttl_days)
    )


def decode_token(token: str, expected_type: Literal["access", "refresh"]) -> dict:
    """Decode and validate a JWT. Raises ``jwt.PyJWTError`` when invalid."""
    payload = jwt.decode(
        token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
    )
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError(f"Expected a {expected_type} token")
    return payload


def fingerprint(token: str) -> str:
    """Stable hash used to store refresh tokens so they can be revoked.

    Refresh tokens are high-entropy JWTs, so a plain SHA-256 is appropriate here
    (unlike passwords, there is nothing to brute-force).
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_id() -> str:
    return secrets.token_hex(8)


def new_token() -> str:
    """An unguessable value for an emailed link. URL-safe so it survives being
    pasted out of a mail client."""
    return secrets.token_urlsafe(32)
