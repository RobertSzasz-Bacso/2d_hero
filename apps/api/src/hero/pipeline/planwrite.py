"""Write the detected wall graph into plan.json."""

import json
from pathlib import Path

from hero.atomic import atomic_write_text
from hero.pipeline.cells import draft_levels
from hero.pipeline.normalize import Normalized
from hero.pipeline.shells import np_argmax_abs
from hero.pipeline.surfaces import SurfaceResult
from hero.schema import (
    Detection,
    DetectionSource,
    Issue,
    Level,
    Plan,
    Point,
    Room,
    Vertex,
    Wall,
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


def write_detected_plan(folder: Path, result: Normalized, surfaces: SurfaceResult, *,
    up_axis: str) -> None:
    """Replace empty shells with vertices, walls, room seeds, and detection issues."""
    plan_path = folder / "plan.json"
    plan = Plan.model_validate_json(plan_path.read_text(encoding="utf-8"))
    meta = json.loads((folder / "project.json").read_text(encoding="utf-8"))
    filename = meta.get("sourceFileName")
    name = filename if isinstance(filename, str) and filename else "source"
    suffix = Path(name).suffix.lower()
    linked = meta.get("linkedPath")
    axis = up_axis if up_axis in {"x", "y", "z"} else "xyz"[int(np_argmax_abs(result.estimated_up))]
    drafts = draft_levels(result, surfaces.faces)
    plan.levels = [_level(draft) for draft in drafts] or plan.levels
    plan.detection = Detection(
        source=DetectionSource(
            filename=name,
            format=_FORMATS.get(suffix, "obj"),  # type: ignore[arg-type]
            unitScaleToMeters=result.unit_scale if result.unit_scale > 0 else 1.0,
            upAxis=axis,  # type: ignore[arg-type]
            manhattanAngleDeg=result.manhattan_angle_deg,
            linked=isinstance(linked, str) and bool(linked),
        ),
        issues=_issues([*result.issues, *surfaces.issues,
            *[issue for draft in drafts for issue in draft.issues]]),
    )
    plan.revision += 1
    atomic_write_text(plan_path, dump_plan(plan))


def _level(draft) -> Level:
    ceiling = draft.ceiling_height if draft.ceiling_height > 1.5 else 2.7
    return Level(
        id=draft.level_id,
        name=f"Level {draft.level_id[1:]}",
        elevation=draft.elevation,
        ceilingHeight=ceiling,
        vertices=[Vertex(id=vertex.id, x=vertex.x, y=vertex.y) for vertex in draft.vertices],
        walls=[
            Wall(
                id=wall.id,
                a=wall.a,
                b=wall.b,
                thickness=wall.thickness,
                kind=wall.kind,  # type: ignore[arg-type]
                confidence=min(1.0, max(0.0, wall.confidence)),
            )
            for wall in draft.walls
        ],
        rooms=[
            Room(id=room.id, name=room.name, number=room.number, seed=Point(x=room.x, y=room.y))
            for room in draft.rooms
        ],
    )


def _issues(raw_items: list[dict[str, str]]) -> list[Issue]:
    issues: list[Issue] = []
    seen: set[str] = set()
    for raw in raw_items:
        code = raw.get("code", "")
        if code not in _PLAN_CODES or code in seen:
            continue
        seen.add(code)
        severity = raw.get("severity", "warning")
        if severity not in {"info", "warning", "error"}:
            severity = "warning"
        element = raw.get("elementId") or None
        if element is not None and not element[:1].isalpha():
            element = None
        issues.append(
            Issue(
                id=f"i{code.replace('_', '')[:20]}",
                severity=severity,  # type: ignore[arg-type]
                code=code,  # type: ignore[arg-type]
                message=raw.get("message") or code.replace("_", " "),
                elementId=element,
            )
        )
    return issues
