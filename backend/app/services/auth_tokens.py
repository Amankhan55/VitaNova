"""Single-use, emailed tokens for address verification and password resets.

The plaintext token exists only in the mail we send: the database keeps a
SHA-256 of it, exactly as ``refresh_tokens`` does, so a leaked dump cannot be
replayed against these endpoints. Tokens are consumed by deletion, and a TTL
index sweeps up the ones nobody ever clicks.
"""

from datetime import UTC, datetime, timedelta
from typing import Literal

from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import settings
from app.core.security import fingerprint, new_token

Purpose = Literal["verify", "reset"]

_TTL: dict[Purpose, timedelta] = {
    "verify": timedelta(hours=settings.email_verification_ttl_hours),
    "reset": timedelta(minutes=settings.password_reset_ttl_minutes),
}


async def issue(db: AsyncDatabase, user_id: str, purpose: Purpose) -> str | None:
    """Mint a token, or return ``None`` if one was issued moments ago.

    The cooldown is what stops "resend" from being turned into a mailbomb aimed
    at somebody else's inbox.
    """
    now = datetime.now(UTC)
    recent = await db.email_tokens.find_one(
        {
            "user_id": user_id,
            "purpose": purpose,
            "created_at": {
                "$gt": now - timedelta(seconds=settings.email_resend_cooldown_seconds)
            },
        }
    )
    if recent is not None:
        return None

    # Only the newest link should work; a user who clicks resend twice and then
    # opens the first mail would otherwise be verifying against a stale token.
    await db.email_tokens.delete_many({"user_id": user_id, "purpose": purpose})

    token = new_token()
    await db.email_tokens.insert_one(
        {
            "token_hash": fingerprint(token),
            "user_id": user_id,
            "purpose": purpose,
            "expires_at": now + _TTL[purpose],
            "created_at": now,
        }
    )
    return token


async def consume(db: AsyncDatabase, token: str, purpose: Purpose) -> str | None:
    """Spend a token and return the user id it was issued to, or ``None``.

    Deleting as part of the lookup makes this atomic: two concurrent clicks on
    the same link cannot both succeed.
    """
    doc = await db.email_tokens.find_one_and_delete(
        {"token_hash": fingerprint(token), "purpose": purpose}
    )
    if doc is None:
        return None
    # The TTL monitor only runs about once a minute, so an expired token can
    # still be sitting there. Enforce the deadline ourselves.
    if doc["expires_at"] < datetime.now(UTC):
        return None
    return doc["user_id"]


async def revoke_all(db: AsyncDatabase, user_id: str, purpose: Purpose) -> None:
    await db.email_tokens.delete_many({"user_id": user_id, "purpose": purpose})
