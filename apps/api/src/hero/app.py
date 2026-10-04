"""FastAPI application: health, projects, settings, and the built web app."""

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from json import JSONDecodeError
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, ValidationError
from sse_starlette.sse import EventSourceResponse
from starlette.datastructures import UploadFile
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse

from hero.ai.agent import CursorPlanAgent, PlanAgent
from hero.ai.service import accept_proposal, propose_edit, reject_proposal
from hero.dialogs import ask_open_file
from hero.errors import UNREADABLE, UnreadableFile
from hero.jobs import (
    JobBusy,
    cancel_job,
    import_status,
    job_snapshot,
    shutdown_pool,
    source_file,
    start_import,
)
from hero.keystore import cursor_key_is_set, delete_cursor_key, set_cursor_key
from hero.paths import app_config_dir, default_projects_dir, web_dist
from hero.pipeline.guess import guess_source
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

_UNSAFE_IMAGE = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,40}\.png$")

_CORS_ORIGINS = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]


class CursorKeyBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    key: str


class ImportJobBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: str
    units: str = "auto"
    upAxis: str = "auto"


class ProposeBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    instruction: str


def create_app(
    token: str,
    *,
    config_dir: Path | None = None,
    projects_dir: Path | None = None,
    session_file: Path | None = None,
    dist_dir: Path | None = None,
    open_file: Callable[[], str | None] | None = None,
    agent: PlanAgent | None = None,
) -> FastAPI:
    """Build the API. Session files are written only when paths are passed in."""

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if config_dir is not None:
            write_token(config_dir / "session.token", token)
        if session_file is not None:
            write_token(session_file, token)
        yield
        shutdown_pool()

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
    plan_agent = agent if agent is not None else CursorPlanAgent()

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
        store = project_store()
        return [_with_import_status(store, item) for item in store.list_recent()]

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
        store = project_store()
        return JSONResponse(_with_import_status(store, store.describe(stored.id)))

    @app.post("/api/dialogs/open-file")
    def open_file_dialog() -> JSONResponse:
        selected = chooser()
        if not selected:
            return JSONResponse({"detail": "No file was selected."}, status_code=400)
        return JSONResponse({"path": selected})

    @app.get("/api/projects/{project_id}")
    def get_project(project_id: str) -> JSONResponse:
        store = project_store()
        try:
            return JSONResponse(_with_import_status(store, store.describe(project_id)))
        except ProjectNotFound:
            return JSONResponse({"detail": "Project was not found."}, status_code=404)

    @app.delete("/api/projects/{project_id}")
    def delete_project(project_id: str) -> JSONResponse:
        store = project_store()
        try:
            folder = store.project_dir(project_id)
        except ProjectNotFound:
            return JSONResponse({"detail": "Project was not found."}, status_code=404)
        if import_status(folder).get("importState") == "running":
            return JSONResponse(
                {"detail": "An import is running for this project."},
                status_code=409,
            )
        store.delete(project_id)
        return JSONResponse({"deleted": True})

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

    @app.post("/api/projects/{project_id}/jobs")
    def post_job(project_id: str, body: ImportJobBody) -> JSONResponse:
        if body.kind != "import":
            return JSONResponse({"detail": "This job kind is not supported."}, status_code=400)
        if body.units not in {"m", "mm", "auto"} or body.upAxis not in {"auto", "x", "y", "z"}:
            return JSONResponse({"detail": "Request was not valid."}, status_code=422)
        try:
            folder = project_store().project_dir(project_id)
            source_file(folder)
        except ProjectNotFound:
            return JSONResponse({"detail": "Project was not found."}, status_code=404)
        except LinkedFileMissing as exc:
            return JSONResponse(
                {"detail": f"The linked file is missing: {exc.path}"},
                status_code=400,
            )
        except (FileNotFoundError, OSError):
            return JSONResponse({"detail": "Source file is missing."}, status_code=400)
        try:
            job_id = start_import(folder, body.units, body.upAxis)
        except JobBusy:
            return JSONResponse({"detail": "A job is already running."}, status_code=409)
        return JSONResponse({"id": job_id, "state": "running"})

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str) -> JSONResponse:
        snapshot = job_snapshot(job_id)
        if snapshot is None:
            return JSONResponse({"detail": "Job was not found."}, status_code=404)
        return JSONResponse(snapshot)

    @app.get("/api/jobs/{job_id}/events")
    def job_events(job_id: str) -> EventSourceResponse:
        if job_snapshot(job_id) is None:
            raise HTTPException(status_code=404, detail="Job was not found.")

        async def stream() -> AsyncIterator[dict[str, str]]:
            while True:
                snapshot = job_snapshot(job_id) or {"state": "error", "error": "Job was not found."}
                yield {"event": "progress", "data": json.dumps(snapshot)}
                if snapshot.get("state") in {"done", "cancelled", "error"}:
                    break
                await asyncio.sleep(0.2)

        return EventSourceResponse(stream())

    @app.post("/api/jobs/{job_id}/cancel")
    def post_cancel(job_id: str) -> JSONResponse:
        if not cancel_job(job_id):
            return JSONResponse({"detail": "Job was not found."}, status_code=404)
        return JSONResponse({"state": "cancelled"})

    @app.get("/api/projects/{project_id}/guess")
    def guess_project(project_id: str) -> JSONResponse:
        try:
            folder = project_store().project_dir(project_id)
            source = source_file(folder)
        except ProjectNotFound:
            return JSONResponse({"detail": "Project was not found."}, status_code=404)
        except LinkedFileMissing as exc:
            return JSONResponse(
                {"detail": f"The linked file is missing: {exc.path}"},
                status_code=400,
            )
        except (FileNotFoundError, OSError):
            return JSONResponse({"detail": "Source file is missing."}, status_code=400)
        try:
            return JSONResponse(guess_source(source))
        except UnreadableFile:
            logger.info("Unreadable source for project %s", project_id)
            return JSONResponse({"detail": UNREADABLE}, status_code=400)
        except Exception:
            logger.exception("Could not guess units for %s", project_id)
            return JSONResponse({"detail": UNREADABLE}, status_code=400)

    @app.get("/api/projects/{project_id}/underlay/frames.json")
    def underlay_frames(project_id: str) -> JSONResponse:
        try:
            folder = project_store().project_dir(project_id)
        except ProjectNotFound:
            return JSONResponse({"detail": "Project was not found."}, status_code=404)
        path = folder / "underlay" / "frames.json"
        if not path.is_file():
            return JSONResponse({"detail": "No underlay yet."}, status_code=404)
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            return JSONResponse({"detail": "No underlay yet."}, status_code=404)
        return JSONResponse(loaded)

    @app.get("/api/projects/{project_id}/underlay/{image_name}", response_model=None)
    def underlay_image(project_id: str, image_name: str) -> FileResponse | JSONResponse:
        if _UNSAFE_IMAGE.fullmatch(image_name) is None:
            return JSONResponse({"detail": "Underlay was not found."}, status_code=404)
        try:
            folder = project_store().project_dir(project_id)
        except ProjectNotFound:
            return JSONResponse({"detail": "Project was not found."}, status_code=404)
        path = folder / "underlay" / image_name
        if not path.is_file():
            return JSONResponse({"detail": "Underlay was not found."}, status_code=404)
        return FileResponse(path, media_type="image/png")

    @app.get("/api/projects/{project_id}/preview", response_model=None)
    def project_preview(project_id: str) -> FileResponse | JSONResponse:
        try:
            folder = project_store().project_dir(project_id)
        except ProjectNotFound:
            return JSONResponse({"detail": "Project was not found."}, status_code=404)
        glb = folder / "preview.glb"
        if glb.is_file():
            return FileResponse(glb, media_type="model/gltf-binary")
        points = folder / "preview.pts"
        if points.is_file():
            return FileResponse(points, media_type="application/octet-stream")
        return JSONResponse({"detail": "Preview is not ready."}, status_code=404)

    @app.post("/api/projects/{project_id}/ai/propose")
    def post_proposal(project_id: str, body: ProposeBody) -> JSONResponse:
        result = propose_edit(project_store(), project_id, body.instruction, plan_agent)
        return JSONResponse(result.body, status_code=result.status)

    @app.post("/api/projects/{project_id}/ai/accept")
    def post_accept(project_id: str) -> JSONResponse:
        result = accept_proposal(project_store(), project_id)
        return JSONResponse(result.body, status_code=result.status)

    @app.post("/api/projects/{project_id}/ai/reject")
    def post_reject(project_id: str) -> JSONResponse:
        result = reject_proposal(project_store(), project_id)
        return JSONResponse(result.body, status_code=result.status)

    static_dir = web_dist() if dist_dir is None else dist_dir
    if static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="web")

    return app


def _with_import_status(store: ProjectStore, described: dict[str, object]) -> dict[str, object]:
    project_id = described.get("id")
    if not isinstance(project_id, str):
        return described
    try:
        described.update(import_status(store.project_dir(project_id)))
    except ProjectNotFound:
        described["importState"] = "none"
        described["importError"] = ""
        described["jobId"] = None
        described["importProgress"] = 0
    return described


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
