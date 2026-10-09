"""Write the detected wall graph into plan.json."""

import json
import math
from pathlib import Path

from hero.atomic import atomic_write_text
from hero.pipeline.cells import draft_levels
from hero.pipeline.fixtures import attach_fixtures
from hero.pipeline.normalize import LevelSlice, Normalized
from hero.pipeline.openings import attach_structure
from hero.pipeline.shells import np_argmax_abs
from hero.pipeline.surfaces import SurfaceResult, detect_surfaces
from hero.schema import (
    Column,
    Detection,
    DetectionSource,
    Fixture,
    Issue,
    Level,
    Opening,
    Plan,
    Point,
    Room,
    Stair,
    Vertex,
    Wall,
    blank_plan,
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
    "ceiling_missing",
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
    drafts = _populated(result, surfaces)
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


def write_imported_plan(folder: Path, result: Normalized, source: Path, *, up_axis: str) -> None:
    """Write a plan from IFC objects. The mesh wall detector is not used."""
    from hero.pipeline.ifcimport import read_ifc_plan

    plan_path = folder / "plan.json"
    plan = Plan.model_validate_json(plan_path.read_text(encoding="utf-8"))
    meta = json.loads((folder / "project.json").read_text(encoding="utf-8"))
    filename = meta.get("sourceFileName")
    name = filename if isinstance(filename, str) and filename else source.name
    linked = meta.get("linkedPath")
    axis = up_axis if up_axis in {"x", "y", "z"} else "xyz"[int(np_argmax_abs(result.estimated_up))]
    levels, issues = read_ifc_plan(source)
    plan.levels = levels or plan.levels
    plan.detection = Detection(
        source=DetectionSource(
            filename=name,
            format="ifc",
            unitScaleToMeters=result.unit_scale if result.unit_scale > 0 else 1.0,
            upAxis=axis,  # type: ignore[arg-type]
            manhattanAngleDeg=result.manhattan_angle_deg,
            linked=isinstance(linked, str) and bool(linked),
        ),
        issues=_issues([*result.issues, *issues]),
    )
    plan.revision += 1
    atomic_write_text(plan_path, dump_plan(plan))


def scan_plan(result: Normalized) -> Plan:
    """Editable plan for one normalized scene, including openings and fixtures."""
    drafts, surfaces = detect_plan(result)
    plan = blank_plan("Synthetic")
    plan.levels = [_level(draft) for draft in drafts]
    plan.detection = Detection(
        issues=_issues(
            [
                *result.issues,
                *surfaces.issues,
                *[issue for draft in drafts for issue in draft.issues],
            ]
        ),
    )
    return plan


def detect_plan(result: Normalized) -> tuple[list, SurfaceResult]:
    """Wall graph plus openings, columns, stairs, and fixtures."""
    drafts, surfaces = detect_structure(result)
    attach_fixtures(drafts, result)
    return drafts, surfaces


def detect_structure(result: Normalized) -> tuple[list, SurfaceResult]:
    """Walls, rooms, and openings. Furniture is left for the picture."""
    surfaces = detect_surfaces(result)
    drafts = draft_levels(result, surfaces.faces)
    attach_structure(drafts, result, surfaces.faces)
    return drafts, surfaces


def level_from_draft(draft) -> Level:
    """One storey from a wall draft."""
    return _level(draft)


def write_shell_plan(folder: Path, result: Normalized, *, up_axis: str) -> None:
    """Record the scan and leave the sheet empty until the user detects the room."""
    plan_path = folder / "plan.json"
    plan = Plan.model_validate_json(plan_path.read_text(encoding="utf-8"))
    meta = json.loads((folder / "project.json").read_text(encoding="utf-8"))
    filename = meta.get("sourceFileName")
    name = filename if isinstance(filename, str) and filename else "source"
    suffix = Path(name).suffix.lower()
    linked = meta.get("linkedPath")
    axis = up_axis if up_axis in {"x", "y", "z"} else "xyz"[int(np_argmax_abs(result.estimated_up))]
    storeys = list(result.levels) or [LevelSlice(0.0, 2.7)]
    plan.levels = [
        Level(
            id=f"L{index}",
            name=f"Level {index}",
            elevation=level.elevation,
            ceilingHeight=level.ceiling_height if level.ceiling_height > 1.5 else 2.7,
        )
        for index, level in enumerate(storeys, start=1)
    ]
    plan.detection = Detection(
        source=DetectionSource(
            filename=name,
            format=_FORMATS.get(suffix, "obj"),  # type: ignore[arg-type]
            unitScaleToMeters=result.unit_scale if result.unit_scale > 0 else 1.0,
            upAxis=axis,  # type: ignore[arg-type]
            manhattanAngleDeg=result.manhattan_angle_deg,
            linked=isinstance(linked, str) and bool(linked),
        ),
        issues=_issues(list(result.issues)),
    )
    plan.revision += 1
    atomic_write_text(plan_path, dump_plan(plan))


def _populated(result: Normalized, surfaces: SurfaceResult):
    drafts = draft_levels(result, surfaces.faces)
    attach_structure(drafts, result, surfaces.faces)
    attach_fixtures(drafts, result)
    return drafts


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
        openings=[
            Opening(
                id=opening.id,
                wall=opening.wall,
                kind=opening.kind,
                offset=opening.offset,
                width=opening.width,
                sill=opening.sill,
                head=opening.head,
                swing=opening.swing,
                swingSide=opening.swing_side,
                confidence=opening.confidence,
            )
            for opening in draft.openings
        ],
        columns=[
            Column(
                id=column.id,
                x=column.x,
                y=column.y,
                width=column.width,
                depth=column.depth,
                rotationDeg=column.rotation_deg,
            )
            for column in draft.columns
        ],
        stairs=[_stair(stair) for stair in draft.stairs],
        fixtures=[
            Fixture(
                id=fixture.id,
                symbol=fixture.symbol,
                x=fixture.x,
                y=fixture.y,
                rotationDeg=fixture.rotation_deg,
                width=fixture.width,
                depth=fixture.depth,
                confidence=fixture.confidence,
                role=fixture.role,
            )
            for fixture in draft.fixtures
        ],
    )


def _stair(stair) -> Stair:
    dx, dy = float(stair.direction[0]), float(stair.direction[1])
    length = math.hypot(dx, dy)
    if length < 1e-8:
        dx, dy = 0.0, 1.0
    else:
        dx, dy = dx / length, dy / length
    start = float(stair.from_elevation)
    end = float(stair.to_elevation)
    if end <= start:
        end = start + 0.15
    return Stair(
        id=stair.id,
        outline=[Point(x=x, y=y) for x, y in stair.outline],
        direction=Point(x=dx, y=dy),
        riserCount=max(1, int(stair.riser_count)),
        fromElevation=start,
        toElevation=end,
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
