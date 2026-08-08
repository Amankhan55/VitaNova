from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pymongo.asynchronous.database import AsyncDatabase

from app.core import db as db_module
from app.core.security import decode_token
from app.models.user import UserDoc

bearer_scheme = HTTPBearer(auto_error=False)


def get_db() -> AsyncDatabase:
    return db_module.get_database()


DbDep = Annotated[AsyncDatabase, Depends(get_db)]

_CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    db: DbDep,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
    ] = None,
) -> UserDoc:
    if credentials is None:
        raise _CREDENTIALS_ERROR
    try:
        payload = decode_token(credentials.credentials, "access")
    except jwt.PyJWTError:
        raise _CREDENTIALS_ERROR from None

    doc = await db.users.find_one({"_id": payload.get("sub")})
    if doc is None:
        raise _CREDENTIALS_ERROR
    doc = dict(doc)
    doc["id"] = doc.pop("_id")
    return UserDoc(**doc)


CurrentUser = Annotated[UserDoc, Depends(get_current_user)]
