"""Pick hits in the same rank order as the editor. The index is a plain box test."""

from __future__ import annotations

import math
from typing import Any

from hero.planops.geom import dist, distance_to_segment, point_in_ring
from hero.planops.rooms import extract_rooms

_RANK = {
    "vertex": 0,
    "opening": 1,
    "column": 2,
    "fixture": 3,
    "wall": 4,
    "separator": 5,
    "text": 6,
    "room": 7,
}


def _box(x: float, y: float, pad: float) -> dict[str, float]:
    return {"minX": x - pad, "minY": y - pad, "maxX": x + pad, "maxY": y + pad}


def _segment_box(a: Any, b: Any, pad: float) -> dict[str, float]:
    return {
        "minX": min(a.x, b.x) - pad,
        "minY": min(a.y, b.y) - pad,
        "maxX": max(a.x, b.x) + pad,
        "maxY": max(a.y, b.y) + pad,
    }


def _hits_box(item: dict[str, Any], query: dict[str, float]) -> bool:
    return not (
        item["maxX"] < query["minX"]
        or item["minX"] > query["maxX"]
        or item["maxY"] < query["minY"]
        or item["minY"] > query["maxY"]
    )


def pick_at(plan: Any, level_id: str, point: Any, tolerance_m: float) -> list[dict[str, Any]]:
    level = next((item for item in plan.levels if item.id == level_id), None)
    if level is None:
        raise ValueError(f"Unknown level {level_id}")
    vertices = {vertex.id: vertex for vertex in level.vertices}
    items: list[dict[str, Any]] = []
    for vertex in level.vertices:
        items.append({**_box(vertex.x, vertex.y, 0), "kind": "vertex", "id": vertex.id})
    for wall in level.walls:
        a = vertices.get(wall.a)
        b = vertices.get(wall.b)
        if a is None or b is None:
            continue
        items.append({**_segment_box(a, b, wall.thickness / 2), "kind": "wall", "id": wall.id})
    for opening in level.openings:
        wall = next((item for item in level.walls if item.id == opening.wall), None)
        if wall is None:
            continue
        a = vertices.get(wall.a)
        b = vertices.get(wall.b)
        if a is None or b is None:
            continue
        dx = b.x - a.x
        dy = b.y - a.y
        center_x = a.x + dx * opening.offset
        center_y = a.y + dy * opening.offset
        half = opening.width / 2
        length = math.hypot(dx, dy) or 1
        along_x = (dx / length) * half
        along_y = (dy / length) * half
        start = type("P", (), {"x": center_x - along_x, "y": center_y - along_y})()
        end = type("P", (), {"x": center_x + along_x, "y": center_y + along_y})()
        items.append({**_segment_box(start, end, wall.thickness / 2), "kind": "opening",
            "id": opening.id})
    for column in level.columns:
        items.append({**_box(column.x, column.y, max(column.width, column.depth) / 2),
            "kind": "column", "id": column.id})
    for fixture in level.fixtures:
        items.append({**_box(fixture.x, fixture.y, max(fixture.width, fixture.depth) / 2),
            "kind": "fixture", "id": fixture.id})
    for text in level.texts:
        items.append({**_box(text.x, text.y, text.heightM), "kind": "text", "id": text.id})
    for separator in level.separators:
        a = vertices.get(separator.a)
        b = vertices.get(separator.b)
        if a is None or b is None:
            continue
        items.append({**_segment_box(a, b, 0), "kind": "separator", "id": separator.id})
    rooms = extract_rooms(plan, level_id)["rooms"]
    for room in rooms:
        min_x = min(vertex["x"] for vertex in room["polygon"])
        min_y = min(vertex["y"] for vertex in room["polygon"])
        max_x = max(vertex["x"] for vertex in room["polygon"])
        max_y = max(vertex["y"] for vertex in room["polygon"])
        items.append({"minX": min_x, "minY": min_y, "maxX": max_x, "maxY": max_y,
            "kind": "room", "id": room["id"]})
    query = _box(point.x, point.y, tolerance_m)
    hits: list[dict[str, Any]] = []
    for item in items:
        if not _hits_box(item, query):
            continue
        distance = _precise(level, vertices, rooms, item, point)
        if distance is None or (distance > tolerance_m and not _covers(item["kind"], distance,
            level, item["id"], tolerance_m)):
            continue
        hits.append({"kind": item["kind"], "id": item["id"], "distance": distance})
    hits.sort(key=lambda hit: (_RANK[hit["kind"]], hit["distance"]))
    return hits


def _covers(kind: str, distance: float, level: Any, item_id: str, tolerance_m: float) -> bool:
    if kind not in {"wall", "opening"}:
        return distance <= tolerance_m
    if kind == "wall":
        wall = next((item for item in level.walls if item.id == item_id), None)
    else:
        opening = next((item for item in level.openings if item.id == item_id), None)
        wall = next((item for item in level.walls if opening is not None and item.id == 
            opening.wall), None)
    thickness = 0 if wall is None else wall.thickness
    return distance <= thickness / 2 + tolerance_m


def _precise(level: Any, vertices: dict[str, Any], rooms: list[dict[str, Any]], item: dict[str,
    Any], point: Any) -> float | None:
    kind = item["kind"]
    if kind == "vertex":
        vertex = vertices.get(item["id"])
        return None if vertex is None else dist(point, vertex)
    if kind in {"wall", "separator"}:
        ends = next(
            (entry for entry in (level.walls if kind == "wall" else level.separators) if 
                entry.id == item["id"]),
            None,
        )
        if ends is None:
            return None
        a = vertices.get(ends.a)
        b = vertices.get(ends.b)
        if a is None or b is None:
            return None
        return distance_to_segment(point, a, b)
    if kind == "opening":
        opening = next((entry for entry in level.openings if entry.id == item["id"]), None)
        wall = next((entry for entry in level.walls if opening is not None and entry.id == 
            opening.wall), None)
        if opening is None or wall is None:
            return None
        a = vertices.get(wall.a)
        b = vertices.get(wall.b)
        if a is None or b is None:
            return None
        dx = b.x - a.x
        dy = b.y - a.y
        length = math.hypot(dx, dy) or 1
        center = {"x": a.x + dx * opening.offset, "y": a.y + dy * opening.offset}
        half = opening.width / 2
        along = {"x": (dx / length) * half, "y": (dy / length) * half}
        return distance_to_segment(
            point,
            {"x": center["x"] - along["x"], "y": center["y"] - along["y"]},
            {"x": center["x"] + along["x"], "y": center["y"] + along["y"]},
        )
    if kind == "room":
        room = next((entry for entry in rooms if entry["id"] == item["id"]), None)
        if room is None:
            return None
        if point_in_ring(point, room["polygon"]):
            return 0.0
        return _ring_distance(point, room["polygon"])
    if kind == "column":
        column = next((entry for entry in level.columns if entry.id == item["id"]), None)
        return None if column is None else dist(point, column)
    if kind == "fixture":
        fixture = next((entry for entry in level.fixtures if entry.id == item["id"]), None)
        return None if fixture is None else dist(point, fixture)
    text = next((entry for entry in level.texts if entry.id == item["id"]), None)
    return None if text is None else dist(point, text)


def _ring_distance(point: Any, ring: list[Any]) -> float:
    best = math.inf
    for index, a in enumerate(ring):
        b = ring[(index + 1) % len(ring)]
        best = min(best, distance_to_segment(point, a, b))
    return best
