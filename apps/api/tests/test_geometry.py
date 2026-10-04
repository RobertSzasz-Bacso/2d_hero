"""Draft floor plans from meshes and IFC, written before the pipeline."""

from pathlib import Path

import pytest

from hero.geometry import generate_plan
from hero.schema import Plan

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"


def _by_id(plan: Plan):
    return {vertex.id: vertex for vertex in plan.vertices}


def _closed_loop(plan: Plan) -> bool:
    if len(plan.walls) < 3 or len(plan.vertices) != len(plan.walls):
        return False
    degree: dict[str, int] = {vertex.id: 0 for vertex in plan.vertices}
    for wall in plan.walls:
        degree[wall.a] += 1
        degree[wall.b] += 1
    return all(count == 2 for count in degree.values())


def _extents(plan: Plan) -> tuple[float, float]:
    xs = [vertex.x for vertex in plan.vertices]
    ys = [vertex.y for vertex in plan.vertices]
    return max(xs) - min(xs), max(ys) - min(ys)


def test_box_obj_slices_to_a_rectangle():
    plan = generate_plan(FIXTURES / "box.obj", slice_height=1.2, gap_tolerance=0.05)
    assert isinstance(plan, Plan)
    assert len(plan.vertices) == 4
    assert len(plan.walls) == 4
    assert _closed_loop(plan)
    width, depth = sorted(_extents(plan))
    assert width == pytest.approx(3, abs=0.05)
    assert depth == pytest.approx(4, abs=0.05)


def test_box_glb_slices_to_a_rectangle():
    plan = generate_plan(FIXTURES / "box.glb", slice_height=1.2, gap_tolerance=0.05)
    assert len(plan.vertices) == 4
    assert len(plan.walls) == 4
    assert _closed_loop(plan)
    width, depth = sorted(_extents(plan))
    assert width == pytest.approx(3, abs=0.05)
    assert depth == pytest.approx(4, abs=0.05)


def test_small_gaps_heal_into_one_closed_loop():
    plan = generate_plan(FIXTURES / "almost_closed.obj", slice_height=1.2, gap_tolerance=0.25)
    assert len(plan.walls) == 4
    assert _closed_loop(plan)


def test_nearly_axis_wall_snaps_orthogonal():
    plan = generate_plan(FIXTURES / "tilted.obj", slice_height=1.2, gap_tolerance=0.05)
    assert len(plan.walls) == 1
    wall = plan.walls[0]
    ends = _by_id(plan)
    start, end = ends[wall.a], ends[wall.b]
    assert start.y == pytest.approx(end.y)
    assert abs(start.x - end.x) == pytest.approx(4, abs=0.05)


def test_ifc_two_walls_are_meter_segments():
    plan = generate_plan(FIXTURES / "two_walls.ifc")
    assert plan.units == "m"
    assert len(plan.walls) == 2
    ends = _by_id(plan)
    lengths = sorted(
        ((ends[wall.a].x - ends[wall.b].x) ** 2 + (ends[wall.a].y - ends[wall.b].y) ** 2) ** 0.5
        for wall in plan.walls
    )
    assert lengths[0] == pytest.approx(3, abs=0.05)
    assert lengths[1] == pytest.approx(5, abs=0.05)


def test_gapped_room_keeps_the_large_gap():
    plan = generate_plan(FIXTURES / "gapped.obj", slice_height=1.2, gap_tolerance=0.2)
    assert len(plan.walls) == 4
    assert not _closed_loop(plan)
    assert len(plan.vertices) == 5
