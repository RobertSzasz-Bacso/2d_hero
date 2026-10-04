"""Local HTTP API and, when the UI has been built, the static site."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError

from hero.assistant import CursorSdkAssistant, PlanAssistant
from hero.cleanup import LearnedCleanup, PlanCleanup
from hero.dxf_export import render_dxf
from hero.geometry import generate_plan
from hero.pdf_export import render_pdf
from hero.preview import build_preview
from hero.svg_export import render_svg
from hero.schema import Plan
from hero.storage import ALLOWED_SUFFIXES, UNSUPPORTED_MESSAGE, Storage


class GenerateBody(BaseModel):
    slice_height: float = 1.2


class InstructionBody(BaseModel):
    instruction: str


def create_app(
    data_dir: Path | None = None,
    assistant: PlanAssistant | None = None,
    cleanup: PlanCleanup | None = None,
) -> FastAPI:
    folder = Path(data_dir) if data_dir is not None else Path(os.environ.get("HERO_DATA_DIR", "data"))
    app = FastAPI(title="2D Hero")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.storage = Storage(folder)
    app.state.assistant = assistant or CursorSdkAssistant()
    app.state.cleanup = cleanup or LearnedCleanup()

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    @app.post("/api/projects")
    async def upload(file: UploadFile = File(...)) -> dict:
        filename = file.filename or "upload"
        if Path(filename).suffix.lower() not in ALLOWED_SUFFIXES:
            raise HTTPException(status_code=400, detail=UNSUPPORTED_MESSAGE)
        project_id = app.state.storage.create(filename, await file.read())
        return {"id": project_id, "filename": Path(filename).name}

    @app.get("/api/projects/{project_id}")
    def read_project(project_id: str) -> dict:
        storage = _storage(app, project_id)
        meta = storage.meta(project_id)
        plan = storage.load_plan(project_id)
        return {
            "id": project_id,
            "filename": meta["filename"],
            "plan": plan.model_dump() if plan else None,
        }

    @app.get("/api/projects/{project_id}/preview")
    def preview(project_id: str) -> dict:
        storage = _storage(app, project_id)
        try:
            return build_preview(storage.source_path(project_id))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/projects/{project_id}/generate")
    def generate(project_id: str, body: GenerateBody) -> Plan:
        storage = _storage(app, project_id)
        try:
            plan = generate_plan(storage.source_path(project_id), slice_height=body.slice_height)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        storage.save_plan(project_id, plan)
        return plan

    @app.put("/api/projects/{project_id}/plan")
    def save_plan(project_id: str, plan: Plan) -> Plan:
        storage = _storage(app, project_id)
        storage.save_plan(project_id, plan)
        return plan

    @app.get("/api/projects/{project_id}/pdf")
    def export_pdf(project_id: str) -> Response:
        plan = _plan_or_404(app, project_id)
        document = render_pdf(plan)
        return Response(
            content=document,
            media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="floor-plan.pdf"'},
        )

    @app.get("/api/projects/{project_id}/dxf")
    def export_dxf(project_id: str) -> Response:
        plan = _plan_or_404(app, project_id)
        return Response(
            content=render_dxf(plan),
            media_type="image/vnd.dxf",
            headers={"Content-Disposition": 'attachment; filename="floor-plan.dxf"'},
        )

    @app.get("/api/projects/{project_id}/svg")
    def export_svg(project_id: str) -> Response:
        plan = _plan_or_404(app, project_id)
        return Response(
            content=render_svg(plan),
            media_type="image/svg+xml",
            headers={"Content-Disposition": 'attachment; filename="floor-plan.svg"'},
        )

    @app.post("/api/projects/{project_id}/ai")
    def clean_with_ai(project_id: str, body: InstructionBody) -> Plan:
        storage = _storage(app, project_id)
        plan = storage.load_plan(project_id)
        if plan is None:
            raise HTTPException(status_code=404, detail="Generate a floor plan before asking for a cleanup.")
        try:
            revised = app.state.assistant.revise(plan, body.instruction)
            if not isinstance(revised, Plan):
                revised = Plan.model_validate(revised)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail="The AI reply was not a valid floor plan.") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        storage.save_plan(project_id, revised)
        return revised

    @app.post("/api/projects/{project_id}/cleanup")
    def learned_cleanup(project_id: str) -> Plan:
        storage = _storage(app, project_id)
        plan = storage.load_plan(project_id)
        if plan is None:
            raise HTTPException(status_code=404, detail="Generate a floor plan before cleaning it up.")
        try:
            revised = app.state.cleanup.clean(plan)
            if not isinstance(revised, Plan):
                revised = Plan.model_validate(revised)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail="The cleanup reply was not a valid floor plan.") from exc
        storage.save_plan(project_id, revised)
        return revised

    dist = _web_dist()
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="web")
    return app


def _plan_or_404(app: FastAPI, project_id: str) -> Plan:
    storage = _storage(app, project_id)
    plan = storage.load_plan(project_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Generate a floor plan before exporting.")
    return plan


def _storage(app: FastAPI, project_id: str) -> Storage:
    storage: Storage = app.state.storage
    if not storage.exists(project_id):
        raise HTTPException(status_code=404, detail="That project was not found.")
    return storage


def _web_dist() -> Path:
    override = os.environ.get("HERO_WEB_DIST")
    if override:
        return Path(override)
    source_tree = Path(__file__).resolve().parents[3] / "web" / "dist"
    if source_tree.is_dir():
        return source_tree
    return Path("apps/web/dist")


app = create_app()
