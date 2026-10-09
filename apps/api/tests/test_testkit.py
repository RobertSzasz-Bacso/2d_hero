"""Synthetic buildings, writers, and detection metrics."""

from pathlib import Path
from typing import Any, cast

import pytest
import trimesh

from hero.schema import Plan
from hero.testkit import (
    build_building,
    frame_angle_error,
    opening_scores,
    room_iou,
    thickness_mae,
    wall_iou,
    write_building,
)

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "fixtures" / "synthetic"


def test_same_seed_writes_the_same_glb_bytes(tmp_path: Path) -> None:
    write_building(tmp_path / "a", seed=1)
    write_building(tmp_path / "b", seed=1)
    first = (tmp_path / "a" / "building.glb").read_bytes()
    second = (tmp_path / "b" / "building.glb").read_bytes()
    assert first == second
    assert first == (FIXTURE / "building.glb").read_bytes()


def test_default_plan_matches_schema_v2() -> None:
    building = build_building(seed=1)
    Plan.model_validate(building.plan.model_dump())
    assert building.plan.schemaVersion == 2
    assert len(building.plan.levels) >= 2


def test_default_building_has_a_quarter_metre_wall() -> None:
    building = build_building(seed=1)
    thicknesses = [wall.thickness for level in building.plan.levels for wall in level.walls]
    assert 0.25 in thicknesses


def test_truth_compared_with_itself_scores_perfect_iou_and_recall() -> None:
    building = build_building(seed=1)
    assert wall_iou(building.walls, building.walls) == 1
    assert room_iou(building.rooms, building.rooms) == 1
    _precision, recall = opening_scores(building.openings, building.openings)
    assert recall == 1
    assert thickness_mae(building.walls, building.walls) == 0
    assert frame_angle_error(0, 90) == 0


def test_writers_produce_nontrivial_files(tmp_path: Path) -> None:
    folder = tmp_path / "out"
    written = write_building(folder, seed=1)
    for path in written.values():
        assert path.is_file()
        assert path.stat().st_size > 64
    loaded = cast(Any, trimesh.load(written["building.glb"], force="mesh", process=False))
    assert len(loaded.faces) > 0


@pytest.mark.parametrize(
    "name",
    [
        "building.glb",
        "plan.json",
    ],
)
def test_default_fixture_is_committed(name: str) -> None:
    path = FIXTURE / name
    assert path.is_file()
    assert path.stat().st_size > 64
