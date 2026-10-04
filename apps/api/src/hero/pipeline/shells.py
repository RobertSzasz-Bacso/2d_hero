"""Write empty storey shells so the editor can switch levels before walls exist."""

import json
from pathlib import Path

from hero.atomic import atomic_write_text
from hero.pipeline.normalize import Normalized
from hero.schema import (
    Detection,
    DetectionSource,
    Issue,
    Level,
    Plan,
    dump_plan,
)

_FORMATS = {
    ".obj": "obj",
    ".glb": "glb",
    ".gltf": "gltf",
    ".usdz": "usdz",
    ".ply": "ply",
    ".e57": "e57",
    ".las": "las",
    ".laz": "laz",
    ".ifc": "ifc",
}

_PLAN_CODES = {
    "gravity_uncertain",
    "units_guessed",
    "non_manhattan",
    "assumed_thickness",
    "open_gap",
    "uncertain_room",
    "room_seed_lost",
    "room_not_split",
    "low_confidence_opening",
    "ifc_wall_from_solid",
    "missing_source",
}


def write_level_shells(folder: Path, result: Normalized, *, up_axis: str) -> None:
    """Replace plan levels with one shell per detected storey. Walls stay empty."""
    plan_path = folder / "plan.json"
    plan = Plan.model_validate_json(plan_path.read_text(encoding="utf-8"))
    meta = json.loads((folder / "project.json").read_text(encoding="utf-8"))
    frames = _frames(folder)
    levels = _levels(result, frames)
    filename = meta.get("sourceFileName")
    name = filename if isinstance(filename, str) and filename else "source"
    suffix = Path(name).suffix.lower()
    linked = meta.get("linkedPath")
    axis = up_axis if up_axis in {"x", "y", "z"} else _guessed_axis(result)
    source = DetectionSource(
        filename=name,
        format=_FORMATS.get(suffix, "obj"),  # type: ignore[arg-type]
        unitScaleToMeters=result.unit_scale if result.unit_scale > 0 else 1.0,
        upAxis=axis,  # type: ignore[arg-type]
        manhattanAngleDeg=result.manhattan_angle_deg,
        linked=isinstance(linked, str) and bool(linked),
    )
    issues = _issues(result)
    plan.levels = levels
    plan.detection = Detection(source=source, issues=issues)
    plan.revision += 1
    atomic_write_text(plan_path, dump_plan(plan))


def _frame_float(frame: dict[str, object], key: str, fallback: float) -> float:
    value = frame.get(key, fallback)
    if isinstance(value, int | float):
        return float(value)
    return fallback


def _frames(folder: Path) -> list[dict[str, object]]:
    path = folder / "underlay" / "frames.json"
    if not path.is_file():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    levels = payload.get("levels") if isinstance(payload, dict) else None
    if isinstance(levels, list):
        return [item for item in levels if isinstance(item, dict)]
    return []


def _levels(result: Normalized, frames: list[dict[str, object]]) -> list[Level]:
    shells: list[Level] = []
    count = max(len(result.levels), len(frames), 1)
    for index in range(count):
        frame = frames[index] if index < len(frames) else {}
        level = result.levels[index] if index < len(result.levels) else None
        elevation = _frame_float(frame, "elevation", level.elevation if level else 0.0)
        ceiling = _frame_float(frame, "ceilingHeight", level.ceiling_height if level else 2.7)
        if ceiling <= 1.5:
            ceiling = 2.7
        level_id = frame.get("id")
        shells.append(
            Level(
                id=level_id if isinstance(level_id, str) else f"L{index + 1}",
                name=f"Level {index + 1}",
                elevation=elevation,
                ceilingHeight=ceiling,
            )
        )
    return shells


def _guessed_axis(result: Normalized) -> str:
    axis = int(np_argmax_abs(result.estimated_up))
    return "xyz"[axis]


def np_argmax_abs(vector) -> int:
    import numpy as np

    values = np.abs(np.asarray(vector, dtype=np.float64))
    return int(np.argmax(values))


def _issues(result: Normalized) -> list[Issue]:
    issues: list[Issue] = []
    seen: set[str] = set()
    for raw in result.issues:
        code = raw.get("code", "")
        if code not in _PLAN_CODES or code in seen:
            continue
        seen.add(code)
        severity = raw.get("severity", "warning")
        if severity not in {"info", "warning", "error"}:
            severity = "warning"
        issues.append(
            Issue(
                id=f"i{code.replace('_', '')[:20]}",
                severity=severity,  # type: ignore[arg-type]
                code=code,  # type: ignore[arg-type]
                message=raw.get("message") or code.replace("_", " "),
            )
        )
    return issues
