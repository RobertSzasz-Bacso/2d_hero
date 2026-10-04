"""USDZ ingest. Written before the parser."""

from pathlib import Path

import pytest

from hero.geometry import generate_plan
from hero.schema import Plan

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"


def _closed_loop(plan: Plan) -> bool:
    if len(plan.walls) < 3 or len(plan.vertices) != len(plan.walls):
        return False
    degree = {vertex.id: 0 for vertex in plan.vertices}
    for wall in plan.walls:
        degree[wall.a] += 1
        degree[wall.b] += 1
    return all(count == 2 for count in degree.values())


def test_usdz_box_slices_to_the_same_rectangle_as_obj():
    plan = generate_plan(FIXTURES / "box.usdz", slice_height=1.2, gap_tolerance=0.05)
    assert isinstance(plan, Plan)
    assert plan.units == "m"
    assert len(plan.vertices) == 4
    assert len(plan.walls) == 4
    assert _closed_loop(plan)
    xs = [vertex.x for vertex in plan.vertices]
    ys = [vertex.y for vertex in plan.vertices]
    width, depth = sorted((max(xs) - min(xs), max(ys) - min(ys)))
    assert width == pytest.approx(3, abs=0.05)
    assert depth == pytest.approx(4, abs=0.05)
