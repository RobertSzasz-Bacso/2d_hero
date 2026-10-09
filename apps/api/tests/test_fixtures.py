"""Fixture symbols from box size. A bare apartment stays empty."""

import math
from pathlib import Path

from hero.ingest.read import read_source
from hero.pipeline.normalize import normalize_scene
from hero.pipeline.planwrite import scan_plan
from hero.schema import Plan
from hero.testkit.building import build_building
from hero.testkit.writers import glb_bytes


def test_bathroom_toilet_and_sink(tmp_path: Path) -> None:
    building = build_building(1, furniture="bathroom")
    plan = _detect(tmp_path, building)
    fixtures = [fixture for level in plan.levels for fixture in level.fixtures]
    toilet = _named(fixtures, "toilet")
    sink = _named(fixtures, "sink")
    assert math.hypot(toilet.x - 1.0, toilet.y - 1.0) <= 0.25
    assert math.hypot(sink.x - 1.2, sink.y - 5.0) <= 0.25
    assert toilet.role == "fixture"
    assert sink.role == "fixture"


def test_bedroom_bed(tmp_path: Path) -> None:
    building = build_building(1, furniture="bedroom")
    plan = _detect(tmp_path, building)
    fixtures = [fixture for level in plan.levels for fixture in level.fixtures]
    bed = _named(fixtures, "bed-double")
    assert math.hypot(bed.x - 2.0, bed.y - 3.6) <= 0.25
    assert bed.role == "furniture"


def test_a_wall_is_not_a_fixture(tmp_path: Path) -> None:
    building = build_building(1, furniture="bathroom")
    plan = _detect(tmp_path, building)
    for level in plan.levels:
        verts = {vertex.id: vertex for vertex in level.vertices}
        for fixture in level.fixtures:
            for wall in level.walls:
                start = verts[wall.a]
                end = verts[wall.b]
                distance = _distance(fixture.x, fixture.y, start.x, start.y, end.x, end.y)
                assert distance > wall.thickness / 2.0 + 0.05


def test_bare_apartment_has_no_fixtures(tmp_path: Path) -> None:
    building = build_building(1, furniture="bare")
    plan = _detect(tmp_path, building)
    assert [fixture for level in plan.levels for fixture in level.fixtures] == []


def test_unknown_cluster_is_a_block(tmp_path: Path) -> None:
    building = build_building(1, furniture="block")
    plan = _detect(tmp_path, building)
    fixtures = [fixture for level in plan.levels for fixture in level.fixtures]
    blocks = [fixture for fixture in fixtures if fixture.symbol == "block"]
    assert blocks
    assert blocks[0].role == "furniture"
    assert blocks[0].confidence == 0.3


def _detect(tmp_path: Path, building) -> Plan:
    path = tmp_path / "building.glb"
    path.write_bytes(glb_bytes(building))
    return scan_plan(normalize_scene(read_source(path)))


def _named(fixtures, symbol):
    found = [fixture for fixture in fixtures if fixture.symbol == symbol]
    assert found, symbol
    return found[0]


def _distance(x: float, y: float, x1: float, y1: float, x2: float, y2: float) -> float:
    dx = x2 - x1
    dy = y2 - y1
    length = math.hypot(dx, dy)
    if length == 0:
        return math.hypot(x - x1, y - y1)
    along = ((x - x1) * dx + (y - y1) * dy) / length
    along = min(max(along, 0.0), length)
    px = x1 + dx / length * along
    py = y1 + dy / length * along
    return math.hypot(x - px, y - py)
