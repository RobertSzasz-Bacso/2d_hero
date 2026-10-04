"""The Python plan kernel must pass every shared vector the TypeScript tests pass."""

import json
import math
from pathlib import Path

import pytest
from shapely.geometry import Polygon

from hero.planops.draw import add_typed_wall, merge_collinear_wall, split_wall
from hero.planops.geom import point_in_ring, ring_area
from hero.planops.model import wrap
from hero.planops.ops import (
    apply_typed_dimension,
    move_vertex,
    move_wall,
    remove_selection,
    set_fixture_rotation,
    set_opening,
    set_room_name,
    set_text_content,
    set_wall_thickness,
)
from hero.planops.pick import pick_at
from hero.planops.polygons import max_join_spike_m, wall_polygons
from hero.planops.rooms import extract_rooms
from hero.planops.snap import snap_point
from hero.planops.tolerances import miter_limit, ortho_deg

_VECTORS = Path(__file__).resolve().parents[3] / "shared" / "vectors"


def _cases() -> list[dict]:
    return [json.loads(path.read_text(encoding="utf-8")) for path in 
        sorted(_VECTORS.glob("*.json"))]


def _level(plan, level_id):
    for level in plan.levels:
        if level.id == level_id:
            return level
    raise AssertionError(f"missing level {level_id}")


def _vertices(plan, level_id):
    return {vertex.id: vertex for vertex in _level(plan, level_id).vertices}


def _wall_angle(plan, level_id, wall_id) -> float:
    level = _level(plan, level_id)
    wall = next(item for item in level.walls if item.id == wall_id)
    verts = _vertices(plan, level_id)
    a = verts[wall.a]
    b = verts[wall.b]
    return math.degrees(math.atan2(b.y - a.y, b.x - a.x))


def _angle_delta(left: float, right: float) -> float:
    delta = abs(left - right) % 180
    return min(delta, 180 - delta)


def _segments_cross(a, b, c, d) -> bool:
    abx, aby = b["x"] - a["x"], b["y"] - a["y"]
    acx, acy = c["x"] - a["x"], c["y"] - a["y"]
    adx, ady = d["x"] - a["x"], d["y"] - a["y"]
    cdx, cdy = d["x"] - c["x"], d["y"] - c["y"]
    cax, cay = a["x"] - c["x"], a["y"] - c["y"]
    cbx, cby = b["x"] - c["x"], b["y"] - c["y"]
    left_turn = (abx * acy - aby * acx) * (abx * ady - aby * adx)
    right_turn = (cdx * cay - cdy * cax) * (cdx * cby - cdy * cbx)
    return left_turn < 0 and right_turn < 0


def _self_intersects(ring) -> bool:
    count = len(ring)
    for i in range(count):
        a = ring[i]
        b = ring[(i + 1) % count]
        for j in range(i + 1, count):
            if abs(i - j) <= 1 or (i == 0 and j == count - 1):
                continue
            c = ring[j]
            d = ring[(j + 1) % count]
            if _segments_cross(a, b, c, d):
                return True
    return False


def _distance_to_segment(point, a, b) -> float:
    dx = b.x - a.x
    dy = b.y - a.y
    length2 = dx * dx + dy * dy
    if length2 == 0:
        return math.hypot(point["x"] - a.x, point["y"] - a.y)
    t = min(1, max(0, ((point["x"] - a.x) * dx + (point["y"] - a.y) * dy) / length2))
    return math.hypot(point["x"] - (a.x + t * dx), point["y"] - (a.y + t * dy))


def test_shared_vectors_exist() -> None:
    names = [item["name"] for item in _cases()]
    assert len(names) >= 8
    assert "rectangle-net-area" in names


