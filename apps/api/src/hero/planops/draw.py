"""Typed walls, split, and merge. Only the operations the shared vectors call."""

from __future__ import annotations

import copy
import math
from typing import Any

from hero.planops.geom import dist, joint_angle_deg, sub, unit
from hero.planops.model import Obj
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
