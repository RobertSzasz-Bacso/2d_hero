"""FastAPI application: health, projects, settings, and the built web app."""

import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from json import JSONDecodeError
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, ValidationError
from starlette.datastructures import UploadFile
from starlette.requests import Request
from starlette.responses import JSONResponse

from hero.dialogs import ask_open_file
from hero.keystore import cursor_key_is_set, delete_cursor_key, set_cursor_key
from hero.paths import app_config_dir, default_projects_dir, web_dist
from hero.projects import (
    FileTooLarge,
    LinkedFileMissing,
    ProjectNotFound,
    ProjectStore,
    RevisionConflict,
)
from hero.schema import Plan
from hero.security import LocalSecurityMiddleware
from hero.session_file import write_token
from hero.settings_store import AppSettings, SettingsStore

logger = logging.getLogger("hero")

_CORS_ORIGINS = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]


class CursorKeyBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    key: str


def create_app(
    token: str,
    *,
    config_dir: Path | None = None,
    projects_dir: Path | None = None,
    session_file: Path | None = None,
    dist_dir: Path | None = None,
    open_file: Callable[[], str | None] | None = None,
) -> FastAPI:
    """Build the API. Session files are written only when paths are passed in."""

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if config_dir is not None:
            write_token(config_dir / "session.token", token)
        if session_file is not None:
            write_token(session_file, token)
        yield

    def dirs() -> tuple[Path, Path]:
        resolved_projects = projects_dir if projects_dir is not None else default_projects_dir()
        resolved_config = config_dir if config_dir is not None else app_config_dir()
        return resolved_projects, resolved_config

    def project_store() -> ProjectStore:
        resolved_projects, resolved_config = dirs()
        return ProjectStore(projects_dir=resolved_projects, config_dir=resolved_config)

    def settings_store() -> SettingsStore:
        _projects, resolved_config = dirs()
        return SettingsStore(resolved_config)

    chooser = open_file if open_file is not None else ask_open_file

    app = FastAPI(title="2D Hero", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.add_middleware(LocalSecurityMiddleware, token=token)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_CORS_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(Exception, _unhandled_exception)

    @app.get("/api/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/api/settings")
    def get_settings() -> dict[str, object]:
        payload = settings_store().load().model_dump(mode="json")
        payload["cursorKeySet"] = cursor_key_is_set()
        return payload

    @app.put("/api/settings")
    def put_settings(body: AppSettings) -> dict[str, object]:
        saved = settings_store().save(body)
        logger.info("settings updated")
        payload = saved.model_dump(mode="json")
        payload["cursorKeySet"] = cursor_key_is_set()
        return payload

    @app.put("/api/settings/cursor-key")
    def put_cursor_key(body: CursorKeyBody) -> dict[str, bool]:
        key = body.key.strip()
        if not key:
            raise HTTPException(status_code=400, detail="A key is required.")
        set_cursor_key(key)
        logger.info("cursor key updated")
        return {"cursorKeySet": True}

    @app.delete("/api/settings/cursor-key")
    def remove_cursor_key() -> dict[str, bool]:
        delete_cursor_key()
        logger.info("cursor key removed")
        return {"cursorKeySet": False}

    @app.get("/api/projects")
    def get_projects() -> list[dict[str, object]]:
        return project_store().list_recent()

    @app.post("/api/projects")
    async def create_project(request: Request) -> JSONResponse:
        content_type = request.headers.get("content-type", "")
        try:
            if "application/json" in content_type:
                payload = await request.json()
                if not isinstance(payload, dict):
                    return JSONResponse(
                        {"detail": "A file or a link path is required."},
                        status_code=400,
                    )
                link_path = payload.get("linkPath")
                raw_name = payload.get("name")
                if not isinstance(link_path, str) or not link_path:
                    return JSONResponse(
                        {"detail": "A file or a link path is required."},
                        status_code=400,
                    )
                if raw_name is not None and not isinstance(raw_name, str):
                    return JSONResponse({"detail": "Request was not valid."}, status_code=422)
                stored = project_store().create_linked(link_path, name=raw_name)
            else:
                form = await request.form()
                upload = form.get("file")
                if not isinstance(upload, UploadFile):
                    return JSONResponse({"detail": "A file is required."}, status_code=400)
                raw_name = form.get("name")
                name = raw_name if isinstance(raw_name, str) else None
                stored = await project_store().create_from_chunks(
                    upload.filename or "upload.bin",
                    upload.read,
                    name,
                )
        except LinkedFileMissing as exc:
            return JSONResponse(
                {"detail": f"The linked file is missing: {exc.path}"},
                status_code=400,
            )
        except FileTooLarge:
            return JSONResponse(
                {"detail": "This file is over 200 MB. Link it instead of copying."},
                status_code=400,
            )
        except JSONDecodeError:
            return JSONResponse({"detail": "Request was not valid."}, status_code=422)
        return JSONResponse(project_store().describe(stored.id))

    @app.post("/api/dialogs/open-file")
    def open_file_dialog() -> JSONResponse:
        selected = chooser()
        if not selected:
            return JSONResponse({"detail": "No file was selected."}, status_code=400)
        return JSONResponse({"path": selected})

    @app.get("/api/projects/{project_id}")
    def get_project(project_id: str) -> JSONResponse:
        try:
            return JSONResponse(project_store().describe(project_id))
        except ProjectNotFound:
            return JSONResponse({"detail": "Project was not found."}, status_code=404)

    @app.get("/api/projects/{project_id}/plan")
    def get_plan(project_id: str) -> JSONResponse:
        try:
            plan = project_store().read_plan(project_id)
        except ProjectNotFound:
            return JSONResponse({"detail": "Project was not found."}, status_code=404)
        return JSONResponse(plan.model_dump(mode="json"))

    @app.put("/api/projects/{project_id}/plan")
    async def put_plan(project_id: str, request: Request) -> JSONResponse:
        matched = _parse_if_match(request.headers.get("if-match"))
        if matched is None:
            return JSONResponse({"detail": "If-Match revision is required."}, status_code=400)
        try:
            payload = await request.json()
            plan = Plan.model_validate(payload)
        except (JSONDecodeError, ValidationError):
            return JSONResponse({"detail": "Plan is not valid."}, status_code=422)
        try:
            saved = project_store().save_plan(project_id, plan, if_match=matched)
        except ProjectNotFound:
            return JSONResponse({"detail": "Project was not found."}, status_code=404)
        except RevisionConflict as exc:
            return JSONResponse(
                status_code=409,
                content={
                    "detail": "This plan was saved somewhere else. Reloaded.",
                    "plan": exc.plan.model_dump(mode="json"),
                },
            )
        return JSONResponse(saved.model_dump(mode="json"))

    static_dir = web_dist() if dist_dir is None else dist_dir
    if static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="web")

    return app


def _parse_if_match(value: str | None) -> int | None:
    if value is None:
        return None
    token = value.strip()
    if token.startswith("W/"):
        token = token[2:].strip()
    if len(token) >= 2 and token.startswith('"') and token.endswith('"'):
        token = token[1:-1]
    if not token.isdigit():
        return None
    return int(token)


async def _validation_error(_request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):
        return JSONResponse(status_code=500, content={"detail": "Something went wrong."})
    return JSONResponse(status_code=422, content={"detail": "Request was not valid."})


async def _unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, HTTPException):
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return JSONResponse(status_code=exc.status_code, content={"detail": detail})
    if isinstance(exc, RequestValidationError):
        return JSONResponse(status_code=422, content={"detail": "Request was not valid."})
    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong."})
