from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.security import new_id


class UserDoc(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(default_factory=new_id)
    email: EmailStr
    full_name: str = ""
    password_hash: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
