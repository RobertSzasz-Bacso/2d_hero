"""Draft a plan from a laser scan: level the floor, cut a slab, extract lines."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh

from hero.geometry import _segments_to_plan, generate_from_trimesh
from hero.schema import Plan

CLOUD_SUFFIXES = {".e57", ".las", ".laz", ".ply"}


def generate_from_cloud(path: str | Path, slice_height: float = 1.2, gap_tolerance: float = 0.25) -> Plan:
    source = Path(path)
    suffix = source.suffix.lower()
    if suffix == ".ply":
        loaded = trimesh.load(source, process=False)
        mesh = _mesh_from_loaded(loaded)
        if mesh is not None:
            return generate_from_trimesh(mesh, slice_height=slice_height, gap_tolerance=gap_tolerance)
        points = _points_from_loaded(loaded)
    elif suffix == ".e57":
        points = _read_e57(source)
    elif suffix in {".las", ".laz"}:
        points = _read_las(source)
    else:
        raise ValueError("This file is not an E57, LAS, or PLY point cloud.")
    return generate_from_points(points, slice_height=slice_height, gap_tolerance=gap_tolerance)


def generate_from_points(points: np.ndarray, slice_height: float = 1.2, gap_tolerance: float = 0.25) -> Plan:
    cloud = np.asarray(points, dtype=float)
    if cloud.ndim != 2 or cloud.shape[1] < 3 or len(cloud) < 30:
        raise ValueError("This point cloud did not contain enough points to draft a plan.")
    cloud = cloud[:, :3]
    cloud = cloud[np.isfinite(cloud).all(axis=1)]
    if len(cloud) > 40000:
        picked = np.random.default_rng(0).choice(len(cloud), 40000, replace=False)
        cloud = cloud[picked]
    leveled = _level_to_floor(cloud)
    segments = _slab_lines(leveled, slice_height)
    if not segments:
        raise ValueError("This point cloud did not produce wall lines at that slice height.")
    return _segments_to_plan(segments, gap_tolerance)


def _mesh_from_loaded(loaded) -> trimesh.Trimesh | None:
    if isinstance(loaded, trimesh.Trimesh) and len(loaded.faces) > 0:
        return loaded
    if isinstance(loaded, trimesh.Scene):
        meshes = [item for item in loaded.dump() if isinstance(item, trimesh.Trimesh) and len(item.faces) > 0]
        if not meshes:
            return None
        return trimesh.util.concatenate(meshes)
    return None


def _points_from_loaded(loaded) -> np.ndarray:
    if isinstance(loaded, trimesh.PointCloud):
        return np.asarray(loaded.vertices, dtype=float)
    if isinstance(loaded, trimesh.Trimesh):
        return np.asarray(loaded.vertices, dtype=float)
    if isinstance(loaded, trimesh.Scene):
        chunks = []
        for item in loaded.dump():
            if hasattr(item, "vertices"):
                chunks.append(np.asarray(item.vertices, dtype=float))
        if chunks:
            return np.vstack(chunks)
    raise ValueError("This PLY file did not contain points.")


def _read_las(path: Path) -> np.ndarray:
    import laspy

    cloud = laspy.read(path)
    return np.column_stack([np.asarray(cloud.x), np.asarray(cloud.y), np.asarray(cloud.z)])


def _read_e57(path: Path) -> np.ndarray:
    from pye57 import E57

    chunks = []
    with E57(str(path)) as source:
        for index in range(source.scan_count):
            raw = source.read_scan_raw(index)
            if not {"cartesianX", "cartesianY", "cartesianZ"} <= set(raw):
                continue
            chunks.append(
                np.column_stack(
                    [
                        np.asarray(raw["cartesianX"], dtype=float),
                        np.asarray(raw["cartesianY"], dtype=float),
                        np.asarray(raw["cartesianZ"], dtype=float),
                    ]
                )
            )
    if not chunks:
        raise ValueError("This E57 file did not contain Cartesian points.")
    return np.vstack(chunks)


def _level_to_floor(points: np.ndarray) -> np.ndarray:
    normals = _plane_normals(points)
    up = _up_from_normals(normals)
    low = float(np.percentile(points @ up, 2))
    high = float(np.percentile(points @ up, 98))
    band = max((high - low) * 0.08, 0.12)
    projection = points @ up
    low_count = int(np.sum(np.abs(projection - low) <= band))
    high_count = int(np.sum(np.abs(projection - high) <= band))
    if high_count > low_count * 1.25:
        up = -up
    frame = _frame_with_up(up)
    leveled = points @ frame.T
    floor = float(np.percentile(leveled[:, 2], 1))
    leveled[:, 2] -= floor
    return leveled


def _plane_normals(points: np.ndarray) -> list[np.ndarray]:
    rng = np.random.default_rng(0)
    work = points
    normals: list[np.ndarray] = []
    for _ in range(6):
        if len(work) < 40:
            break
        found = _ransac_plane(work, rng)
        if found is None:
            break
        normal, inliers = found
        if int(inliers.sum()) < 40:
            break
        normals.append(normal)
        work = work[~inliers]
    return normals


def _ransac_plane(points: np.ndarray, rng: np.random.Generator, iterations: int = 40, threshold: float = 0.05):
    count = len(points)
    best_inliers = None
    best_total = 0
    for _ in range(iterations):
        chosen = points[rng.choice(count, 3, replace=False)]
        normal = np.cross(chosen[1] - chosen[0], chosen[2] - chosen[0])
        length = float(np.linalg.norm(normal))
        if length < 1e-8:
            continue
        normal = normal / length
        distances = np.abs(points @ normal + (-float(normal @ chosen[0])))
        inliers = distances < threshold
        total = int(inliers.sum())
        if total > best_total:
            best_total = total
            best_inliers = inliers
    if best_inliers is None:
        return None
    cloud = points[best_inliers]
    centroid = cloud.mean(axis=0)
    _, _, singular = np.linalg.svd(cloud - centroid, full_matrices=False)
    normal = singular[-1]
    normal = normal / np.linalg.norm(normal)
    return normal, best_inliers


def _up_from_normals(normals: list[np.ndarray]) -> np.ndarray:
    for index, first in enumerate(normals):
        for second in normals[index + 1 :]:
            if abs(float(first @ second)) < 0.5:
                up = np.cross(first, second)
                length = float(np.linalg.norm(up))
                if length > 1e-6:
                    return up / length
    return np.array([0.0, 0.0, 1.0])


def _frame_with_up(up: np.ndarray) -> np.ndarray:
    up = up / np.linalg.norm(up)
    helper = np.array([1.0, 0.0, 0.0]) if abs(float(up[0])) < 0.9 else np.array([0.0, 1.0, 0.0])
    x_axis = np.cross(helper, up)
    x_axis = x_axis / np.linalg.norm(x_axis)
    y_axis = np.cross(up, x_axis)
    return np.stack([x_axis, y_axis, up])


def _slab_lines(points: np.ndarray, slice_height: float) -> list[tuple[float, float, float, float]]:
    high = float(points[:, 2].max())
    height = slice_height
    if height <= 0.05 or height >= high:
        height = high / 2.0
    half = 0.25
    mask = np.abs(points[:, 2] - height) <= half
    if int(mask.sum()) < 20:
        mask = np.abs(points[:, 2] - height) <= 0.6
    slab = points[mask][:, :2]
    if len(slab) < 12:
        return []
    rng = np.random.default_rng(1)
    segments: list[tuple[float, float, float, float]] = []
    work = slab
    for _ in range(10):
        if len(work) < 12:
            break
        found = _ransac_line(work, rng)
        if found is None:
            break
        start, end, inliers = found
        if float(np.linalg.norm(end - start)) >= 0.4:
            segments.append((float(start[0]), float(start[1]), float(end[0]), float(end[1])))
        work = work[~inliers]
    return segments


def _ransac_line(points: np.ndarray, rng: np.random.Generator, iterations: int = 80, threshold: float = 0.08):
    count = len(points)
    best = None
    best_total = 0
    for _ in range(iterations):
        first, second = points[rng.choice(count, 2, replace=False)]
        direction = second - first
        length = float(np.linalg.norm(direction))
        if length < 0.3:
            continue
        direction = direction / length
        offset = points - first
        distance = np.abs(offset[:, 0] * direction[1] - offset[:, 1] * direction[0])
        inliers = distance < threshold
        total = int(inliers.sum())
        if total > best_total:
            best_total = total
            best = inliers
    if best is None or best_total < 12:
        return None
    cloud = points[best]
    centroid = cloud.mean(axis=0)
    _, _, singular = np.linalg.svd(cloud - centroid, full_matrices=False)
    direction = singular[0]
    direction = direction / np.linalg.norm(direction)
    projected = (cloud - centroid) @ direction
    start = centroid + direction * float(projected.min())
    end = centroid + direction * float(projected.max())
    return start, end, best
