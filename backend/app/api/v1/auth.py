from datetime import UTC, datetime

import jwt
from fastapi import APIRouter, HTTPException, status
from pymongo.errors import DuplicateKeyError

from app.api.deps import CurrentUser, DbDep
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
    AuthResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
    UserPublic,
)

router = APIRouter(prefix="/auth", tags=["auth"])


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
    return UserPublic(id=user.id, email=user.email, full_name=user.full_name)


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: DbDep) -> AuthResponse:
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
    return AuthResponse(user=_public(user), tokens=await _issue_tokens(db, user.id))


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, db: DbDep) -> AuthResponse:
    doc = await db.users.find_one({"email": payload.email.lower()})
    # Same message either way so the endpoint does not reveal which emails exist.
    if doc is None or not verify_password(payload.password, doc["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    doc = dict(doc)
    doc["id"] = doc.pop("_id")
    user = UserDoc(**doc)
    return AuthResponse(user=_public(user), tokens=await _issue_tokens(db, user.id))


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
