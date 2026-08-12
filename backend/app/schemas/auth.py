from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    full_name: str = ""


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)


class RefreshRequest(BaseModel):
    refresh_token: str


class EmailRequest(BaseModel):
    """Used by both resend-verification and forgot-password."""

    email: EmailStr


class VerifyEmailRequest(BaseModel):
    token: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=72)


class GoogleLoginRequest(BaseModel):
    # The ID token from Google Identity Services' credential response.
    credential: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_at: datetime


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    full_name: str = ""
    email_verified: bool = False


class AuthResponse(BaseModel):
    user: UserPublic
    tokens: TokenPair


class MessageResponse(BaseModel):
    """A plain acknowledgement, used where saying anything more would leak
    whether an address is registered."""

    message: str


class AuthProviders(BaseModel):
    """What the server supports, so the UI can render itself accordingly."""

    google_client_id: str = ""
