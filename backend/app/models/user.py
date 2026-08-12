from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.security import new_id


class UserDoc(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(default_factory=new_id)
    email: EmailStr
    full_name: str = ""
    # None for accounts created through Google, which have no password to hash.
    # Such an account gains one only by going through the reset-password flow.
    password_hash: str | None = None
    email_verified: bool = False
    # Google's stable per-user identifier ("sub"). Matched ahead of the email so
    # the link survives the user changing their Google address.
    google_sub: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
