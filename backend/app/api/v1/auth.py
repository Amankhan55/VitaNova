from datetime import UTC, datetime
from urllib.parse import quote

import jwt
from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.api.deps import CurrentUser, DbDep
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    fingerprint,
    hash_password,
    verify_password,
)
from app.models.user import UserDoc
from app.schemas.auth import (
    AuthProviders,
    AuthResponse,
    EmailRequest,
    GoogleLoginRequest,
    LoginRequest,
    MessageResponse,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenPair,
    UserPublic,
    VerifyEmailRequest,
)
from app.services import auth_tokens, email_service, google_oauth

router = APIRouter(prefix="/auth", tags=["auth"])

# Said to everyone who asks for a link, whether or not we sent one. Anything
# more specific turns these endpoints into a way to test which addresses have
# accounts here.
_SENT_IF_EXISTS = "If that address has an account, we have sent it an email."


async def _issue_tokens(db, user_id: str) -> TokenPair:
    access_token, access_expires = create_access_token(user_id)
    refresh_token, refresh_expires = create_refresh_token(user_id)
    await db.refresh_tokens.insert_one(
        {
            "token_hash": fingerprint(refresh_token),
            "user_id": user_id,
            "expires_at": refresh_expires,
            "created_at": datetime.now(UTC),
        }
    )
    return TokenPair(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=access_expires,
    )


def _public(user: UserDoc) -> UserPublic:
    return UserPublic(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        email_verified=user.email_verified,
    )


def _to_user(doc: dict) -> UserDoc:
    doc = dict(doc)
    doc["id"] = doc.pop("_id")
    return UserDoc(**doc)


async def _find_by_email(db: AsyncDatabase, email: str) -> UserDoc | None:
    doc = await db.users.find_one({"email": email.lower()})
    return _to_user(doc) if doc else None


def _link(path: str, token: str) -> str:
    return f"{settings.frontend_base_url.rstrip('/')}/{path}?token={quote(token)}"


async def _send_verification(db: AsyncDatabase, user: UserDoc) -> None:
    """Mint and mail a fresh confirmation link. Silently does nothing while the
    resend cooldown is in effect."""
    token = await auth_tokens.issue(db, user.id, "verify")
    if token is None:
        return
    await email_service.send_verification(
        to=user.email,
        name=user.full_name,
        link=_link("verify-email", token),
        ttl_hours=settings.email_verification_ttl_hours,
    )


# ------------------------------------------------------------------ discovery


@router.get("/providers", response_model=AuthProviders)
async def providers() -> AuthProviders:
    """Lets the browser app learn the Google client ID at runtime instead of
    baking it into the bundle at build time."""
    return AuthProviders(google_client_id=settings.google_client_id)


# ----------------------------------------------------------- password sign-in


@router.post(
    "/register", response_model=MessageResponse, status_code=status.HTTP_201_CREATED
)
async def register(
    payload: RegisterRequest, db: DbDep, background: BackgroundTasks
) -> MessageResponse:
    user = UserDoc(
        email=payload.email.lower(),
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
    )
    doc = user.model_dump()
    doc["_id"] = doc.pop("id")
    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email already exists",
        ) from None

    # No tokens here: the account cannot sign in until the address is confirmed.
    background.add_task(_send_verification, db, user)
    return MessageResponse(
        message="Check your email for a link to confirm your address."
    )


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, db: DbDep) -> AuthResponse:
    user = await _find_by_email(db, payload.email)
    # Same message either way so the endpoint does not reveal which emails
    # exist. A Google-only account has no hash and lands here too.
    if (
        user is None
        or user.password_hash is None
        or not verify_password(payload.password, user.password_hash)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    if not user.email_verified:
        # Deliberately after the password check: an unverified-account response
        # to an attacker who does not know the password would confirm the
        # address is registered.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Confirm your email address before signing in.",
        )
    return AuthResponse(user=_public(user), tokens=await _issue_tokens(db, user.id))


# ------------------------------------------------------------- email verifying


@router.post("/verify-email", response_model=AuthResponse)
async def verify_email(payload: VerifyEmailRequest, db: DbDep) -> AuthResponse:
    user_id = await auth_tokens.consume(db, payload.token, "verify")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That confirmation link is invalid or has expired.",
        )
    doc = await db.users.find_one_and_update(
        {"_id": user_id},
        {"$set": {"email_verified": True}},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That account no longer exists.",
        )
    # Signing them straight in saves a pointless trip through the login form —
    # they have just proved they own the address.
    user = _to_user(doc)
    return AuthResponse(user=_public(user), tokens=await _issue_tokens(db, user.id))


