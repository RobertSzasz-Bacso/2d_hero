"""Openings, columns, and stairs on the synthetic apartment."""

import math
from pathlib import Path

import pytest
from shapely.geometry import Polygon

from hero.ingest.read import read_source
from hero.pipeline.normalize import normalize_scene
from hero.pipeline.planwrite import scan_plan
from hero.schema import Plan
from hero.testkit.building import build_building
from hero.testkit.metrics import OpeningMark, opening_scores, stair_iou
from hero.testkit.writers import glb_bytes


def test_clean_openings_match_truth(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    building = build_building(1)
    plan = _detect(tmp_path, building)
    predicted = _marks(plan)
    precision, recall = opening_scores(predicted, building.openings)
    width_error, sill_error = _size_errors(plan, building)
    print(
        f"opening precision {precision:.3f} recall {recall:.3f} "
        f"width {width_error:.4f} sill {sill_error:.4f}"
    )
    assert precision >= 0.85
    assert recall >= 0.90
    assert width_error <= 0.05
    assert sill_error <= 0.05
    assert "opening precision" in capsys.readouterr().out


def test_full_height_hole_is_a_passage(tmp_path: Path) -> None:
    building = build_building(1, open_gap=True)
    plan = _detect(tmp_path, building)
    assert _opening_near(plan, 0.0, 3.5) == "passage"


def test_column_is_not_a_short_wall(tmp_path: Path) -> None:
    building = build_building(1)
    plan = _detect(tmp_path, building)
    columns = [column for level in plan.levels for column in level.columns]
    column = min(columns, key=lambda item: math.hypot(item.x - 2.0, item.y - 2.0))
    assert math.hypot(column.x - 2.0, column.y - 2.0) <= 0.25
    assert 0.15 <= column.width <= 0.80
    assert 0.15 <= column.depth <= 0.80
    for level in plan.levels:
        verts = {vertex.id: vertex for vertex in level.vertices}
        for wall in level.walls:
            start = verts[wall.a]
            end = verts[wall.b]
            length = math.hypot(end.x - start.x, end.y - start.y)
            mid_x = (start.x + end.x) / 2.0
            mid_y = (start.y + end.y) / 2.0
            if length < 1.2 and math.hypot(mid_x - 2.0, mid_y - 2.0) < 0.4:
                raise AssertionError("column was written as a short wall")


def test_stair_footprint_overlaps_truth(tmp_path: Path) -> None:
    building = build_building(1)
    plan = _detect(tmp_path, building)
    truth = Polygon([(5.2, 0.4), (6.4, 0.4), (6.4, 3.2), (5.2, 3.2)])
    scores = [
        stair_iou(Polygon([(point.x, point.y) for point in stair.outline]), truth)
        for level in plan.levels
        for stair in level.stairs
    ]
    assert scores
    assert max(scores) >= 0.80


def test_blocked_opening_is_kept_with_low_confidence(tmp_path: Path) -> None:
    building = build_building(1, blocked_opening=True)
    plan = _detect(tmp_path, building)
    assert plan.levels[0].openings
    codes = {issue.code for issue in plan.detection.issues}
    assert "low_confidence_opening" in codes


def _detect(tmp_path: Path, building) -> Plan:
    path = tmp_path / "building.glb"
    path.write_bytes(glb_bytes(building))
    return scan_plan(normalize_scene(read_source(path)))


def _marks(plan: Plan) -> list[OpeningMark]:
    marks: list[OpeningMark] = []
    for level in plan.levels:
        verts = {vertex.id: vertex for vertex in level.vertices}
        walls = {wall.id: wall for wall in level.walls}
        for opening in level.openings:
            wall = walls[opening.wall]
            start = verts[wall.a]
            end = verts[wall.b]
            x = start.x + (end.x - start.x) * opening.offset
            y = start.y + (end.y - start.y) * opening.offset
            marks.append(OpeningMark(opening.kind, x, y, opening.width))
    return marks


def _size_errors(plan: Plan, building) -> tuple[float, float]:
    predicted = _detailed(plan)
    truth = _detailed(building.plan)
    used: set[int] = set()
    width_errors: list[float] = []
    sill_errors: list[float] = []
    for kind, x, y, width, sill in truth:
        match: tuple[float, float] | None = None
        match_index: int | None = None
        for index, other in enumerate(predicted):
            if index in used or other[0] != kind:
                continue
            if math.hypot(other[1] - x, other[2] - y) <= 0.25 and abs(other[3] - width) <= 0.15:
                used.add(index)
                match = (abs(other[3] - width), abs(other[4] - sill))
                match_index = index
                break
        if match is None or match_index is None:
            width_errors.append(1.0)
            sill_errors.append(1.0)
            continue
        width_errors.append(match[0])
        sill_errors.append(match[1])
    return max(width_errors, default=1.0), max(sill_errors, default=1.0)


def _detailed(plan: Plan) -> list[tuple[str, float, float, float, float]]:
    items: list[tuple[str, float, float, float, float]] = []
    for level in plan.levels:
        verts = {vertex.id: vertex for vertex in level.vertices}
        walls = {wall.id: wall for wall in level.walls}
        for opening in level.openings:
            wall = walls[opening.wall]
            start = verts[wall.a]
            end = verts[wall.b]
            x = start.x + (end.x - start.x) * opening.offset
            y = start.y + (end.y - start.y) * opening.offset
            items.append((opening.kind, x, y, opening.width, opening.sill))
    return items


def _opening_near(plan: Plan, x: float, y: float) -> str | None:
    nearest = None
    nearest_distance = 1.0
    for level in plan.levels:
        verts = {vertex.id: vertex for vertex in level.vertices}
        walls = {wall.id: wall for wall in level.walls}
        for opening in level.openings:
            wall = walls[opening.wall]
            start = verts[wall.a]
            end = verts[wall.b]
            ox = start.x + (end.x - start.x) * opening.offset
            oy = start.y + (end.y - start.y) * opening.offset
            distance = math.hypot(ox - x, oy - y)
            if distance < nearest_distance:
                nearest_distance = distance
                nearest = opening.kind
    return nearest
