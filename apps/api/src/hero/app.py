"""FastAPI application: health, placeholder settings, and the built web app."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.requests import Request
from starlette.responses import JSONResponse

from hero.paths import web_dist
from hero.security import LocalSecurityMiddleware
from hero.session_file import write_token

logger = logging.getLogger("hero")

_CORS_ORIGINS = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]


def create_app(
    token: str,
    *,
    config_dir: Path | None = None,
    session_file: Path | None = None,
    dist_dir: Path | None = None,
) -> FastAPI:
    """Build the API. Session files are written only when paths are passed in."""

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if config_dir is not None:
            write_token(config_dir / "session.token", token)
        if session_file is not None:
            write_token(session_file, token)
        yield

    app = FastAPI(title="2D Hero", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.add_middleware(LocalSecurityMiddleware, token=token)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_CORS_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_exception_handler(Exception, _unhandled_exception)

    @app.get("/api/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/api/settings")
    def settings() -> dict[str, bool]:
        return {"cursorKeySet": False}

    static_dir = web_dist() if dist_dir is None else dist_dir
    if static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="web")

    return app


async def _unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, HTTPException):
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return JSONResponse(status_code=exc.status_code, content={"detail": detail})
    if isinstance(exc, RequestValidationError):
        return JSONResponse(status_code=422, content={"detail": "Request was not valid."})
    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong."})
