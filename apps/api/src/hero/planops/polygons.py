"""Wall poche polygons. Miters match the TypeScript kernel; clipping uses Shapely."""

from __future__ import annotations

import math
from typing import Any

from shapely.geometry import Polygon
from shapely.ops import unary_union

from hero.planops.geom import (
    add,
    dedupe_ring,
    dist,
    foot_on_line,
    left,
    line_intersect,
    mul,
    right,
    ring_area,
    sub,
    unit,
)
from hero.planops.model import Obj
from hero.planops.tolerances import join_snap_m, miter_limit


def _level(plan: Any, level_id: str) -> Any:
    for level in plan.levels:
        if level.id == level_id:
            return level
    raise ValueError(f"Unknown level {level_id}")


def _vertices(level: Any) -> dict[str, Any]:
    return {vertex.id: vertex for vertex in level.vertices}


def _point_of(vertices: dict[str, Any], vertex_id: str) -> Any:
    point = vertices.get(vertex_id)
    if point is None:
        raise ValueError(f"Unknown vertex {vertex_id}")
    return point


def _cluster_ends(ends: list[dict[str, Any]]) -> list[dict[str, Any]]:
    parent = list(range(len(ends)))

    def find(index: int) -> int:
        cursor = index
        while parent[cursor] != cursor:
            parent[cursor] = parent[parent[cursor]]
            cursor = parent[cursor]
        return cursor

    def unite(left_index: int, right_index: int) -> None:
        parent[find(left_index)] = find(right_index)

    for i, end in enumerate(ends):
        for j in range(i + 1, len(ends)):
            other = ends[j]
            if end["wallId"] == other["wallId"]:
                continue
            if dist(end["point"], other["point"]) <= join_snap_m:
                unite(i, j)
    groups: dict[int, list[dict[str, Any]]] = {}
    for index, end in enumerate(ends):
        groups.setdefault(find(index), []).append(end)
    clusters: list[dict[str, Any]] = []
    for members in groups.values():
        joint = {
            "x": sum(float(end["point"].x) for end in members) / len(members),
            "y": sum(float(end["point"].y) for end in members) / len(members),
        }
        clusters.append({"ends": members, "joint": joint, "host": None})
    return clusters


def _mark_junctions(level: Any, vertices: dict[str, Any], clusters: list[dict[str, Any]]) -> None:
    for cluster in clusters:
        if len(cluster["ends"]) != 1:
            continue
        end = cluster["ends"][0]
        best: dict[str, Any] | None = None
        for wall in level.walls:
            if wall.id == end["wallId"]:
                continue
            a = _point_of(vertices, wall.a)
            b = _point_of(vertices, wall.b)
            foot = foot_on_line(end["point"], a, b)
            if foot is None or foot["t"] <= 0 or foot["t"] >= 1:
                continue
            gap = dist(end["point"], foot["point"])
            if gap > join_snap_m:
                continue
            if dist(foot["point"], a) <= join_snap_m or dist(foot["point"], b) <= join_snap_m:
                continue
            if best is None or gap < best["gap"]:
                best = {"wallId": wall.id, "foot": foot["point"], "gap": gap}
        if best is not None:
            cluster["host"] = {"wallId": best["wallId"], "foot": best["foot"]}


def _empty_corners() -> dict[str, dict[str, Any]]:
    return {"a": {"left": None, "right": None}, "b": {"left": None, "right": None}}


def _to_coords(points: list[Any]) -> list[tuple[float, float]]:
    return [(float(point["x"]), float(point["y"])) for point in points]


def _from_coords(coords: list[tuple[float, float]]) -> list[dict[str, float]]:
    return dedupe_ring([{"x": x, "y": y} for x, y in coords])


def _polygons_of(geom: Any) -> list[Any]:
    if geom.is_empty:
        return []
    kind = geom.geom_type
    if kind == "Polygon":
        return [geom]
    if kind == "MultiPolygon":
        return list(geom.geoms)
    if kind == "GeometryCollection":
        found: list[Any] = []
        for part in geom.geoms:
            found.extend(_polygons_of(part))
        return found
    return []


