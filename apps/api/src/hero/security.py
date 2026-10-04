"""Local host and session-token checks for /api routes."""

import re
import secrets

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

_LOCAL_HOST = re.compile(r"^(127\.0\.0\.1|localhost)(:\d+)?$")


def is_local_host(host: str) -> bool:
    """True when Host is loopback, with or without a port."""
    return _LOCAL_HOST.fullmatch(host.strip().lower()) is not None


def token_matches(provided: str | None, expected: str) -> bool:
    """Compare tokens without raising when the lengths differ."""
    if provided is None or len(provided) != len(expected):
        return False
    return secrets.compare_digest(provided, expected)


class LocalSecurityMiddleware:
    """Reject a foreign Host, and require X-Hero-Token on protected API routes."""

    def __init__(self, app: ASGIApp, token: str) -> None:
        self.app = app
        self.token = token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        if not is_local_host(request.headers.get("host", "")):
            response = JSONResponse({"detail": "Host is not local."}, status_code=400)
            await response(scope, receive, send)
            return

        path = request.url.path
        if path.startswith("/api") and not _is_public_health(request.method, path):
            provided = request.headers.get("x-hero-token")
            if not token_matches(provided, self.token):
                response = JSONResponse({"detail": "Unauthorized"}, status_code=401)
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)


def _is_public_health(method: str, path: str) -> bool:
    return method == "GET" and path == "/api/health"