@pytest.mark.parametrize("raw", _cases(), ids=lambda item: item["name"])
def test_shared_vector(raw: dict) -> None:
    vector = wrap(raw)
    op = vector.op
    plan = vector.input.plan
    level_id = vector.input.levelId
    if op == "rooms":
        _assert_rooms(vector)
    elif op == "wallPolygons":
        _assert_polygons(vector)
    elif op == "moveWall":
        _assert_moved(vector, move_wall(plan, level_id, vector.input.wallId, vector.input.delta))
    elif op == "typedDimension":
        nxt = apply_typed_dimension(
            plan,
            level_id,
            {"a": vector.input.a, "b": vector.input.b, "lengthM": vector.input.lengthM},
        )
        _assert_moved(vector, nxt)
    elif op == "snap":
        hit = snap_point(
            plan,
            level_id,
            vector.input.cursor,
            vector.input.pixelsPerMeter or 1,
            getattr(vector.input, "gridM", None),
            getattr(vector.input, "previous", None),
        )
        assert hit is not None
        assert hit["kind"] == vector.expect.kind
        if getattr(vector.expect, "id", None):
            assert hit["id"] == vector.expect.id
        assert hit["point"]["x"] == vector.expect.point.x
        assert hit["point"]["y"] == vector.expect.point.y
    elif op == "setWallThickness":
        nxt = set_wall_thickness(plan, level_id, vector.input.wallId, vector.input.thickness)
        wall = next(item for item in _level(nxt, level_id).walls if item.id == vector.expect.wallId)
        assert wall.thickness == vector.expect.thickness
    elif op == "setRoomName":
        nxt = set_room_name(plan, level_id, vector.input.roomId, vector.input.name,
            getattr(vector.input, "number", None))
        room = next(item for item in _level(nxt, level_id).rooms if item.id == vector.expect.roomId)
        assert room.name == vector.expect.name
        assert room.number == vector.expect.number
    elif op == "setOpening":
        nxt = set_opening(plan, level_id, vector.input.openingId, dict(vector.input.opening))
        opening = next(item for item in _level(nxt,
            level_id).openings if item.id == vector.expect.openingId)
        assert opening.width == vector.expect.width
        assert opening.swing == vector.expect.swing
    elif op == "moveVertex":
        nxt = move_vertex(plan, level_id, vector.input.vertexId, vector.input.point)
        vertex = _vertices(nxt, level_id)[vector.expect.vertexId]
        assert vertex.x == vector.expect.point.x
        assert vertex.y == vector.expect.point.y
    elif op == "pick":
        hits = pick_at(plan, level_id, vector.input.point, vector.input.toleranceM or 0)
        assert hits[0]["kind"] == vector.expect.firstKind
        assert hits[0]["id"] == vector.expect.firstId
    elif op == "removeSelection":
        nxt = remove_selection(plan, level_id, list(vector.input.ids))
        assert len(_level(nxt, level_id).walls) == vector.expect.wallCount
    elif op == "setFixtureRotation":
        nxt = set_fixture_rotation(plan, level_id, vector.input.fixtureId, vector.input.rotationDeg)
        fixture = next(item for item in _level(nxt,
            level_id).fixtures if item.id == vector.input.fixtureId)
        assert fixture.rotationDeg == vector.expect.rotationDeg
    elif op == "typedWall":
        nxt = add_typed_wall(plan, level_id, vector.input.point, vector.input.lengthM,
            vector.input.angleDeg)
        level = _level(nxt, level_id)
        wall = level.walls[-1]
        end = next(vertex for vertex in level.vertices if vertex.id == wall.b)
        assert abs(end.x - vector.expect.point.x) <= 0.001
        assert abs(end.y - vector.expect.point.y) <= 0.001
    elif op == "splitMerge":
        before = len(_level(plan, level_id).walls)
        ratio = getattr(vector.input, "t", None)
        split = split_wall(plan, level_id, vector.input.wallId, 0.5 if ratio is None else ratio)
        merged = merge_collinear_wall(split, level_id, vector.input.wallId)
        assert len(_level(merged, level_id).walls) == before
    elif op == "setText":
        nxt = set_text_content(plan, level_id, vector.input.textId, vector.input.text)
        text = next(item for item in _level(nxt, level_id).texts if item.id == vector.input.textId)
        assert text.text == vector.expect.text
    else:
        raise AssertionError(f"unknown op {op}")


