"""Learned cleanup behind the plan schema.

The live path is a deterministic stand-in for RoomFormer-style vector cleanup.
It never downloads weights. If HERO_CLEANUP_MODEL points at a local JSON plan
that is already on disk, that fixture is schema-checked and returned instead.
"""

from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Protocol

from hero.schema import Dimension, Plan, Room, Vertex, Wall

MERGE_METERS = 0.2
SNAP_DEGREES = 8.0


class PlanCleanup(Protocol):
    def clean(self, plan: Plan) -> Plan: ...


class ScriptedCleanup:
    def __init__(self, payload: Plan | dict) -> None:
        self.payload = payload

    def clean(self, plan: Plan) -> Plan:
        del plan
        if isinstance(self.payload, Plan):
            return self.payload
        return Plan.model_validate(self.payload)


class DeterministicCleanup:
    """Close tiny gaps and snap near-axis walls. No network and no weights."""

    def clean(self, plan: Plan) -> Plan:
        if len(plan.vertices) < 2 or not plan.walls:
            return plan
        coords = {vertex.id: [vertex.x, vertex.y] for vertex in plan.vertices}
        walls = [[wall.id, wall.a, wall.b] for wall in plan.walls]
        remap = {vertex_id: vertex_id for vertex_id in coords}
        for _ in range(4):
            _snap(coords, walls)
            step = _merge_close(coords, walls, MERGE_METERS)
            remap = {original: step.get(current, current) for original, current in remap.items()}
        walls = [wall for wall in walls if wall[1] in coords and wall[2] in coords and _distance(coords[wall[1]], coords[wall[2]]) > 1e-4]
        used = {vertex_id for wall in walls for vertex_id in wall[1:]}
        vertices = [
            Vertex(id=vertex_id, x=round(coords[vertex_id][0], 6), y=round(coords[vertex_id][1], 6))
            for vertex_id in coords
            if vertex_id in used
        ]
        kept_walls = [Wall(id=wall_id, a=start, b=end) for wall_id, start, end in walls]
        kept_ids = {wall.id for wall in kept_walls}
        openings = [opening for opening in plan.openings if opening.wall in kept_ids]
        dimensions = []
        for dimension in plan.dimensions:
            start, end = remap.get(dimension.a, dimension.a), remap.get(dimension.b, dimension.b)
            if start in coords and end in coords and start != end and start in used and end in used:
                dimensions.append(Dimension(id=dimension.id, a=start, b=end, offset=dimension.offset))
        rooms = []
        for room in plan.rooms:
            vertex_ids = []
            for vertex_id in room.vertices:
                mapped = remap.get(vertex_id, vertex_id)
                if mapped in used and mapped not in vertex_ids:
                    vertex_ids.append(mapped)
            if len(vertex_ids) >= 3:
                rooms.append(Room(id=room.id, name=room.name, vertices=vertex_ids))
        return Plan(
            vertices=vertices,
            walls=kept_walls,
            annotations=list(plan.annotations),
            openings=openings,
            dimensions=dimensions,
            rooms=rooms,
        )


class LearnedCleanup:
    def clean(self, plan: Plan) -> Plan:
        fixture = os.environ.get("HERO_CLEANUP_MODEL")
        if fixture and Path(fixture).is_file():
            return Plan.model_validate_json(Path(fixture).read_text())
        return DeterministicCleanup().clean(plan)


def _snap(coords: dict[str, list[float]], walls: list[list[str]]) -> None:
    for _wall_id, start, end in walls:
        if start not in coords or end not in coords:
            continue
        x1, y1 = coords[start]
        x2, y2 = coords[end]
        angle = abs(math.degrees(math.atan2(y2 - y1, x2 - x1))) % 180
        to_horizontal = min(angle, 180 - angle)
        to_vertical = abs(angle - 90)
        if to_horizontal <= SNAP_DEGREES and to_horizontal <= to_vertical:
            y = (y1 + y2) / 2
            coords[start][1] = y
            coords[end][1] = y
        elif to_vertical <= SNAP_DEGREES:
            x = (x1 + x2) / 2
            coords[start][0] = x
            coords[end][0] = x


def _merge_close(coords: dict[str, list[float]], walls: list[list[str]], tolerance: float) -> dict[str, str]:
    ids = list(coords)
    parent = {vertex_id: vertex_id for vertex_id in ids}

    def find(vertex_id: str) -> str:
        while parent[vertex_id] != vertex_id:
            parent[vertex_id] = parent[parent[vertex_id]]
            vertex_id = parent[vertex_id]
        return vertex_id

    for index, left in enumerate(ids):
        for right in ids[index + 1 :]:
            if _distance(coords[left], coords[right]) <= tolerance:
                parent[find(right)] = find(left)
    groups: dict[str, list[str]] = {}
    for vertex_id in ids:
        groups.setdefault(find(vertex_id), []).append(vertex_id)
    remap: dict[str, str] = {}
    for members in groups.values():
        keeper = sorted(members)[0]
        coords[keeper] = [
            sum(coords[member][0] for member in members) / len(members),
            sum(coords[member][1] for member in members) / len(members),
        ]
        for member in members:
            remap[member] = keeper
            if member != keeper:
                coords.pop(member, None)
    seen: set[tuple[str, str]] = set()
    kept: list[list[str]] = []
    for wall_id, start, end in walls:
        start, end = remap.get(start, start), remap.get(end, end)
        if start == end or start not in coords or end not in coords:
            continue
        key = tuple(sorted((start, end)))
        if key in seen:
            continue
        seen.add(key)
        kept.append([wall_id, start, end])
    walls[:] = kept
    return remap


def _distance(first: list[float], second: list[float]) -> float:
    return math.hypot(first[0] - second[0], first[1] - second[1])
