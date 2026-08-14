"""A ceiling on request body size for the endpoints that feed the renderer.

The field-level caps in ``models/resume.py`` bound any *single* value, but not
how many of them one request may carry: thirty sections of sixty items of forty
bullets is within every individual limit and still describes a document no
person has ever written. This is the outer bound that makes the inner ones add
up to something small.

Implemented as raw ASGI rather than ``BaseHTTPMiddleware`` because the check has
to happen *before* the body is buffered. A dependency, or anything that reads
``await request.body()``, has already accepted the bytes by the time it can
object -- and accepting them is the attack, on an instance with 512 MB of RAM.

Two checks, because either one alone has a hole:

  * ``Content-Length``, when declared, is refused up front without reading a
    byte. This is the case that matters for an honest client and for the
    ordinary flood.
  * The stream is counted as it arrives, which covers a chunked request that
    declares no length at all, and one that declares a small length and then
    sends more.
"""

import json

from fastapi import HTTPException, status
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Paths whose bodies are resume JSON, and therefore end up in front of Jinja and
# WeasyPrint. Matched as prefixes.
GUARDED_PREFIXES = ("/api/v1/render", "/api/v1/resumes")

# A PDF upload, capped separately by import_service.MAX_PDF_SIZE. It would
# otherwise be caught by the /api/v1/resumes prefix above.
EXEMPT_PREFIXES = ("/api/v1/resumes/import",)


class _BodyTooLarge(HTTPException):
    """Raised out of ``receive`` once the incoming stream passes the limit.

    An ``HTTPException`` specifically, and not a bare exception: FastAPI wraps
    body reading in ``except Exception`` and rewrites whatever it catches into
    "400 There was an error parsing the body", which would bury the real reason.
    It re-raises ``HTTPException`` untouched -- there is a comment in
    ``fastapi/routing.py`` saying that exists for middleware doing exactly this
    -- so the 413 survives and is rendered by the normal exception handler.
    """

    def __init__(self, max_bytes: int) -> None:
        super().__init__(
            status.HTTP_413_CONTENT_TOO_LARGE, detail=_detail(max_bytes)
        )


def _detail(max_bytes: int) -> str:
    return f"Request body too large (max {max_bytes // 1024} KB)."


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    def _guards(self, scope: Scope) -> bool:
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "DELETE"):
            return False
        path = scope["path"]
        if path.startswith(EXEMPT_PREFIXES):
            return False
        return path.startswith(GUARDED_PREFIXES)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not self._guards(scope):
            await self.app(scope, receive, send)
            return

        declared = Headers(scope=scope).get("content-length")
        if declared and declared.isdigit() and int(declared) > self.max_bytes:
            await self._refuse(send)
            return

        received = 0

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLarge(self.max_bytes)
            return message

        try:
            await self.app(scope, counting_receive, send)
        except _BodyTooLarge:
            # Normally unreachable: the app's exception handler turns this into a
            # 413 response before it gets here. It survives as the answer for any
            # route that is not a FastAPI endpoint and so has no such handler.
            await self._refuse(send)

    async def _refuse(self, send: Send) -> None:
        body = json.dumps({"detail": _detail(self.max_bytes)}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