def wall_polygons(plan: Any, level_id: str) -> list[dict[str, Any]]:
    level = _level(plan, level_id)
    vertices = _vertices(level)
    ends: list[dict[str, Any]] = []
    for wall in level.walls:
        ends.append({"wallId": wall.id, "end": "a", "point": _point_of(vertices, wall.a)})
        ends.append({"wallId": wall.id, "end": "b", "point": _point_of(vertices, wall.b)})
    clusters = _cluster_ends(ends)
    _mark_junctions(level, vertices, clusters)
    cluster_by_end: dict[str, dict[str, Any]] = {}
    for cluster in clusters:
        for end in cluster["ends"]:
            cluster_by_end[f"{end['wallId']}:{end['end']}"] = cluster

    def geom_end(wall_id: str, end: str) -> Any:
        cluster = cluster_by_end[f"{wall_id}:{end}"]
        host = cluster["host"]
        if host is not None:
            return host["foot"]
        return cluster["joint"]

    corners = {wall.id: _empty_corners() for wall in level.walls}
    for cluster in clusters:
        if cluster["host"] is not None or len(cluster["ends"]) < 2:
            continue
        _join_cluster(level, geom_end, cluster, corners)

    def hub(wall_id: str, end: str) -> Any:
        cluster = cluster_by_end[f"{wall_id}:{end}"]
        if cluster["host"] is None and len(cluster["ends"]) >= 3:
            return cluster["joint"]
        return None

    polygons: list[dict[str, Any]] = []
    for wall in level.walls:
        ring = _square_or_joined(wall, geom_end, hub, corners[wall.id])
        if ring is not None:
            polygons.append({"wallId": wall.id, "ring": ring})

    for cluster in clusters:
        host = cluster["host"]
        if host is None:
            continue
        butt = cluster["ends"][0]
        butt_poly = next((item for item in polygons if item["wallId"] == butt["wallId"]), None)
        host_poly = next((item for item in polygons if item["wallId"] == host["wallId"]), None)
        if butt_poly is None or host_poly is None:
            continue
        subject = Polygon(_to_coords(butt_poly["ring"]))
        clipped = subject.difference(Polygon(_to_coords(host_poly["ring"])))
        best: list[dict[str, float]] | None = None
        best_area = -1.0
        for polygon in _polygons_of(clipped):
            ring = _from_coords(list(polygon.exterior.coords))
            area = abs(ring_area(ring))
            if area > best_area:
                best = ring
                best_area = area
        if best is not None and len(best) >= 3:
            butt_poly["ring"] = best
    return polygons


def _square_or_joined(wall: Any, geom_end: Any, hub: Any, corners: dict[str, dict[str,
    Any]]) -> list[dict[str, float]] | None:
    """Where three or more walls meet, the ring passes through the joint so the
    union has no gap between collinear neighbours."""
    a = geom_end(wall.id, "a")
    b = geom_end(wall.id, "b")
    direction = unit(sub(b, a))
    if direction["x"] == 0 and direction["y"] == 0:
        return None
    half = wall.thickness / 2
    normal = left(direction)

    def cap(end: str, side: str) -> dict[str, float]:
        origin = a if end == "a" else b
        sign = 1 if side == "left" else -1
        return add(origin, mul(normal, sign * half))

    hub_a = hub(wall.id, "a")
    hub_b = hub(wall.id, "b")
    ring = dedupe_ring(
        [
            corners["a"]["right"] or cap("a", "right"),
            corners["b"]["right"] or cap("b", "right"),
            *([hub_b] if hub_b is not None else []),
            corners["b"]["left"] or cap("b", "left"),
            corners["a"]["left"] or cap("a", "left"),
            *([hub_a] if hub_a is not None else []),
        ]
    )
    return ring if len(ring) >= 3 else None


