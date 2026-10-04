"""Slice a mesh into wall centerlines and heal small gaps."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pyclipr
import trimesh

from hero.schema import Plan, Vertex, Wall

MESH_SUFFIXES = {".obj", ".glb", ".gltf"}
SNAP_DEGREES = 5.0


def generate_plan(path: str | Path, slice_height: float = 1.2, gap_tolerance: float = 0.2) -> Plan:
    source = Path(path)
    suffix = source.suffix.lower()
    if suffix == ".ifc":
        from hero.ifc_extract import generate_from_ifc

        return generate_from_ifc(source)
    if suffix == ".usdz":
        from hero.usdz_extract import generate_from_usdz

        return generate_from_usdz(source, slice_height=slice_height, gap_tolerance=gap_tolerance)
    if suffix in {".e57", ".las", ".laz", ".ply"}:
        from hero.pointcloud import generate_from_cloud

        return generate_from_cloud(source, slice_height=slice_height, gap_tolerance=gap_tolerance)
    if suffix not in MESH_SUFFIXES:
        raise ValueError("This file is not a glTF, OBJ, IFC, USDZ, E57, LAS, or PLY.")
    return generate_from_mesh(source, slice_height=slice_height, gap_tolerance=gap_tolerance)


def generate_from_mesh(path: str | Path, slice_height: float = 1.2, gap_tolerance: float = 0.2) -> Plan:
    mesh = trimesh.load(path, force="mesh")
    if not isinstance(mesh, trimesh.Trimesh):
        raise ValueError("This file did not contain a mesh.")
    return generate_from_trimesh(mesh, slice_height=slice_height, gap_tolerance=gap_tolerance)


def generate_from_trimesh(mesh: trimesh.Trimesh, slice_height: float = 1.2, gap_tolerance: float = 0.2) -> Plan:
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
        raise ValueError("This file did not contain a mesh.")
    axis = _best_up_axis(mesh)
    aligned = _align_z_up(mesh, axis)
    segments = _slice_horizontal(aligned, slice_height)
    segments = _merge_collinear(segments)
    return _segments_to_plan(segments, gap_tolerance)


def _best_up_axis(mesh: trimesh.Trimesh) -> int:
    best_axis = 2
    best_length = -1.0
    vertices = np.asarray(mesh.vertices, dtype=float)
    faces = np.asarray(mesh.faces)
    for axis in (0, 1, 2):
        low = float(vertices[:, axis].min())
        high = float(vertices[:, axis].max())
        if high - low < 1e-6:
            continue
        origin = np.zeros(3)
        origin[axis] = (low + high) / 2.0
        normal = np.zeros(3)
        normal[axis] = 1.0
        length = _segment_length(_plane_segments(vertices, faces, origin, normal), axis)
        if length > best_length:
            best_length = length
            best_axis = axis
    return best_axis


def _align_z_up(mesh: trimesh.Trimesh, axis: int) -> trimesh.Trimesh:
    aligned = mesh.copy()
    if axis == 0:
        aligned.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [0, 1, 0]))
    elif axis == 1:
        aligned.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0]))
    return aligned


def _slice_horizontal(mesh: trimesh.Trimesh, slice_height: float) -> list[tuple[float, float, float, float]]:
    vertices = np.asarray(mesh.vertices, dtype=float)
    faces = np.asarray(mesh.faces)
    low = float(vertices[:, 2].min())
    high = float(vertices[:, 2].max())
    z = low + slice_height
    if z <= low or z >= high:
        z = (low + high) / 2.0
    origin = np.array([0.0, 0.0, z])
    normal = np.array([0.0, 0.0, 1.0])
    raw = _plane_segments(vertices, faces, origin, normal)
    if not raw:
        origin = np.array([0.0, 0.0, (low + high) / 2.0])
        raw = _plane_segments(vertices, faces, origin, normal)
    return [(a[0], a[1], b[0], b[1]) for a, b in raw]


def _plane_segments(vertices: np.ndarray, faces: np.ndarray, origin: np.ndarray, normal: np.ndarray):
    segments = []
    for face in faces:
        points = vertices[face]
        distances = (points - origin) @ normal
        hits: list[np.ndarray] = []
        for index in range(3):
            nxt = (index + 1) % 3
            start = float(distances[index])
            end = float(distances[nxt])
            if abs(start) < 1e-9 and abs(end) < 1e-9:
                continue
            if abs(start) < 1e-9:
                hits.append(points[index])
            elif start * end < 0:
                weight = start / (start - end)
                hits.append(points[index] + weight * (points[nxt] - points[index]))
        unique: list[np.ndarray] = []
        for hit in hits:
            if all(float(np.linalg.norm(hit - kept)) > 1e-7 for kept in unique):
                unique.append(hit)
        if len(unique) >= 2 and float(np.linalg.norm(unique[0] - unique[1])) > 1e-7:
            segments.append((unique[0], unique[1]))
    return segments


def _segment_length(segments, drop_axis: int) -> float:
    total = 0.0
    for start, end in segments:
        delta = end - start
        delta[drop_axis] = 0.0
        total += float(np.linalg.norm(delta))
    return total


def _merge_collinear(
    segments: list[tuple[float, float, float, float]],
    join_tolerance: float = 1e-4,
    angle_tolerance: float = SNAP_DEGREES,
) -> list[tuple[float, float, float, float]]:
    pending = [list(segment) for segment in segments]
    changed = True
    while changed:
        changed = False
        for index in range(len(pending)):
            for other in range(index + 1, len(pending)):
                merged = _try_merge(pending[index], pending[other], join_tolerance, angle_tolerance)
                if merged is None:
                    continue
                pending[index] = merged
                pending.pop(other)
                changed = True
                break
            if changed:
                break
    return [tuple(segment) for segment in pending]


def _try_merge(first, second, join_tolerance: float, angle_tolerance: float):
    if _angle_delta(first, second) > angle_tolerance:
        return None
    ends_a = [(first[0], first[1]), (first[2], first[3])]
    ends_b = [(second[0], second[1]), (second[2], second[3])]
    shared = None
    for index_a, point_a in enumerate(ends_a):
        for index_b, point_b in enumerate(ends_b):
            if _distance(point_a, point_b) <= join_tolerance:
                shared = (index_a, index_b)
                break
        if shared:
            break
    if shared is None:
        return None
    outer_a = ends_a[1 - shared[0]]
    outer_b = ends_b[1 - shared[1]]
    return [outer_a[0], outer_a[1], outer_b[0], outer_b[1]]


def _segments_to_plan(segments, gap_tolerance: float) -> Plan:
    if not segments:
        return Plan()
    endpoints: list[tuple[float, float]] = []
    pairs: list[tuple[int, int]] = []
    for x1, y1, x2, y2 in segments:
        pairs.append((len(endpoints), len(endpoints) + 1))
        endpoints.append((x1, y1))
        endpoints.append((x2, y2))
    centers, mapping = _cluster_points(endpoints, gap_tolerance)
    edges: set[tuple[int, int]] = set()
    for left, right in pairs:
        start, end = mapping[left], mapping[right]
        if start == end:
            continue
        edges.add((min(start, end), max(start, end)))
    _snap_orthogonal(centers, edges)
    kept = []
    for start, end in edges:
        if _distance(centers[start], centers[end]) > 1e-6:
            kept.append((start, end))
    return _plan_from_graph(centers, kept)


def _cluster_points(points: list[tuple[float, float]], tolerance: float):
    count = len(points)
    parent = list(range(count))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        root_left, root_right = find(left), find(right)
        if root_left != root_right:
            parent[root_right] = root_left

    polygons = _offset_unions(points, tolerance / 2.0) if tolerance > 0 else []
    for left in range(count):
        for right in range(left + 1, count):
            if _distance(points[left], points[right]) > tolerance + 1e-6:
                continue
            together = any(
                _point_in_poly(points[left], polygon) and _point_in_poly(points[right], polygon)
                for polygon in polygons
            )
            if together or _distance(points[left], points[right]) <= 1e-4:
                union(left, right)

    groups: dict[int, list[int]] = {}
    for index in range(count):
        groups.setdefault(find(index), []).append(index)
    centers: list[list[float]] = []
    mapping: dict[int, int] = {}
    for indexes in groups.values():
        center = [
            sum(points[index][0] for index in indexes) / len(indexes),
            sum(points[index][1] for index in indexes) / len(indexes),
        ]
        slot = len(centers)
        centers.append(center)
        for index in indexes:
            mapping[index] = slot
    return centers, mapping


def _offset_unions(points: list[tuple[float, float]], radius: float):
    if radius <= 0 or not points:
        return []
    offset = pyclipr.ClipperOffset()
    offset.scaleFactor = 1000
    for x, y in points:
        offset.addPath([[x, y], [x + 1e-4, y]], pyclipr.JoinType.Round, pyclipr.EndType.Round)
    return offset.execute(radius)


def _snap_orthogonal(centers: list[list[float]], edges: set[tuple[int, int]]) -> None:
    for _ in range(3):
        for start, end in edges:
            x1, y1 = centers[start]
            x2, y2 = centers[end]
            angle = abs(math.degrees(math.atan2(y2 - y1, x2 - x1))) % 180
            to_horizontal = min(angle, 180 - angle)
            to_vertical = abs(angle - 90)
            if to_horizontal <= SNAP_DEGREES and to_horizontal <= to_vertical:
                y = (y1 + y2) / 2.0
                centers[start][1] = y
                centers[end][1] = y
            elif to_vertical <= SNAP_DEGREES:
                x = (x1 + x2) / 2.0
                centers[start][0] = x
                centers[end][0] = x


def _plan_from_graph(centers: list[list[float]], edges: list[tuple[int, int]]) -> Plan:
    order = sorted(range(len(centers)), key=lambda index: (round(centers[index][0], 6), round(centers[index][1], 6)))
    id_of = {old: f"v{rank + 1}" for rank, old in enumerate(order)}
    vertices = [
        Vertex(id=id_of[index], x=round(centers[index][0], 6), y=round(centers[index][1], 6))
        for index in order
    ]
    wall_keys = sorted((id_of[start], id_of[end]) for start, end in edges)
    walls = [Wall(id=f"w{rank + 1}", a=start, b=end) for rank, (start, end) in enumerate(wall_keys)]
    return Plan(vertices=vertices, walls=walls)


def _point_in_poly(point: tuple[float, float], polygon) -> bool:
    x, y = point
    inside = False
    count = len(polygon)
    previous = count - 1
    for index in range(count):
        xi, yi = float(polygon[index][0]), float(polygon[index][1])
        xj, yj = float(polygon[previous][0]), float(polygon[previous][1])
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-30) + xi:
            inside = not inside
        previous = index
    return inside


def _distance(first, second) -> float:
    return math.hypot(first[0] - second[0], first[1] - second[1])


def _angle_delta(first, second) -> float:
    angle_a = math.degrees(math.atan2(first[3] - first[1], first[2] - first[0]))
    angle_b = math.degrees(math.atan2(second[3] - second[1], second[2] - second[0]))
    return abs((angle_a - angle_b + 90) % 180 - 90)
