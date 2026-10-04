"""Grip edits. Each matches `apps/web/src/core/grips.ts` and a shared vector."""

from __future__ import annotations

import copy
import math
from typing import Any

from hero.planops.geom import add, dot, foot_on_line, js_round, left, mul, sub
from hero.planops.ops import _level, _vertex, move_wall, set_opening
from hero.planops.tolerances import ortho_deg


def _wall(level: Any, wall_id: str) -> Any:
    wall = next((item for item in level.walls if item.id == wall_id), None)
    if wall is None:
        raise ValueError(f"Unknown wall {wall_id}")
    return wall


def wall_frame(level: Any, wall_id: str) -> dict[str, Any]:
    wall = _wall(level, wall_id)
    a = _vertex(level, wall.a)
    b = _vertex(level, wall.b)
    span = sub(b, a)
    length = math.hypot(span["x"], span["y"])
    if length == 0:
        raise ValueError(f"Wall {wall_id} has no length")
    direction = mul(span, 1 / length)
    return {
        "a": {"x": a.x, "y": a.y},
        "b": {"x": b.x, "y": b.y},
        "dir": direction,
        "normal": left(direction),
        "length": length,
        "thickness": wall.thickness,
    }


def set_wall_thickness_from_face(plan: Any, level_id: str, wall_id: str, thickness: float,
    keep: str) -> Any:
    if not (thickness > 0) or thickness > 1.5:
        raise ValueError("Wall thickness must be greater than 0 and at most 1.5 m")
    frame = wall_frame(_level(plan, level_id), wall_id)
    shift = (frame["thickness"] - thickness) / 2
    if keep == "center":
        nxt = copy.deepcopy(plan)
    else:
        sign = 1 if keep == "left" else -1
        nxt = move_wall(plan, level_id, wall_id, mul(frame["normal"], sign * shift))
    _wall(_level(nxt, level_id), wall_id).thickness = thickness
    return nxt


def clear_distance(level: Any, wall_id: str, other_id: str) -> tuple[float, float]:
    frame = wall_frame(level, wall_id)
    other = wall_frame(level, other_id)
    cos = abs(dot(frame["dir"], other["dir"]))
    if math.degrees(math.acos(min(1.0, cos))) > ortho_deg:
        raise ValueError("The two walls are not parallel")
    d = dot(sub(other["a"], frame["a"]), frame["normal"])
    side = 0.0 if d == 0 else math.copysign(1.0, d)
    return abs(d) - frame["thickness"] / 2 - other["thickness"] / 2, side


def set_clear_distance(plan: Any, level_id: str, wall_id: str, other_id: str,
    distance: float) -> Any:
    if not (distance > 0) or not math.isfinite(distance):
        raise ValueError("Clear distance must be greater than 0")
    level = _level(plan, level_id)
    clear, side = clear_distance(level, wall_id, other_id)
    if side == 0:
        raise ValueError("The two walls share a centerline")
    frame = wall_frame(level, wall_id)
    return move_wall(plan, level_id, wall_id, mul(frame["normal"], -side * (distance - clear)))


def set_opening_edge(plan: Any, level_id: str, opening_id: str, edge: str,
    amount_m: float) -> Any:
    level = _level(plan, level_id)
    opening = next((item for item in level.openings if item.id == opening_id), None)
    if opening is None:
        raise ValueError(f"Unknown opening {opening_id}")
    frame = wall_frame(level, opening.wall)
    width = opening.width + amount_m
    length = frame["length"]
    center_m = opening.offset * length + (amount_m / 2 if edge == "end" else -amount_m / 2)
    if not (width > 0) or center_m - width / 2 < -1e-9 or center_m + width / 2 > length + 1e-9:
        raise ValueError("The opening must stay on its wall")
    return set_opening(plan, level_id, opening_id, {"width": width, "offset": center_m / length})


