"""MongoDB connection lifecycle.

Uses PyMongo's native async driver (``AsyncMongoClient``). Motor is EOL and its
functionality now lives in PyMongo itself, so there is no reason to add it.
"""

import logging

from pymongo import ASCENDING, DESCENDING, AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import settings

logger = logging.getLogger(__name__)

_client: AsyncMongoClient | None = None


def get_client() -> AsyncMongoClient:
    if _client is None:
        raise RuntimeError("Mongo client not initialised; call connect() first")
    return _client


def get_database() -> AsyncDatabase:
    return get_client()[settings.mongo_db]


async def connect() -> None:
    """Open the connection pool and ensure indexes exist."""
    global _client
    if _client is not None:
        return

    kwargs = {}
    uri = settings.mongo_uri.lower()
    if "mongodb+srv://" in uri or "tls=true" in uri or "ssl=true" in uri:
        try:
            import certifi
            kwargs["tlsCAFile"] = certifi.where()
        except ImportError:
            pass

    _client = AsyncMongoClient(settings.mongo_uri, tz_aware=True, **kwargs)
    await _client.aconnect()
    await _ensure_indexes(get_database())
    logger.info("Connected to MongoDB at %s/%s", settings.mongo_uri, settings.mongo_db)


async def disconnect() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None


async def _ensure_indexes(db: AsyncDatabase) -> None:
    await db.users.create_index([("email", ASCENDING)], unique=True)
    await db.resumes.create_index([("owner_id", ASCENDING)])
    # Backs the dashboard listing: a user's resumes, most recently edited first.
    await db.resumes.create_index([("owner_id", ASCENDING), ("updated_at", DESCENDING)])
    # Refresh tokens expire on their own so revoked/stale sessions self-clean.
    await db.refresh_tokens.create_index([("token_hash", ASCENDING)], unique=True)
    await db.refresh_tokens.create_index("expires_at", expireAfterSeconds=0)
