"""Hosted Trimble Connect mode: configuration, token checks, and response guards.

Local mode lives in ``hero.security`` and is not touched by this module. Hosted mode is chosen
only when ``create_app`` receives a ``HostedConfig``. The Trimble access token is read from the
``Authorization`` header, checked, and dropped. It is never logged, stored, or returned.
"""

import logging
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import jwt
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("hero.hosted")

DEFAULT_FRAME_ANCESTOR = "https://web.connect.trimble.com"
MANIFEST_PATH = "/trimble/manifest.json"
MAX_TOKEN_LENGTH = 8192

# Routes that read or write this PC: the native dialog, the Credential Manager key, and links.
_LOCAL_ONLY_PREFIXES = ("/api/dialogs/",)
_LOCAL_ONLY_EXACT = ("/api/settings/cursor-key",)

_BEARER = re.compile(r"^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$")

KeyProvider = Callable[[str], Any]


class HostedConfigError(ValueError):
    """The hosted configuration is missing or unsafe. The message names settings, not values."""


def _csv(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(part.strip() for part in value.split(",") if part.strip())


def _https_origin(value: str) -> bool:
    parts = urlsplit(value)
    return (
        parts.scheme == "https"
        and bool(parts.hostname)
        and parts.path in ("", "/")
        and not parts.query
        and not parts.fragment
        and not parts.username
    )


def _origin(value: str) -> str:
    parts = urlsplit(value)
    return f"{parts.scheme}://{parts.netloc}"


@dataclass(frozen=True)
class HostedConfig:
    """Everything hosted mode needs. None of it is a secret."""

    public_url: str
    allowed_hosts: tuple[str, ...]
    issuer: str
    audience: str
    jwks_url: str
    cors_origins: tuple[str, ...] = ()
    frame_ancestors: tuple[str, ...] = (DEFAULT_FRAME_ANCESTOR,)
    algorithms: tuple[str, ...] = ("RS256",)

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "HostedConfig":
        """Read ``HERO_HOSTED_*`` and ``HERO_TRIMBLE_*``. Errors name the setting only."""
        required = {
            "HERO_HOSTED_PUBLIC_URL": env.get("HERO_HOSTED_PUBLIC_URL", "").strip(),
            "HERO_HOSTED_ALLOWED_HOSTS": env.get("HERO_HOSTED_ALLOWED_HOSTS", "").strip(),
            "HERO_TRIMBLE_ISSUER": env.get("HERO_TRIMBLE_ISSUER", "").strip(),
            "HERO_TRIMBLE_AUDIENCE": env.get("HERO_TRIMBLE_AUDIENCE", "").strip(),
            "HERO_TRIMBLE_JWKS_URL": env.get("HERO_TRIMBLE_JWKS_URL", "").strip(),
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise HostedConfigError("Missing hosted settings: " + ", ".join(missing))

        problems: list[str] = []
        public_url = required["HERO_HOSTED_PUBLIC_URL"]
        if not _https_origin(public_url):
            problems.append("HERO_HOSTED_PUBLIC_URL must be an https origin")
        if urlsplit(required["HERO_TRIMBLE_ISSUER"]).scheme != "https":
            problems.append("HERO_TRIMBLE_ISSUER must be an https URL")
        if urlsplit(required["HERO_TRIMBLE_JWKS_URL"]).scheme != "https":
            problems.append("HERO_TRIMBLE_JWKS_URL must be an https URL")

        hosts = _csv(required["HERO_HOSTED_ALLOWED_HOSTS"])
        if any("*" in host or "/" in host for host in hosts):
            problems.append("HERO_HOSTED_ALLOWED_HOSTS must list exact host names")

        cors = _csv(env.get("HERO_HOSTED_CORS_ORIGINS"))
        if any(not _https_origin(origin) for origin in cors):
            problems.append("HERO_HOSTED_CORS_ORIGINS must list https origins, no wildcard")

        ancestors = _csv(env.get("HERO_HOSTED_FRAME_ANCESTORS")) or (DEFAULT_FRAME_ANCESTOR,)
        if any(not _https_origin(origin) for origin in ancestors):
            problems.append("HERO_HOSTED_FRAME_ANCESTORS must list https origins")

        if problems:
            raise HostedConfigError("Unsafe hosted settings: " + "; ".join(problems))

        return cls(
            public_url=_origin(public_url),
            allowed_hosts=tuple(host.lower() for host in hosts),
            issuer=required["HERO_TRIMBLE_ISSUER"],
            audience=required["HERO_TRIMBLE_AUDIENCE"],
            jwks_url=required["HERO_TRIMBLE_JWKS_URL"],
            cors_origins=tuple(_origin(origin) for origin in cors),
            frame_ancestors=tuple(_origin(origin) for origin in ancestors),
        )


def jwks_key_provider(config: HostedConfig) -> KeyProvider:
    """Look up the signing key for a token in the issuer's JWKS. Keys are cached by PyJWT."""
    client = jwt.PyJWKClient(config.jwks_url, cache_keys=True, lifespan=3600, timeout=5)

    def provide(token: str) -> Any:
        return client.get_signing_key_from_jwt(token).key

    return provide


class TokenVerifier:
    """Check signature, issuer, audience, and expiry. Returns False for any failure."""

    def __init__(self, config: HostedConfig, key_provider: KeyProvider) -> None:
        self.config = config
        self.key_provider = key_provider

    def verify(self, token: str) -> bool:
        if len(token) > MAX_TOKEN_LENGTH:
            return False
        try:
            key = self.key_provider(token)
            jwt.decode(
                token,
                key,
                algorithms=list(self.config.algorithms),
                audience=self.config.audience,
                issuer=self.config.issuer,
                options={"require": ["exp", "iss", "aud"]},
                leeway=30,
            )
        except Exception:
            # Any failure is a rejection. The exception text is not logged: it can echo input.
            return False
        return True


def manifest(config: HostedConfig) -> dict[str, object]:
    """The Trimble Connect extension manifest. Public, and it holds no secret."""
    return {
        "title": "2D Hero",
        "description": "Editable metric floor plans from 3D scans and IFC models.",
        "url": f"{config.public_url}/",
        "icon": f"{config.public_url}/icon.png",
        "enabled": True,
        "extensionType": ["project"],
    }


class HostedSecurityMiddleware:
    """Host allow-list, bearer check on /api, closed local-only routes, and frame-ancestors."""

    def __init__(self, app: ASGIApp, config: HostedConfig, verifier: TokenVerifier) -> None:
        self.app = app
        self.config = config
        self.verifier = verifier
        self.policy = "frame-ancestors " + " ".join(config.frame_ancestors)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        send = self._with_policy(send)
        host = request.headers.get("host", "").strip().lower()
        if host.rsplit(":", 1)[0] not in self.config.allowed_hosts:
            await JSONResponse({"detail": "Host is not allowed."}, status_code=400)(
                scope, receive, send
            )
            return

        path = request.url.path
        if path.startswith("/api") and not _is_public(request.method, path):
            if not await self._authenticated(request):
                logger.info("hosted request rejected")
                await JSONResponse({"detail": "Unauthorized"}, status_code=401)(
                    scope, receive, send
                )
                return
            if _is_local_only(path):
                await JSONResponse(
                    {"detail": "This is not available in the hosted app."}, status_code=403
                )(scope, receive, send)
                return

        await self.app(scope, receive, send)

    async def _authenticated(self, request: Request) -> bool:
        match = _BEARER.fullmatch(request.headers.get("authorization", ""))
        if match is None:
            return False
        return await run_in_threadpool(self.verifier.verify, match.group(1))

    def _with_policy(self, send: Send) -> Send:
        policy = self.policy.encode("latin-1")

        async def wrapped(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() != b"content-security-policy"
                ]
                headers.append((b"content-security-policy", policy))
                message = {**message, "headers": headers}
            await send(message)

        return wrapped


def _is_public(method: str, path: str) -> bool:
    return method == "GET" and path == "/api/health"


def _is_local_only(path: str) -> bool:
    return path in _LOCAL_ONLY_EXACT or path.startswith(_LOCAL_ONLY_PREFIXES)
