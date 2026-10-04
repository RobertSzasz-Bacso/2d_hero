"""Semantic IFC import. Axes win over the mesh wall detector."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from shapely.geometry import Polygon

from hero.jobs import execute_import
from hero.pipeline.ifcimport import read_ifc_plan
from hero.planops.model import wrap
from hero.planops.rooms import extract_rooms
from hero.schema import Plan, blank_plan, dump_plan
from hero.testkit.building import build_building
from hero.testkit.metrics import room_iou
from hero.testkit.writers import write_building

ROOT = Path(__file__).resolve().parents[3]
TWO_WALLS = ROOT / "fixtures" / "two_walls.ifc"


def test_synthetic_ifc_keeps_walls_doors_and_room_names(tmp_path: Path) -> None:
    building = build_building(1)
    written = write_building(tmp_path, seed=1)
    levels, _issues = read_ifc_plan(written["building.ifc"])
    plan = _plan(levels)
    assert len(plan.levels) == 2
    assert [level.elevation for level in plan.levels] == [0.0, 3.0]
    _assert_walls(plan, building)
    doors = [
        opening for level in plan.levels for opening in level.openings if opening.kind == "door"
    ]
    assert len(doors) == 1
    assert abs(doors[0].width - 0.9) <= 0.01
    assert abs(doors[0].sill - 0.0) <= 0.01
    windows = [
        opening for level in plan.levels for opening in level.openings if opening.kind == "window"
    ]
    assert len(windows) == 2
    assert all(abs(opening.width - 1.2) <= 0.01 for opening in windows)
    names = sorted(room.name for level in plan.levels for room in level.rooms)
    assert names == ["Kitchen", "Kitchen", "Living", "Living"]
    iou = room_iou(_room_polygons(plan), building.rooms)
    assert iou >= 0.95


def test_two_storeys_become_two_levels(tmp_path: Path) -> None:
    written = write_building(tmp_path, seed=1)
    levels, _issues = read_ifc_plan(written["building.ifc"])
    assert len(levels) == 2
    assert levels[0].elevation == 0.0
    assert levels[1].elevation == 3.0


def test_millimetre_ifc_is_converted_to_metres(tmp_path: Path) -> None:
    written = write_building(tmp_path, seed=1, millimetres=True)
    levels, _issues = read_ifc_plan(written["building.ifc"])
    thicknesses = [wall.thickness for level in levels for wall in level.walls]
    xs = [vertex.x for level in levels for vertex in level.vertices]
    assert max(xs) == 8.0
    assert 0.25 in [round(value, 3) for value in thicknesses]
    assert all(abs(value - 0.25) <= 0.01 or abs(value - 0.15) <= 0.01 for value in thicknesses)


def test_two_walls_fixture_imports_without_throwing() -> None:
    levels, issues = read_ifc_plan(TWO_WALLS)
    walls = [wall for level in levels for wall in level.walls]
    assert len(walls) == 2
    assert any(issue["code"] == "ifc_wall_from_solid" for issue in issues)


def test_two_doors_in_one_wall_get_distinct_ids(tmp_path: Path) -> None:
    from hero.testkit.writers import _write_ifc

    building = build_building(1)
    level = building.plan.levels[0]
    door = next(opening for opening in level.openings if opening.kind == "door")
    level.openings.append(door.model_copy(update={"id": "o2door", "offset": 0.7}))
    path = tmp_path / "two-doors.ifc"
    _write_ifc(path, building)
    levels, _issues = read_ifc_plan(path)
    doors = [opening for item in levels for opening in item.openings if opening.kind == "door"]
    assert len(doors) >= 2
    assert len({opening.id for opening in doors}) == len(doors)


@pytest.mark.parametrize(
    "name",
    ["AC20-FZK-Haus.ifc", "Duplex_A_20110907.ifc", "Clinic_Architectural.ifc"],
)
def test_public_ifc_sample_imports(name: str) -> None:
    path = ROOT / "samples" / "public" / name
    if not path.is_file():
        pytest.skip(f"Missing sample: {path}")
    levels, _issues = read_ifc_plan(path)
    walls = [wall for level in levels for wall in level.walls]
    assert levels
    assert walls


def test_axis_wall_does_not_call_the_mesh_detector(tmp_path: Path) -> None:
    folder = tmp_path / "project"
    folder.mkdir()
    written = write_building(folder, seed=1)
    source = folder / "source.ifc"
    source.write_bytes(written["building.ifc"].read_bytes())
    meta = {
        "name": "Ifc",
        "createdAt": "2026-01-01T00:00:00+00:00",
        "sourceFileName": "source.ifc",
        "linkedPath": None,
    }
    (folder / "project.json").write_text(json.dumps(meta), encoding="utf-8")
    (folder / "plan.json").write_text(dump_plan(blank_plan("Ifc")), encoding="utf-8")
    with patch("hero.jobs.detect_surfaces") as detector:
        outcome = execute_import(str(folder), "auto", "auto")
    assert outcome["state"] == "done"
    detector.assert_not_called()
    plan = Plan.model_validate_json((folder / "plan.json").read_text(encoding="utf-8"))
    assert len(plan.levels) == 2
    assert plan.levels[0].walls


def _plan(levels) -> Plan:
    plan = blank_plan("Synthetic")
    plan.levels = levels
    return plan


def _assert_walls(plan: Plan, building) -> None:
    predicted = []
    for level in plan.levels:
        verts = {vertex.id: vertex for vertex in level.vertices}
        for wall in level.walls:
            start = verts[wall.a]
            end = verts[wall.b]
            predicted.append((start.x, start.y, end.x, end.y, wall.thickness))
    for truth in building.walls:
        assert any(_same_wall(item, truth) for item in predicted)


def _same_wall(item, truth) -> bool:
    ax, ay, bx, by, thickness = item
    forward = abs(ax - truth.x1) <= 0.01 and abs(ay - truth.y1) <= 0.01
    forward = forward and abs(bx - truth.x2) <= 0.01 and abs(by - truth.y2) <= 0.01
    backward = abs(ax - truth.x2) <= 0.01 and abs(ay - truth.y2) <= 0.01
    backward = backward and abs(bx - truth.x1) <= 0.01 and abs(by - truth.y1) <= 0.01
    return (forward or backward) and abs(thickness - truth.thickness) <= 0.01


def _room_polygons(plan: Plan) -> list[Polygon]:
    wrapped = wrap(plan.model_dump(mode="json"))
    polygons: list[Polygon] = []
    for level in plan.levels:
        for room in extract_rooms(wrapped, level.id)["rooms"]:
            polygons.append(Polygon([(point["x"], point["y"]) for point in room["polygon"]]))
    return polygons
