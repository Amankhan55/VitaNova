"""A small in-process rate limiter for the endpoints that cost something.

Written here rather than pulled in as a dependency for the same reason
``security.py`` uses bcrypt directly: the whole mechanism is forty lines, and
the alternative libraries' default backends are in-memory too, so a dependency
would buy no extra correctness at this scale.

**Scope is one process.** The API runs a single uvicorn worker (see the
Dockerfile), so process-local *is* app-wide today. Run more than one worker and
each gets its own counters, multiplying every limit below by the worker count --
at which point the counters belong in Mongo or Redis instead.

**What the keys are, and why.** The deployed frontend reaches this API through a
Vercel rewrite, so requests arrive from Vercel's network and ``request.client``
is never the end user. That makes the client address the wrong key for anything
protecting a specific account: every user in the world would share one bucket
and the first attacker would lock out everybody.

So the limits that matter are keyed by **the address being attacked**:

  * ``login`` -- guesses against one email. Brute-forcing an account means
    sending that account's address, so the key cannot be evaded by the attack
    it is meant to stop, and one victim's bucket never affects another user.
  * ``email_send`` -- mail sent to one address, so a reset-link flood aimed at
    somebody's inbox stops at ``email_send_max``.

``register`` is the exception: an attacker varies the address every time, so
there is nothing account-shaped to key on and it falls back to the client
address from ``X-Forwarded-For``. That header is set by whatever proxy sits in
front and can be forged by anyone talking to the origin directly, so this one is
best-effort -- a speed bump on casual sign-up spam, not a control to rely on. An
edge rate limit (Vercel's WAF, Cloudflare) is the right place to do it properly.
"""

import time
from collections import deque

from fastapi import HTTPException, Request, status

from app.core.config import settings

# Sweep expired buckets once the map passes this size. Without it, an attacker
# cycling through addresses would grow the dict without bound -- which is the
# memory exhaustion the limiter exists to prevent, arriving by another door.
_SWEEP_THRESHOLD = 4096


class RateLimiter:
    """A sliding window over the last ``window`` seconds, per key.

    Sliding rather than fixed-window: a fixed window lets a caller spend its
    whole allowance at 11:59:59 and the next one at 12:00:00, landing twice the
    limit back to back.
    """

    def __init__(self, limit: int, window: int, message: str) -> None:
        self.limit = limit
        self.window = window
        self.message = message
        self._hits: dict[str, deque[float]] = {}

    def _sweep(self, now: float) -> None:
        cutoff = now - self.window
        for key, hits in list(self._hits.items()):
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if not hits:
                del self._hits[key]

    def check(self, key: str) -> None:
        """Record one attempt against ``key``; raise 429 if it is over budget."""
        if not settings.rate_limit_enabled:
            return

        now = time.monotonic()
        if len(self._hits) > _SWEEP_THRESHOLD:
            self._sweep(now)

        hits = self._hits.setdefault(key, deque())
        cutoff = now - self.window
        while hits and hits[0] <= cutoff:
            hits.popleft()

        if len(hits) >= self.limit:
            # Seconds until the oldest hit falls out of the window, which is when
            # a retry can actually succeed.
            retry_after = max(1, int(hits[0] + self.window - now) + 1)
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail=self.message,
                headers={"Retry-After": str(retry_after)},
            )

        hits.append(now)

    def reset(self, key: str) -> None:
        """Forget a key's history. Called after a successful login so a user who
        mistyped their password four times is not still near the limit."""
        self._hits.pop(key, None)

    def clear(self) -> None:
        self._hits.clear()


login_limiter = RateLimiter(
    settings.login_max_attempts,
    settings.login_window_seconds,
    "Too many sign-in attempts for this account. Please wait and try again.",
)

email_limiter = RateLimiter(
    settings.email_send_max,
    settings.email_send_window_seconds,
    "Too many emails requested for this address. Please wait and try again.",
)

register_limiter = RateLimiter(
    settings.register_max,
    settings.register_window_seconds,
    "Too many accounts created from here. Please wait and try again.",
)


def client_key(request: Request) -> str:
    """Best-effort client address. See the module docstring on why this is only
    used for sign-up, and why it cannot be trusted the way the email keys can."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        # Leftmost entry is the original client; the rest are proxies that
        # appended themselves on the way here.
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def reset_all() -> None:
    """Drop every limiter's state. For tests."""
    for limiter in (login_limiter, email_limiter, register_limiter):
        limiter.clear()