@router.post(
    "/resend-verification",
    response_model=MessageResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def resend_verification(
    payload: EmailRequest, db: DbDep, background: BackgroundTasks
) -> MessageResponse:
    user = await _find_by_email(db, payload.email)
    if user is not None and not user.email_verified:
        background.add_task(_send_verification, db, user)
    return MessageResponse(message=_SENT_IF_EXISTS)


# ------------------------------------------------------------- password resets


@router.post(
    "/forgot-password",
    response_model=MessageResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def forgot_password(
    payload: EmailRequest, db: DbDep, background: BackgroundTasks
) -> MessageResponse:
    user = await _find_by_email(db, payload.email)
    if user is not None:
        background.add_task(_send_reset, db, user)
    return MessageResponse(message=_SENT_IF_EXISTS)


async def _send_reset(db: AsyncDatabase, user: UserDoc) -> None:
    token = await auth_tokens.issue(db, user.id, "reset")
    if token is None:
        return
    await email_service.send_password_reset(
        to=user.email,
        name=user.full_name,
        link=_link("reset-password", token),
        ttl_minutes=settings.password_reset_ttl_minutes,
    )


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(payload: ResetPasswordRequest, db: DbDep) -> None:
    user_id = await auth_tokens.consume(db, payload.token, "reset")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That reset link is invalid or has expired.",
        )
    result = await db.users.update_one(
        {"_id": user_id},
        {
            "$set": {
                "password_hash": hash_password(payload.password),
                # Receiving the mail proves the address, so an account that
                # never confirmed is no longer stuck after a reset.
                "email_verified": True,
            }
        },
    )
    if result.matched_count != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That account no longer exists.",
        )
    # Whoever prompted the reset may have had the old password. Drop every
    # session and any outstanding confirmation link.
    await db.refresh_tokens.delete_many({"user_id": user_id})
    await auth_tokens.revoke_all(db, user_id, "verify")


# ----------------------------------------------------------------- Google auth


@router.post("/google", response_model=AuthResponse)
async def google_login(payload: GoogleLoginRequest, db: DbDep) -> AuthResponse:
    try:
        identity = await google_oauth.verify(payload.credential)
    except google_oauth.GoogleAuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        ) from None

    doc = await db.users.find_one({"google_sub": identity.sub})
    if doc is not None:
        return await _signed_in(db, _to_user(doc))

    existing = await _find_by_email(db, identity.email)
    if existing is not None:
        # Same address, first time through Google: attach the identity to the
        # account they already have. Safe because Google told us the address is
        # verified, so this is the same person either way.
        await db.users.update_one(
            {"_id": existing.id},
            {"$set": {"google_sub": identity.sub, "email_verified": True}},
        )
        existing.google_sub = identity.sub
        existing.email_verified = True
        return await _signed_in(db, existing)

    user = UserDoc(
        email=identity.email,
        full_name=identity.full_name,
        google_sub=identity.sub,
        email_verified=True,
    )
    doc = user.model_dump()
    doc["_id"] = doc.pop("id")
    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        # Lost a race with a concurrent sign-up for the same address.
        winner = await _find_by_email(db, identity.email)
        if winner is None:
            raise
        return await _signed_in(db, winner)
    return await _signed_in(db, user)


async def _signed_in(db: AsyncDatabase, user: UserDoc) -> AuthResponse:
    return AuthResponse(user=_public(user), tokens=await _issue_tokens(db, user.id))


# --------------------------------------------------------------- session admin


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, db: DbDep) -> TokenPair:
    try:
        claims = decode_token(payload.refresh_token, "refresh")
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        ) from None

    # Rotation: the presented token is consumed here, so a stolen token is usable
    # at most once and only until the legitimate client next refreshes.
    consumed = await db.refresh_tokens.delete_one(
        {"token_hash": fingerprint(payload.refresh_token)}
    )
    if consumed.deleted_count != 1:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has already been used or revoked",
        )
    return await _issue_tokens(db, claims["sub"])


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, db: DbDep) -> None:
    await db.refresh_tokens.delete_one({"token_hash": fingerprint(payload.refresh_token)})


@router.get("/me", response_model=UserPublic)
async def me(user: CurrentUser) -> UserPublic:
    return _public(user)
