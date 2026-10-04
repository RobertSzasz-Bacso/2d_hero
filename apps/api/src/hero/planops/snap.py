"""Snap priority: vertex, midpoint, intersection, foot, extension, angle, grid."""

from __future__ import annotations

from typing import Any

from hero.planops.geom import (
    add,
    dist,
    dot,
    foot_on_line,
    js_round,
    mul,
    rotate,
    segment_intersect,
    sub,
    unit,
)
from hero.planops.tolerances import extension_max_m, grid_m, snap_px

_PRIORITY = {
    "vertex": 1,
    "midpoint": 2,
    "intersection": 3,
    "foot": 4,
    "extension": 5,
    "angle": 6,
    "grid": 7,
}


def _consider(
    found: list[dict[str, Any]],
    kind: str,
    point: dict[str, float],
    cursor: Any,
    tolerance: float,
    item_id: str | None = None,
) -> None:
    distance = dist(point, cursor)
    if distance <= tolerance:
        found.append(
            {"kind": kind, "point": point, "id": item_id, "priority": _PRIORITY[kind],
                "distance": distance}
        )


def snap_point(plan: Any, level_id: str, cursor: Any, pixels_per_meter: float,
    grid: float | None = None, previous: Any = None) -> dict[str, Any] | None:
    if not (pixels_per_meter > 0):
        return None
    tolerance = snap_px / pixels_per_meter
    level = next((item for item in plan.levels if item.id == level_id), None)
    if level is None:
        raise ValueError(f"Unknown level {level_id}")
    vertices = {vertex.id: vertex for vertex in level.vertices}
    candidates: list[dict[str, Any]] = []
    for vertex in level.vertices:
        _consider(candidates, "vertex", {"x": vertex.x, "y": vertex.y}, cursor, tolerance,
            vertex.id)
    segments: list[dict[str, Any]] = []
    for wall in level.walls:
        a = vertices.get(wall.a)
        b = vertices.get(wall.b)
        if a is None or b is None:
            continue
        segments.append({"id": wall.id, "a": a, "b": b})
        _consider(
            candidates,
            "midpoint",
            {"x": (a.x + b.x) / 2, "y": (a.y + b.y) / 2},
            cursor,
            tolerance,
            wall.id,
        )
        foot = foot_on_line(cursor, a, b)
        if foot is None:
            continue
        length = dist(a, b)
        if foot["t"] > 0 and foot["t"] < 1:
            _consider(candidates, "foot", foot["point"], cursor, tolerance, wall.id)
        elif length > 0:
            past = -foot["t"] * length if foot["t"] < 0 else (foot["t"] - 1) * length
            if past > 0 and past <= extension_max_m:
                _consider(candidates, "extension", foot["point"], cursor, tolerance, wall.id)
    for i, left in enumerate(segments):
        for right in segments[i + 1 :]:
            hit = segment_intersect(left["a"], left["b"], right["a"], right["b"])
            if hit is not None:
                _consider(candidates, "intersection", hit["point"], cursor, tolerance, left["id"])
    if previous is not None:
        anchor = {"x": previous.x, "y": previous.y}
        direction = unit({"x": previous.dirX, "y": previous.dirY})
        if direction["x"] != 0 or direction["y"] != 0:
            for degrees in (0, 45, -45, 90, -90):
                ray = rotate(direction, degrees)
                travel = dot(sub(cursor, anchor), ray)
                if travel < 0:
                    continue
                _consider(candidates, "angle", add(anchor, mul(ray, travel)), cursor, tolerance)
    step = grid_m if grid is None else grid
    if step > 0:
        _consider(
            candidates,
            "grid",
            {
                "x": js_round(cursor.x / step) * step,
                "y": js_round(cursor.y / step) * step,
            },
            cursor,
            tolerance,
        )
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item["priority"], item["distance"]))
    best = candidates[0]
    return {"kind": best["kind"], "point": best["point"], "id": best["id"]}