def _join_cluster(level: Any, geom_end: Any, cluster: dict[str, Any], corners: dict[str,
    dict[str, Any]]) -> None:
    edges: list[dict[str, Any]] = []
    for end in cluster["ends"]:
        wall = next((item for item in level.walls if item.id == end["wallId"]), None)
        if wall is None:
            continue
        here = cluster["joint"]
        other = geom_end(wall.id, "b" if end["end"] == "a" else "a")
        direction = unit(sub(other, here))
        if direction["x"] == 0 and direction["y"] == 0:
            continue
        edges.append(
            {
                "wallId": wall.id,
                "end": end["end"],
                "dir": direction,
                "half": wall.thickness / 2,
                "thickness": wall.thickness,
                "angle": math.atan2(direction["y"], direction["x"]),
            }
        )
    edges.sort(key=lambda edge: edge["angle"])
    if len(edges) < 2:
        return
    for index, start in enumerate(edges):
        nxt = edges[(index + 1) % len(edges)]
        start_point = add(cluster["joint"], mul(left(start["dir"]), start["half"]))
        next_point = add(cluster["joint"], mul(right(nxt["dir"]), nxt["half"]))
        hit = line_intersect(start_point, start["dir"], next_point, nxt["dir"])
        limit = miter_limit * min(start["thickness"], nxt["thickness"])
        use_miter = hit is not None and dist(hit, cluster["joint"]) <= limit
        chosen = hit if use_miter and hit is not None else None
        _assign_side(corners, start, "left", chosen if chosen is not None else start_point)
        _assign_side(corners, nxt, "right", chosen if chosen is not None else next_point)


def _assign_side(corners: dict[str, dict[str, Any]], edge: dict[str, Any], side: str,
    point: Any) -> None:
    box = corners.get(edge["wallId"])
    if box is None:
        return
    wall_side = "left"
    if not (
        (edge["end"] == "a" and side == "left") or (edge["end"] == "b" and side == "right")
    ):
        wall_side = "right"
    box[edge["end"]][wall_side] = point


def max_join_spike_m(plan: Any, level_id: str, polygons: list[dict[str, Any]]) -> float:
    level = _level(plan, level_id)
    vertices = _vertices(level)
    ends: list[dict[str, Any]] = []
    for wall in level.walls:
        ends.append({"wallId": wall.id, "end": "a", "point": _point_of(vertices, wall.a)})
        ends.append({"wallId": wall.id, "end": "b", "point": _point_of(vertices, wall.b)})
    clusters = _cluster_ends(ends)
    maximum = 0.0
    for cluster in clusters:
        for end in cluster["ends"]:
            wall = next((item for item in level.walls if item.id == end["wallId"]), None)
            polygon = next((item for item in polygons if item["wallId"] == end["wallId"]), None)
            if wall is None or polygon is None:
                continue
            other = _point_of(vertices, wall.b if end["end"] == "a" else wall.a)
            for point in polygon["ring"]:
                if dist(point, cluster["joint"]) > dist(point, other):
                    continue
                maximum = max(maximum, dist(point, cluster["joint"]))
    return maximum


def wall_union(polygons: list[dict[str, Any]]) -> list[Any]:
    if not polygons:
        return []
    geoms = [Polygon(_to_coords(polygon["ring"])) for polygon in polygons if 
        len(polygon["ring"]) >= 3]
    if not geoms:
        return []
    merged = unary_union(geoms)
    return _polygons_of(merged)


def free_faces(polygons: list[dict[str, Any]]) -> list[list[dict[str, float]]]:
    faces: list[list[dict[str, float]]] = []
    for polygon in wall_union(polygons):
        for interior in polygon.interiors:
            ring = _from_coords(list(interior.coords))
            if len(ring) >= 3:
                faces.append(ring)
    return faces


def as_obj_ring(ring: list[dict[str, float]]) -> list[Obj]:
    return [Obj(point) for point in ring]
