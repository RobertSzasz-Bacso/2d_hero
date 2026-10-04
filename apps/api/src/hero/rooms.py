"""Closed wall cycles and their areas. The exterior face is left out."""

from __future__ import annotations

import math

from hero.schema import Plan


def detect_rooms(plan: Plan) -> list[dict]:
    positions = {vertex.id: (vertex.x, vertex.y) for vertex in plan.vertices}
    neighbors: dict[str, list[str]] = {vertex.id: [] for vertex in plan.vertices}
    for wall in plan.walls:
        if wall.a not in positions or wall.b not in positions or wall.a == wall.b:
            continue
        neighbors[wall.a].append(wall.b)
        neighbors[wall.b].append(wall.a)
    ordered = {
        vertex_id: sorted(ends, key=lambda other: _angle(positions[vertex_id], positions[other]))
        for vertex_id, ends in neighbors.items()
    }

    def turn(previous: str, current: str) -> str | None:
        ends = ordered.get(current) or []
        if previous not in ends or not ends:
            return None
        return ends[(ends.index(previous) - 1) % len(ends)]

    seen: set[tuple[str, str]] = set()
    cycles: list[list[str]] = []
    for wall in plan.walls:
        for start, nxt in ((wall.a, wall.b), (wall.b, wall.a)):
            if (start, nxt) in seen or start not in positions:
                continue
            cycle = [start]
            previous, current = start, nxt
            guard = 0
            closed = False
            while guard < 10000:
                guard += 1
                seen.add((previous, current))
                if current == start:
                    closed = True
                    break
                cycle.append(current)
                following = turn(previous, current)
                if following is None:
                    break
                previous, current = current, following
            if closed and len(cycle) >= 3:
                cycles.append(cycle)

    unique: list[list[str]] = []
    fingerprints: set[frozenset[str]] = set()
    for cycle in cycles:
        fingerprint = frozenset(cycle)
        if len(fingerprint) < 3 or fingerprint in fingerprints:
            continue
        fingerprints.add(fingerprint)
        unique.append(cycle)

    measured = []
    for cycle in unique:
        polygon = [positions[vertex_id] for vertex_id in cycle]
        area = _shoelace(polygon)
        if area < 1e-4:
            continue
        measured.append({"vertices": cycle, "area": area, "centroid": _centroid(polygon)})
    if len(measured) > 1:
        largest = max(item["area"] for item in measured)
        others = sum(item["area"] for item in measured) - largest
        if largest >= others * 0.9:
            measured = [item for item in measured if item["area"] != largest or item["area"] < largest]
            measured = [item for item in measured if abs(item["area"] - largest) > 1e-6]
    measured.sort(key=lambda item: (-item["area"], item["vertices"]))
    return measured


def room_name(plan: Plan, vertices: list[str]) -> str:
    wanted = set(vertices)
    for room in plan.rooms:
        if set(room.vertices) == wanted and room.name.strip():
            return room.name.strip()
    return ""


def _angle(origin: tuple[float, float], point: tuple[float, float]) -> float:
    return math.atan2(point[1] - origin[1], point[0] - origin[0])


def _shoelace(polygon: list[tuple[float, float]]) -> float:
    total = 0.0
    for index, (x1, y1) in enumerate(polygon):
        x2, y2 = polygon[(index + 1) % len(polygon)]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def _centroid(polygon: list[tuple[float, float]]) -> tuple[float, float]:
    return (
        sum(point[0] for point in polygon) / len(polygon),
        sum(point[1] for point in polygon) / len(polygon),
    )
