"""Typed walls, split, and merge. Only the operations the shared vectors call."""

from __future__ import annotations

import copy
import math
from typing import Any

from hero.planops.geom import add, dist, joint_angle_deg, left, mul, sub, unit
from hero.planops.model import Obj, wrap
from hero.planops.ops import set_opening
from hero.planops.tolerances import join_snap_m, ortho_deg


def _clone(plan: Any) -> Any:
    return copy.deepcopy(plan)


def _in_level(plan: Any, level_id: str) -> str:
    if any(level.id == level_id for level in plan.levels):
        return level_id
    if not plan.levels:
        raise ValueError(f"Unknown level {level_id}")
    return plan.levels[0].id


def _level(plan: Any, level_id: str) -> Any:
    for level in plan.levels:
        if level.id == level_id:
            return level
    raise ValueError(f"Unknown level {level_id}")


def _vertex(level: Any, vertex_id: str) -> Any:
    for vertex in level.vertices:
        if vertex.id == vertex_id:
            return vertex
    raise ValueError(f"Unknown vertex {vertex_id}")


def _direction(degrees: float) -> dict[str, float]:
    turns = ((degrees % 360) + 360) % 360
    if turns == 0:
        return {"x": 1.0, "y": 0.0}
    if turns == 90:
        return {"x": 0.0, "y": 1.0}
    if turns == 180:
        return {"x": -1.0, "y": 0.0}
    if turns == 270:
        return {"x": 0.0, "y": -1.0}
    radians = turns * math.pi / 180
    return {"x": math.cos(radians), "y": math.sin(radians)}


def _all_ids(level: Any) -> set[str]:
    used: set[str] = set()
    for group in (
        level.vertices,
        level.walls,
        level.openings,
        level.columns,
        level.stairs,
        level.rooms,
        level.separators,
        level.fixtures,
        level.texts,
        level.dimensions,
    ):
        for item in group:
            used.add(item.id)
    return used


def _next_id(level: Any, prefix: str) -> str:
    used = _all_ids(level)
    for index in range(1, 10000):
        item_id = f"{prefix}{index}"
        if item_id not in used:
            return item_id
    raise ValueError("No free id")


def _nearest(level: Any, point: Any, tolerance: float) -> str | None:
    best: str | None = None
    best_distance = tolerance
    for vertex in level.vertices:
        distance = dist(vertex, point)
        if distance <= best_distance:
            best = vertex.id
            best_distance = distance
    return best


def _push(level: Any, point: Any) -> str:
    item_id = _next_id(level, "v")
    level.vertices.append(Obj({"id": item_id, "x": point.x if hasattr(point,
        "x") else point["x"], "y": point.y if hasattr(point, "y") else point["y"]}))
    return item_id


def add_typed_wall(plan: Any, level_id: str, start: Any, length_m: float, angle_deg: float,
    thickness: float = 0.2) -> Any:
    if not (length_m > 0) or not math.isfinite(length_m):
        raise ValueError("Typed length must be a positive finite length")
    nxt = _clone(plan)
    level = _level(nxt, _in_level(nxt, level_id))
    direction = _direction(angle_deg)
    end = Obj({"x": start.x + direction["x"] * length_m, "y": start.y + direction["y"] * length_m})
    a = _nearest(level, start, join_snap_m) or _push(level, start)
    b = _nearest(level, end, join_snap_m) or _push(level, end)
    if a == b:
        raise ValueError("A wall needs two different vertices")
    level.walls.append(
        Obj({"id": _next_id(level, "w"), "a": a, "b": b, "thickness": thickness,
            "kind": "exterior", "confidence": 1})
    )
    return nxt


def split_wall(plan: Any, level_id: str, wall_id: str, t: float) -> Any:
    if not (t > 0) or not (t < 1):
        raise ValueError("Split the wall between its ends")
    nxt = _clone(plan)
    level = _level(nxt, level_id)
    wall = next((item for item in level.walls if item.id == wall_id), None)
    if wall is None:
        raise ValueError(f"Unknown wall {wall_id}")
    a = _vertex(level, wall.a)
    b = _vertex(level, wall.b)
    middle = _push(level, Obj({"x": a.x + (b.x - a.x) * t, "y": a.y + (b.y - a.y) * t}))
    far = wall.b
    wall.b = middle
    created = _next_id(level, "w")
    level.walls.append(
        Obj(
            {
                "id": created,
                "a": middle,
                "b": far,
                "thickness": wall.thickness,
                "kind": wall.kind,
                "confidence": wall.confidence,
            }
        )
    )
    for opening in level.openings:
        if opening.wall != wall_id:
            continue
        if opening.offset <= t:
            opening.offset = min(1.0, max(0.0, opening.offset / t))
        else:
            opening.wall = created
            opening.offset = min(1.0, max(0.0, (opening.offset - t) / (1 - t)))
    return nxt


