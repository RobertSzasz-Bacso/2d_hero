"""Point-cloud ingest. Written before the slab and line extractor."""

from pathlib import Path

import numpy as np
import pytest

from hero.geometry import generate_plan
from hero.pointcloud import generate_from_points
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


def _room_extents(plan: Plan) -> tuple[float, float]:
    xs = [vertex.x for vertex in plan.vertices]
    ys = [vertex.y for vertex in plan.vertices]
    return max(xs) - min(xs), max(ys) - min(ys)


def _assert_room(plan: Plan) -> None:
    assert plan.units == "m"
    assert len(plan.walls) == 4
    assert len(plan.vertices) == 4
    assert _closed_loop(plan)
    width, depth = sorted(_room_extents(plan))
    assert width == pytest.approx(3, abs=0.15)
    assert depth == pytest.approx(4, abs=0.15)


def test_e57_las_and_ply_clouds_draft_the_same_room():
    for name in ("room.e57", "room.las", "room.ply"):
        _assert_room(generate_plan(FIXTURES / name, slice_height=1.2))


def test_tilted_cloud_is_leveled_before_the_slice():
    points = _tilted_room()
    _assert_room(generate_from_points(points, slice_height=1.2))


def _tilted_room() -> np.ndarray:
    rng = np.random.default_rng(2)
    points = []
    walls = [((0, 0), (4, 0)), ((4, 0), (4, 3)), ((4, 3), (0, 3)), ((0, 3), (0, 0))]
    for (x1, y1), (x2, y2) in walls:
        length = float(np.hypot(x2 - x1, y2 - y1))
        steps = int(length / 0.1)
        for index in range(steps + 1):
            weight = index / steps
            x = x1 + (x2 - x1) * weight
            y = y1 + (y2 - y1) * weight
            for z in np.linspace(0, 2.5, 14):
                points.append((x, y, z))
    for x in np.linspace(0.2, 3.8, 12):
        for y in np.linspace(0.2, 2.8, 10):
            points.append((x, y, 0.0))
    cloud = np.array(points, dtype=float)
    cloud += rng.normal(0, 0.004, cloud.shape)
    angle = np.deg2rad(8)
    rotation = np.array(
        [[1, 0, 0], [0, np.cos(angle), -np.sin(angle)], [0, np.sin(angle), np.cos(angle)]],
        dtype=float,
    )
    return cloud @ rotation.T
