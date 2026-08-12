"""Verification of Google Sign-In ID tokens.

The browser runs Google Identity Services and hands us the resulting ID token —
an RS256 JWT signed by Google. We check that signature against Google's
published keys rather than calling a tokeninfo endpoint per login, and we check
the audience, because a valid Google token minted for *somebody else's* app is
exactly the thing an attacker would present.

PyJWT is already a dependency and does all of this, so there is no need to pull
in google-auth (and its own HTTP stack) for one function.
"""

import logging
from dataclasses import dataclass

import anyio
import jwt
from jwt import PyJWKClient

from app.core.config import settings

logger = logging.getLogger(__name__)

_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
_ISSUERS = ("https://accounts.google.com", "accounts.google.com")

_jwks_client: PyJWKClient | None = None


class GoogleAuthError(Exception):
    """The presented credential is not a usable Google identity."""


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    full_name: str


def is_enabled() -> bool:
    return bool(settings.google_client_id)


def _client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        # Caches the key set and re-fetches only when Google rotates, so this is
        # one HTTP call every few minutes at most rather than one per sign-in.
        _jwks_client = PyJWKClient(_CERTS_URL, cache_keys=True, lifespan=3600)
    return _jwks_client


def _verify_sync(credential: str) -> dict:
    signing_key = _client().get_signing_key_from_jwt(credential)
    return jwt.decode(
        credential,
        signing_key.key,
        algorithms=["RS256"],
        audience=settings.google_client_id,
        issuer=list(_ISSUERS),
        options={"require": ["exp", "iat", "sub", "aud", "iss"]},
    )


async def verify(credential: str) -> GoogleIdentity:
    """Validate an ID token and return who it belongs to.

    Raises :class:`GoogleAuthError` for anything we will not sign in.
    """
    if not is_enabled():
        raise GoogleAuthError("Google sign-in is not configured on this server")

    try:
        # Key fetching and RSA verification are blocking; keep them off the loop.
        claims = await anyio.to_thread.run_sync(_verify_sync, credential)
    except jwt.PyJWTError as exc:
        raise GoogleAuthError("Google sign-in could not be verified") from exc
    except Exception as exc:  # network trouble reaching Google's key set
        logger.exception("Google key verification failed")
        raise GoogleAuthError("Could not reach Google to verify your sign-in") from exc

    email = (claims.get("email") or "").lower()
    if not email:
        raise GoogleAuthError("That Google account has no email address")
    if not claims.get("email_verified"):
        # Without this the flow would be a way to claim an address you do not
        # own, which is precisely what the rest of this feature exists to stop.
        raise GoogleAuthError("That Google account's email address is not verified")

    return GoogleIdentity(
        sub=claims["sub"],
        email=email,
        full_name=(claims.get("name") or "").strip(),
    )