def rehost_opening(plan: Any, level_id: str, opening_id: str, wall_id: str, point: Any) -> Any:
    level = _level(plan, level_id)
    opening = next((item for item in level.openings if item.id == opening_id), None)
    if opening is None:
        raise ValueError(f"Unknown opening {opening_id}")
    frame = wall_frame(level, wall_id)
    if opening.width >= frame["length"]:
        raise ValueError("The opening is wider than that wall")
    foot = foot_on_line(point, frame["a"], frame["b"])
    half = opening.width / 2 / frame["length"]
    t = min(1 - half, max(half, foot["t"] if foot is not None else 0.5))
    nxt = copy.deepcopy(plan)
    moved = next(item for item in _level(nxt, level_id).openings if item.id == opening_id)
    moved.wall = wall_id
    moved.offset = t
    return nxt


def move_selection(plan: Any, level_id: str, items: list[dict[str, Any]], delta: Any) -> Any:
    dx = float(delta["x"])
    dy = float(delta["y"])
    if not math.isfinite(dx) or not math.isfinite(dy):
        raise ValueError("Move must be finite")
    nxt = copy.deepcopy(plan)
    level = _level(nxt, level_id)

    def ids(kind: str) -> set[str]:
        return {item["id"] for item in items if item["kind"] == kind}

    vertex_ids = ids("vertex")
    for wall in level.walls:
        if wall.id in ids("wall"):
            vertex_ids.update((wall.a, wall.b))
    for separator in level.separators:
        if separator.id in ids("separator"):
            vertex_ids.update((separator.a, separator.b))

    def shift(point: Any) -> None:
        point["x"] = point["x"] + dx
        point["y"] = point["y"] + dy

    for vertex in level.vertices:
        if vertex.id in vertex_ids:
            shift(vertex)
    for kind, collection in (("fixture", level.fixtures), ("column", level.columns),
        ("text", level.texts)):
        chosen = ids(kind)
        for item in collection:
            if item.id in chosen:
                shift(item)
    stairs = ids("stair")
    for stair in level.stairs:
        if stair.id in stairs:
            for point in stair.outline:
                shift(point)
    rooms = ids("room")
    for room in level.rooms:
        if room.id in rooms:
            shift(room.seed)
    return nxt


def snap_rotation(rotation_deg: float, free: bool) -> float:
    if free:
        return rotation_deg
    return js_round(rotation_deg / 15) * 15


def snap_fixture_to_wall(plan: Any, level_id: str, fixture_id: str, tolerance_m: float) -> Any:
    level = _level(plan, level_id)
    fixture = next((item for item in level.fixtures if item.id == fixture_id), None)
    if fixture is None:
        raise ValueError(f"Unknown fixture {fixture_id}")
    center = {"x": fixture.x, "y": fixture.y}
    best: dict[str, Any] | None = None
    for wall in level.walls:
        frame = wall_frame(level, wall.id)
        foot = foot_on_line(center, frame["a"], frame["b"])
        if foot is None or foot["t"] < 0 or foot["t"] > 1:
            continue
        s = dot(sub(center, frame["a"]), frame["normal"])
        gap = abs(s) - frame["thickness"] / 2
        if s == 0 or gap <= 0:
            continue
        back = gap - fixture.depth / 2
        if abs(back) > tolerance_m:
            continue
        if best is None or gap < best["gap"]:
            best = {"gap": gap, "back": back, "into": mul(frame["normal"], math.copysign(1.0, s))}
    if best is None:
        return plan
    nxt = copy.deepcopy(plan)
    moved = next(item for item in _level(nxt, level_id).fixtures if item.id == fixture_id)
    placed = add(center, mul(best["into"], -best["back"]))
    moved.x = placed["x"]
    moved.y = placed["y"]
    angle = math.degrees(math.atan2(best["into"]["x"], -best["into"]["y"]))
    moved.rotationDeg = angle % 360
    return nxt