def _assert_rooms(vector) -> None:
    result = extract_rooms(vector.input.plan, vector.input.levelId)
    areas = [{"id": room["id"], "area": room["area"]} for room in result["rooms"]]
    expected = list(vector.expect.areas or [])
    assert vector.expect.areaTolerance == 0.01
    assert len(areas) == len(expected)
    for item in expected:
        found = next(area for area in areas if area["id"] == item.id)
        assert abs(found["area"] - item.area) <= 0.01
        gross = getattr(vector.expect, "grossCenterlineArea", None)
        if gross is not None:
            assert abs(found["area"] - gross) > 0.01
    codes = sorted(issue["code"] for issue in result["issues"])
    assert codes == sorted(vector.expect.issueCodes or [])
    enclosed = getattr(vector.expect, "enclosedRoom", None)
    if enclosed is not None:
        assert (len(result["rooms"]) > 0) is enclosed
    for room_id in getattr(vector.expect, "seedInside", None) or []:
        room = next(item for item in result["rooms"] if item["id"] == room_id)
        assert point_in_ring(room["seed"], room["polygon"])


def _assert_polygons(vector) -> None:
    polys = wall_polygons(vector.input.plan, vector.input.levelId)
    assert polys
    for poly in polys:
        assert len(poly["ring"]) >= 3
        assert abs(ring_area(poly["ring"])) > 0
        assert _self_intersects(poly["ring"]) is False
    spike = max_join_spike_m(vector.input.plan, vector.input.levelId, polys)
    thickness = max(wall.thickness for wall in _level(vector.input.plan,
        vector.input.levelId).walls)
    assert spike <= miter_limit * thickness
    corner = getattr(vector.expect, "outerCorner", None)
    if corner is not None:
        nearest = min(
            math.hypot(vertex["x"] - corner.x,
                vertex["y"] - corner.y) for poly in polys for vertex in poly["ring"]
        )
        assert nearest <= 1e-6
    butt_id = getattr(vector.expect, "buttId", None)
    host_id = getattr(vector.expect, "hostId", None)
    if butt_id and host_id:
        butt = next(poly for poly in polys if poly["wallId"] == butt_id)
        host = next(poly for poly in polys if poly["wallId"] == host_id)
        overlap = Polygon([(p["x"], p["y"]) for p in butt["ring"]]).intersection(
            Polygon([(p["x"], p["y"]) for p in host["ring"]])
        )
        assert overlap.area <= 1e-6
        host_wall = next(wall for wall in _level(vector.input.plan,
            vector.input.levelId).walls if wall.id == host_id)
        verts = _vertices(vector.input.plan, vector.input.levelId)
        a = verts[host_wall.a]
        b = verts[host_wall.b]
        face = host_wall.thickness / 2
        clearances = [_distance_to_segment(point, a, b) for point in butt["ring"]]
        assert min(clearances) >= face - 1e-6
        assert min(clearances) <= face + 1e-4


def _reference_angle(vector) -> float | None:
    if getattr(vector.input, "wallId", None):
        return _wall_angle(vector.input.plan, vector.input.levelId, vector.input.wallId)
    a = getattr(vector.input, "a", None)
    b = getattr(vector.input, "b", None)
    if a is not None and b is not None and getattr(a, "id", None) and getattr(b, "id", None):
        verts = _vertices(vector.input.plan, vector.input.levelId)
        start = verts[a.id]
        end = verts[b.id]
        return math.degrees(math.atan2(end.y - start.y, end.x - start.x))
    return None


def _assert_moved(vector, plan) -> None:
    verts = _vertices(plan, vector.input.levelId)
    for vertex_id, point in (vector.expect.vertices or {}).items():
        vertex = verts[vertex_id]
        assert vertex.x == point.x
        assert vertex.y == point.y
    base = _reference_angle(vector)
    if base is None:
        return
    for wall_id in vector.expect.orthogonalWalls or []:
        angle = _wall_angle(plan, vector.input.levelId, wall_id)
        assert abs(_angle_delta(base, angle) - 90) <= ortho_deg