def _collinear_neighbor(level: Any, wall: Any) -> Any | None:
    for other in level.walls:
        if other.id == wall.id:
            continue
        shared = next((item for item in (wall.a, wall.b) if item == other.a or item == other.b),
            None)
        if shared is None:
            continue
        here = _vertex(level, shared)
        wall_far = _vertex(level, wall.b if wall.a == shared else wall.a)
        other_far = _vertex(level, other.b if other.a == shared else other.a)
        angle = joint_angle_deg(here, wall_far, other_far)
        if abs(angle - 180) <= ortho_deg:
            return other
    return None


def _referenced(level: Any) -> set[str]:
    used: set[str] = set()
    for wall in level.walls:
        used.add(wall.a)
        used.add(wall.b)
    for separator in level.separators:
        used.add(separator.a)
        used.add(separator.b)
    return used


def merge_collinear_wall(plan: Any, level_id: str, wall_id: str) -> Any:
    nxt = _clone(plan)
    level = _level(nxt, level_id)
    wall = next((item for item in level.walls if item.id == wall_id), None)
    if wall is None:
        raise ValueError(f"Unknown wall {wall_id}")
    neighbor = _collinear_neighbor(level, wall)
    if neighbor is None:
        return nxt
    shared = wall.a if wall.a in {neighbor.a, neighbor.b} else wall.b
    keep_a = wall.b if wall.a == shared else wall.a
    keep_b = neighbor.b if neighbor.a == shared else neighbor.a
    centers: dict[str, dict[str, Any]] = {}
    for opening in level.openings:
        if opening.wall != wall.id and opening.wall != neighbor.id:
            continue
        host = next((item for item in level.walls if item.id == opening.wall), None)
        if host is None:
            continue
        a = _vertex(level, host.a)
        b = _vertex(level, host.b)
        centers[opening.id] = {
            "center": {"x": a.x + (b.x - a.x) * opening.offset,
                "y": a.y + (b.y - a.y) * opening.offset},
            "opening": opening,
        }
    wall.a = keep_a
    wall.b = keep_b
    level.walls = [item for item in level.walls if item.id != neighbor.id]
    start = _vertex(level, keep_a)
    end = _vertex(level, keep_b)
    span = sub(end, start)
    length = math.hypot(span["x"], span["y"]) or 1
    axis = unit(span)
    for opening in level.openings:
        remembered = centers.get(opening.id)
        if remembered is None:
            continue
        opening.wall = wall.id
        center = remembered["center"]
        along = (center["x"] - start.x) * axis["x"] + (center["y"] - start.y) * axis["y"]
        offset = along / length
        opening.offset = min(1.0, max(0.0, offset))
    still = _referenced(level)
    level.vertices = [
        vertex for vertex in level.vertices if vertex.id != shared or vertex.id in still
    ]
    if shared not in still:
        level.vertices = [vertex for vertex in level.vertices if vertex.id != shared]
    return nxt


def _xy(point: Any) -> dict[str, float]:
    return {"x": point["x"], "y": point["y"]}


def wall_from_location(p: Any, q: Any, thickness: float, location: str) -> dict[str, Any]:
    """Centerline of a wall whose location line (centre, left face, or right face) runs p to q."""
    direction = unit(sub(q, p))
    if location == "center" or (direction["x"] == 0 and direction["y"] == 0):
        return {"a": _xy(p), "b": _xy(q)}
    shift = mul(left(direction), -thickness / 2 if location == "left" else thickness / 2)
    return {"a": add(p, shift), "b": add(q, shift)}


