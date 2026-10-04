"""Net rooms from wall polygons and seeds. Same rules as the TypeScript kernel."""

from __future__ import annotations

import math
from typing import Any

from hero.planops.geom import (
    add,
    closest_on_ring,
    dist,
    mul,
    point_in_ring,
    ring_area,
    ring_centroid,
    same_point,
    segment_intersect,
    sub,
    unit,
)
from hero.planops.polygons import free_faces, wall_polygons
from hero.planops.tolerances import join_snap_m, min_room_m2, seed_search_m


def _split_ring(ring: list[Any], a: Any, b: Any) -> list[list[Any]] | None:
    hits: list[dict[str, Any]] = []
    for index, start in enumerate(ring):
        end = ring[(index + 1) % len(ring)]
        hit = segment_intersect(a, b, start, end)
        if hit is None:
            continue
        if any(same_point(item["point"], hit["point"], 1e-8) for item in hits):
            continue
        hits.append({"point": hit["point"], "edge": index, "t": hit["t"]})
    if len(hits) < 2:
        return None
    hits.sort(key=lambda item: item["t"])
    first = hits[0]
    second = hits[-1]
    if same_point(first["point"], second["point"], 1e-8):
        return None
    return [_arc(ring, first, second), _arc(ring, second, first)]


def _arc(ring: list[Any], start: dict[str, Any], stop: dict[str, Any]) -> list[Any]:
    points: list[Any] = [start["point"]]
    count = len(ring)
    index = (start["edge"] + 1) % count
    end_index = (stop["edge"] + 1) % count
    guard = 0
    while index != end_index and guard <= count:
        vertex = ring[index]
        if vertex is not None and not same_point(vertex, points[-1]):
            points.append(vertex)
        index = (index + 1) % count
        guard += 1
    if not same_point(points[-1], stop["point"]):
        points.append(stop["point"])
    return points


def _cut_faces(plan: Any, level_id: str, faces: list[dict[str, Any]]) -> list[dict[str, Any]]:
    level = next((item for item in plan.levels if item.id == level_id), None)
    if level is None:
        return faces
    vertices = {vertex.id: vertex for vertex in level.vertices}
    current = faces
    for separator in level.separators:
        a = vertices.get(separator.a)
        b = vertices.get(separator.b)
        if a is None or b is None:
            continue
        nxt: list[dict[str, Any]] = []
        for face in current:
            parts = _split_ring(face["ring"], a, b)
            if parts is None:
                nxt.append(face)
                continue
            for ring in parts:
                area = abs(ring_area(ring))
                if len(ring) >= 3 and area > 0:
                    nxt.append({"ring": ring, "area": area})
        current = nxt
    return current


def _place_inside(ring: list[Any], seed: Any) -> Any:
    if point_in_ring(seed, ring):
        return seed
    boundary = closest_on_ring(seed, ring)
    centroid = ring_centroid(ring)
    toward = sub(centroid, boundary)
    length = math.hypot(toward["x"], toward["y"])
    if length == 0:
        return centroid if point_in_ring(centroid, ring) else boundary
    nudge = min(length * 0.5, join_snap_m)
    moved = add(boundary, mul(unit(toward), nudge))
    if point_in_ring(moved, ring):
        return moved
    return centroid if point_in_ring(centroid, ring) else moved


def _issue(level_id: str, room_id: str, code: str, message: str) -> dict[str, Any]:
    return {
        "id": f"i-{code}-{room_id}"[:32],
        "severity": "warning",
        "code": code,
        "message": message,
        "levelId": level_id,
        "elementId": room_id,
    }


def extract_rooms(plan: Any, level_id: str) -> dict[str, Any]:
    level = next((item for item in plan.levels if item.id == level_id), None)
    if level is None:
        raise ValueError(f"Unknown level {level_id}")
    polygons = wall_polygons(plan, level_id)
    faces = [
        {"ring": ring, "area": abs(ring_area(ring))}
        for ring in free_faces(polygons)
    ]
    faces = [face for face in faces if face["area"] >= min_room_m2]
    faces = [face for face in _cut_faces(plan, level_id, faces) if face["area"] >= min_room_m2]
    rooms: list[dict[str, Any]] = []
    issues: list[dict[str, Any]] = []
    occupied: dict[int, list[Any]] = {}
    for room in level.rooms:
        inside = next((index for index, face in enumerate(faces) if point_in_ring(room.seed,
            face["ring"])), -1)
        if inside >= 0:
            occupied.setdefault(inside, []).append(room)
            continue
        nearest = -1
        nearest_gap = math.inf
        for index, face in enumerate(faces):
            gap = dist(room.seed, closest_on_ring(room.seed, face["ring"]))
            if gap < nearest_gap:
                nearest = index
                nearest_gap = gap
        if nearest >= 0 and nearest_gap <= seed_search_m:
            occupied.setdefault(nearest, []).append(room)
            continue
        issues.append(_issue(level_id, room.id, "room_seed_lost",
            "The room seed is not inside a free face."))
    for index, seeds in occupied.items():
        face = faces[index]
        if len(seeds) > 1:
            issues.append(
                _issue(level_id, seeds[0].id, "room_not_split",
                    "Two room seeds are in the same face.")
            )
        for seed_room in seeds:
            rooms.append(
                {
                    "id": seed_room.id,
                    "name": seed_room.name,
                    "number": seed_room.number,
                    "seed": _place_inside(face["ring"], seed_room.seed),
                    "polygon": face["ring"],
                    "area": face["area"],
                }
            )
    return {"rooms": rooms, "issues": issues}
