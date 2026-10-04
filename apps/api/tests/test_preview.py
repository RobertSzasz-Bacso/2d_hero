"""3D preview and slice height. Written before the viewer payload."""

from pathlib import Path

import pytest

from hero.geometry import generate_plan
from hero.preview import build_preview

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"


def _spans(plan) -> tuple[float, float]:
    xs = [vertex.x for vertex in plan.vertices]
    ys = [vertex.y for vertex in plan.vertices]
    return max(xs) - min(xs), max(ys) - min(ys)


def test_slice_height_selects_the_level():
    low = generate_plan(FIXTURES / "two_levels.obj", slice_height=1.0)
    high = generate_plan(FIXTURES / "two_levels.obj", slice_height=2.2)
    low_x, low_y = sorted(_spans(low))
    high_x, high_y = _spans(high)
    assert low_x == pytest.approx(3, abs=0.08)
    assert low_y == pytest.approx(4, abs=0.08)
    assert high_x == pytest.approx(2, abs=0.08)
    assert high_y == pytest.approx(2, abs=0.08)


def test_preview_is_a_z_up_mesh_for_an_obj_and_points_for_a_cloud():
    mesh = build_preview(FIXTURES / "box.obj")
    assert mesh["kind"] == "mesh"
    assert len(mesh["positions"]) % 3 == 0
    assert mesh["indices"]
    assert mesh["ceiling"] > mesh["floor"]
    cloud = build_preview(FIXTURES / "room.ply")
    assert cloud["kind"] == "points"
    assert len(cloud["positions"]) > 30
    assert cloud["ceiling"] > cloud["floor"]