def add_rectangle(plan: Any, level_id: str, c1: Any, c2: Any, thickness: float,
    mode: str) -> Any:
    if not (thickness > 0) or thickness > 1.5:
        raise ValueError("Wall thickness must be greater than 0 and at most 1.5 m")
    grow = thickness / 2 if mode == "interior" else 0
    min_x = min(c1["x"], c2["x"]) - grow
    min_y = min(c1["y"], c2["y"]) - grow
    max_x = max(c1["x"], c2["x"]) + grow
    max_y = max(c1["y"], c2["y"]) + grow
    if not (max_x - min_x > thickness) or not (max_y - min_y > thickness):
        raise ValueError("The rectangle is smaller than its walls")
    nxt = _clone(plan)
    level = _level(nxt, _in_level(nxt, level_id))
    corners = [
        Obj({"x": min_x, "y": min_y}),
        Obj({"x": max_x, "y": min_y}),
        Obj({"x": max_x, "y": max_y}),
        Obj({"x": min_x, "y": max_y}),
    ]
    ids = [_nearest(level, corner, join_snap_m) or _push(level, corner) for corner in corners]
    for index, a in enumerate(ids):
        b = ids[(index + 1) % len(ids)]
        if any({wall.a, wall.b} == {a, b} for wall in level.walls):
            continue
        level.walls.append(
            Obj({"id": _next_id(level, "w"), "a": a, "b": b, "thickness": thickness,
                "kind": "exterior", "confidence": 1})
        )
    seeded = any(
        min_x < room.seed.x < max_x and min_y < room.seed.y < max_y for room in level.rooms
    )
    if not seeded:
        center = Obj({"x": (min_x + max_x) / 2, "y": (min_y + max_y) / 2})
        level.rooms.append(
            Obj({"id": _next_id(level, "r"), "name": "Room", "number": "", "seed": center})
        )
    return nxt


def inner_corner_offset(level: Any, wall_id: str, vertex_id: str) -> float:
    half = 0.0
    for wall in level.walls:
        if wall.id != wall_id and vertex_id in (wall.a, wall.b):
            half = max(half, wall.thickness / 2)
    return half


def place_opening_at_distance(plan: Any, level_id: str, wall_id: str, kind: str, end: str,
    distance: float, width: float, swing_side: str = "positive") -> Any:
    if not (distance >= 0) or not math.isfinite(distance):
        raise ValueError("The distance must be zero or more")
    if not (width > 0):
        raise ValueError("The opening width must be greater than 0")
    level = _level(plan, level_id)
    wall = next((item for item in level.walls if item.id == wall_id), None)
    if wall is None:
        raise ValueError(f"Unknown wall {wall_id}")
    length = dist(_vertex(level, wall.a), _vertex(level, wall.b))
    start_corner = inner_corner_offset(level, wall_id, wall.a)
    end_corner = length - inner_corner_offset(level, wall_id, wall.b)
    if end == "a":
        center = start_corner + distance + width / 2
    else:
        center = end_corner - distance - width / 2
    if center - width / 2 < start_corner - 1e-9 or center + width / 2 > end_corner + 1e-9:
        raise ValueError("The opening does not fit between the inner corners")
    nxt = _clone(plan)
    target = _level(nxt, level_id)
    opening_id = _next_id(target, "o")
    target.openings.append(
        Obj(
            {
                "id": opening_id,
                "wall": wall_id,
                "kind": kind,
                "offset": center / length,
                "width": width,
                "sill": 0.9 if kind == "window" else 0,
                "head": 2.1,
                "swing": "none" if kind == "passage" else "left",
                "swingSide": swing_side,
                "confidence": 1,
            }
        )
    )
    return set_opening(nxt, level_id, opening_id, {})


def add_dimension(plan: Any, level_id: str, refs: list[Any], offset: float) -> Any:
    if len(refs) < 2:
        raise ValueError("A dimension needs at least two points")
    if not math.isfinite(offset):
        raise ValueError("The dimension offset must be a number")
    nxt = _clone(plan)
    level = _level(nxt, level_id)
    for ref in refs:
        group = level.vertices if ref["type"] == "vertex" else level.openings
        if not any(item.id == ref["id"] for item in group):
            raise ValueError(f"Unknown {ref['type']} {ref['id']}")
    segments = []
    for a, b in zip(refs, refs[1:], strict=False):
        if dict(a) == dict(b):
            raise ValueError("A dimension segment needs two different points")
        segments.append(wrap({"a": dict(a), "b": dict(b)}))
    level.dimensions.append(
        Obj({"id": _next_id(level, "d"), "auto": False, "offset": offset, "segments": segments})
    )
    return nxt
