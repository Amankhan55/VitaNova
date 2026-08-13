"""MongoDB connection lifecycle.

Uses PyMongo's native async driver (``AsyncMongoClient``). Motor is EOL and its
functionality now lives in PyMongo itself, so there is no reason to add it.
"""

import logging

from pymongo import ASCENDING, DESCENDING, AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.core.config import settings

logger = logging.getLogger(__name__)

# IndexKeySpecsConflict: same name, different definition.
_INDEX_CONFLICT = 86

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
    await _grandfather_existing_accounts(get_database())
    logger.info("Connected to MongoDB at %s/%s", settings.mongo_uri, settings.mongo_db)


async def disconnect() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None


async def _redefine_index(collection, name: str, keys: list, **options) -> None:
    """``create_index``, but tolerant of an index that already exists under the
    same name with *different* options.

    Mongo will not amend an index in place: it raises IndexKeySpecsConflict (86)
    and, without this, the app simply refuses to start against any database that
    saw an earlier definition. Dropping and recreating is safe — an index holds
    no data of its own.
    """
    try:
        await collection.create_index(keys, name=name, **options)
    except OperationFailure as exc:
        if exc.code != _INDEX_CONFLICT:
            raise
        logger.info("Rebuilding index %s.%s with its current definition", collection.name, name)
        await collection.drop_index(name)
        await collection.create_index(keys, name=name, **options)


async def _grandfather_existing_accounts(db: AsyncDatabase) -> None:
    """Mark pre-verification accounts as verified.

    Sign-in now requires a confirmed address. Accounts created before that rule
    existed have no ``email_verified`` field at all — every user document
    written since carries one — so the field's absence unambiguously means "made
    under the old rules", and the alternative is locking those people out of
    their own resumes over a policy they were never asked about.

    Idempotent, and matches nothing on every boot after the first.
    """
    result = await db.users.update_many(
        {"email_verified": {"$exists": False}}, {"$set": {"email_verified": True}}
    )
    if result.modified_count:
        logger.info(
            "Marked %d pre-existing account(s) as email-verified", result.modified_count
        )


async def _ensure_indexes(db: AsyncDatabase) -> None:
    await db.users.create_index([("email", ASCENDING)], unique=True)
    # Partial rather than sparse: password accounts store google_sub as null,
    # and a sparse index skips only *missing* fields — so the second such
    # account would collide on the shared null. An earlier build of this index
    # *was* sparse, which is why it goes through _redefine_index.
    await _redefine_index(
        db.users,
        "google_sub_1",
        [("google_sub", ASCENDING)],
        unique=True,
        partialFilterExpression={"google_sub": {"$type": "string"}},
    )
    await db.resumes.create_index([("owner_id", ASCENDING)])
    # Backs the dashboard listing: a user's resumes, most recently edited first.
    await db.resumes.create_index([("owner_id", ASCENDING), ("updated_at", DESCENDING)])
    # Backs the gallery's "your designs" list: one user's templates, newest first.
    await db.custom_templates.create_index(
        [("owner_id", ASCENDING), ("updated_at", DESCENDING)]
    )
    # Refresh tokens expire on their own so revoked/stale sessions self-clean.
    await db.refresh_tokens.create_index([("token_hash", ASCENDING)], unique=True)
    await db.refresh_tokens.create_index("expires_at", expireAfterSeconds=0)
    # Emailed verification / password-reset links: looked up by hash, cleaned up
    # per user, and swept once they lapse.
    await db.email_tokens.create_index([("token_hash", ASCENDING)], unique=True)
    await db.email_tokens.create_index([("user_id", ASCENDING), ("purpose", ASCENDING)])
    await db.email_tokens.create_index("expires_at", expireAfterSeconds=0)
