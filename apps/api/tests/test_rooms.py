"""Scan to editable plan: room IoU, dimensions, a gap, and noise."""

from pathlib import Path

import pytest
from shapely.geometry import Polygon

from hero.ingest.read import read_source
from hero.pipeline.cells import draft_levels
from hero.pipeline.normalize import normalize_scene
from hero.pipeline.surfaces import detect_surfaces
from hero.planops.model import wrap
from hero.planops.rooms import extract_rooms
from hero.schema import Plan
from hero.testkit.building import build_building
from hero.testkit.metrics import WallSeg, room_iou, wall_iou
from hero.testkit.writers import obj_bytes


def test_clean_apartment_rooms_and_walls(tmp_path: Path,
    capsys: pytest.CaptureFixture[str]) -> None:
    building = build_building(1)
    plan = _detect(tmp_path, building)
    predicted = _room_polygons(plan)
    iou = room_iou(predicted, building.rooms)
    widths = _dimension_errors(predicted, building.rooms)
    walls = wall_iou(_wall_segments(plan), building.walls)
    print(f"room IoU {iou:.3f} wall IoU {walls:.3f} dimension {max(widths) if widths else 0:.4f}")
    assert iou >= 0.95
    assert walls >= 0.90
    assert widths
    assert max(widths) <= 0.02
    assert "room IoU" in capsys.readouterr().out


def test_missing_short_wall_is_an_open_gap_and_the_plan_opens(tmp_path: Path) -> None:
    building = build_building(1, open_gap=True)
    plan = _detect(tmp_path, building)
    codes = {issue.code for issue in plan.detection.issues}
    assert "open_gap" in codes or "uncertain_room" in codes
    opened = Plan.model_validate_json(plan.model_dump_json())
    assert opened.levels
    assert opened.levels[0].walls


def test_noisy_apartment_keeps_room_iou(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    building = build_building(1, noise_m=0.01)
    plan = _detect(tmp_path, building)
    iou = room_iou(_room_polygons(plan), building.rooms)
    print(f"noisy room IoU {iou:.3f}")
    assert iou >= 0.85
    assert "noisy room IoU" in capsys.readouterr().out


def _detect(tmp_path: Path, building):
    path = tmp_path / "building.obj"
    path.write_bytes(obj_bytes(building))
    normalized = normalize_scene(read_source(path))
    surfaces = detect_surfaces(normalized)
    drafts = draft_levels(normalized, surfaces.faces)
    payload = {
        "schemaVersion": 2,
        "units": "m",
        "revision": 1,
        "project": {"name": "Synthetic", "address": "", "northAngleDeg": 0},
        "sheet": {
            "paper": "A3",
            "orientation": "landscape",
            "scale": 50,
            "titleBlock": {
                "company": "",
                "project": "",
                "address": "",
                "drawnBy": "",
                "date": "",
                "sheetTitle": "",
                "sheetNumber": "",
                "revisionNote": "",
            },
        },
        "detection": {
            "source": None,
            "issues": [
                {
                    "id": f"i{index + 1}",
                    "severity": issue.get("severity", "warning"),
                    "code": issue["code"],
                    "message": issue.get("message", issue["code"]),
                    **({"elementId": issue["elementId"]} if issue.get("elementId") else {}),
                }
                for index, issue in enumerate(issue for draft in drafts for issue in draft.issues)
            ],
        },
        "levels": [
            {
                "id": draft.level_id,
                "name": draft.level_id,
                "elevation": draft.elevation,
                "ceilingHeight": draft.ceiling_height,
                "vertices": [{"id": vertex.id, "x": vertex.x,
                    "y": vertex.y} for vertex in draft.vertices],
                "walls": [
                    {
                        "id": wall.id,
                        "a": wall.a,
                        "b": wall.b,
                        "thickness": wall.thickness,
                        "kind": wall.kind,
                        "confidence": wall.confidence,
                    }
                    for wall in draft.walls
                ],
                "rooms": [
                    {"id": room.id, "name": room.name, "number": room.number,
                        "seed": {"x": room.x, "y": room.y}}
                    for room in draft.rooms
                ],
            }
            for draft in drafts
        ],
    }
    return Plan.model_validate(payload)


def _room_polygons(plan: Plan) -> list[Polygon]:
    wrapped = wrap(json_plan(plan))
    polygons: list[Polygon] = []
    for level in plan.levels:
        for room in extract_rooms(wrapped, level.id)["rooms"]:
            polygons.append(Polygon([(point["x"], point["y"]) for point in room["polygon"]]))
    return polygons


def _wall_segments(plan: Plan) -> list[WallSeg]:
    segments: list[WallSeg] = []
    for level in plan.levels:
        verts = {vertex.id: vertex for vertex in level.vertices}
        for wall in level.walls:
            a = verts[wall.a]
            b = verts[wall.b]
            segments.append(WallSeg(a.x, a.y, b.x, b.y, wall.thickness))
    return segments


def _dimension_errors(predicted: list[Polygon], truth: list[Polygon]) -> list[float]:
    errors: list[float] = []
    used: set[int] = set()
    for truth_room in truth:
        best = 0.0
        best_index: int | None = None
        for index, room in enumerate(predicted):
            if index in used:
                continue
            score = _iou(room, truth_room)
            if score > best:
                best = score
                best_index = index
        if best_index is None:
            errors.append(1.0)
            continue
        used.add(best_index)
        tw, td = _span(truth_room)
        pw, pd = _span(predicted[best_index])
        errors.append(max(abs(pw - tw), abs(pd - td)))
    return errors


def _span(room: Polygon) -> tuple[float, float]:
    min_x, min_y, max_x, max_y = room.bounds
    return max_x - min_x, max_y - min_y


def _iou(left: Polygon, right: Polygon) -> float:
    union = left.union(right).area
    if union == 0:
        return 1.0
    return float(left.intersection(right).area / union)


def json_plan(plan: Plan) -> dict:
    return plan.model_dump(mode="json")
