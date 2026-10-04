"""Projects live in a folder on disk."""

from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

from hero.schema import Plan

ALLOWED_SUFFIXES = {".obj", ".glb", ".gltf", ".ifc", ".usdz", ".e57", ".las", ".laz", ".ply"}
UNSUPPORTED_MESSAGE = "This file is not a glTF, OBJ, IFC, USDZ, E57, LAS, or PLY."


class Storage:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def create(self, filename: str, data: bytes) -> str:
        suffix = Path(filename).suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            raise ValueError(UNSUPPORTED_MESSAGE)
        project_id = uuid4().hex
        folder = self.data_dir / project_id
        folder.mkdir()
        (folder / f"source{suffix}").write_bytes(data)
        (folder / "meta.json").write_text(json.dumps({"filename": Path(filename).name, "suffix": suffix}))
        return project_id

    def exists(self, project_id: str) -> bool:
        return (self.data_dir / project_id / "meta.json").is_file()

    def meta(self, project_id: str) -> dict:
        return json.loads((self.data_dir / project_id / "meta.json").read_text())

    def source_path(self, project_id: str) -> Path:
        suffix = self.meta(project_id)["suffix"]
        return self.data_dir / project_id / f"source{suffix}"

    def save_plan(self, project_id: str, plan: Plan) -> None:
        (self.data_dir / project_id / "plan.json").write_text(plan.model_dump_json())

    def load_plan(self, project_id: str) -> Plan | None:
        path = self.data_dir / project_id / "plan.json"
        if not path.is_file():
            return None
        return Plan.model_validate_json(path.read_text())
