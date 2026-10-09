"""Turn a raw scene into a metric, Z-up, storey-split cloud."""

from dataclasses import dataclass, field

import numpy as np

from hero.ingest.scene import RawScene
from hero.pipeline.tolerances import (
    plane_angle_deg,
    plane_dist_m,
    target_points,
    voxel_max_m,
    voxel_min_m,
)


@dataclass
class LevelSlice:
    elevation: float
    ceiling_height: float


@dataclass
class _Plane:
    normal: np.ndarray
    centroid: np.ndarray
    area: float


@dataclass
class Normalized:
    points: np.ndarray
    normals: np.ndarray
    unit_scale: float
    voxel: float
    estimated_up: np.ndarray
    levels: list[LevelSlice]
    manhattan_angle_deg: float
    issues: list[dict[str, str]] = field(default_factory=list)
    mesh_vertices: np.ndarray | None = None
    mesh_faces: np.ndarray | None = None
    colors: np.ndarray | None = None


def normalize_scene(scene: RawScene, *, units: str = "auto", up_axis: str = "auto") -> Normalized:
    """Run ingest through storeys. Points are metres, Z up."""
    raw_points = scene.points if scene.points is not None else np.zeros((0, 3))
    if len(raw_points):
        minimum = raw_points.min(axis=0)
        maximum = raw_points.max(axis=0)
    else:
        minimum = np.zeros(3)
        maximum = np.zeros(3)
    span = float(np.max(maximum[:2] - minimum[:2])) if np.isfinite(minimum).all() else 0.0
    scale, guessed = _unit_scale(span, units, scene.unit_scale)
    voxel = _choose_voxel((maximum - minimum) * scale)
    points, normals, colors = _downsample(scene, scale, voxel)
    if len(points) == 0:
        empty = normals if normals is not None else np.zeros((0, 3))
        return Normalized(
            points,
            empty,
            scale,
            voxel,
            np.array([0.0, 0.0, 1.0]),
            [],
            0.0,
            _issues(guessed, False),
        )
    if normals is None:
        normals = _estimate_normals(points)
    up, uncertain = _gravity(points, normals, up_axis)
    rotation = _rotation_to_z(up)
    points = points @ rotation.T
    normals = normals @ rotation.T
    points, normals, angle, manhattan = _manhattan(points, normals)
    points, shift = _seat_floors(points, normals)
    mesh_vertices, mesh_faces = _mesh(scene, scale, rotation, manhattan, shift)
    levels, hints = _storeys(points, normals)
    issues = [*_issues(guessed, uncertain), *hints]
    return Normalized(
        points,
        normals,
        scale,
        voxel,
        up,
        levels,
        angle,
        issues,
        mesh_vertices,
        mesh_faces,
        colors,
    )


def _unit_scale(span: float, units: str, hint: float | None) -> tuple[float, bool]:
    if units == "mm":
        return 0.001, True
    if units == "m":
        return 1.0, False
    if hint is not None and hint != 1.0:
        return hint, True
    if hint is not None and hint == 1.0:
        return 1.0, False
    if span > 200:
        return 0.001, True
    if span > 50:
        return 0.01, True
    return 1.0, False


def _choose_voxel(size: np.ndarray) -> float:
    volume = float(np.prod(np.maximum(size, voxel_min_m)))
    voxel = voxel_min_m
    if volume / voxel**3 > target_points:
        voxel = (volume / target_points) ** (1.0 / 3.0)
        voxel = float(min(voxel_max_m, max(voxel_min_m, voxel)))
    return voxel


def _downsample(
    scene: RawScene, scale: float, voxel: float
) -> tuple[np.ndarray, np.ndarray | None, np.ndarray | None]:
    totals: dict[tuple[int, int, int], np.ndarray] = {}
    normal_totals: dict[tuple[int, int, int], np.ndarray] = {}
    has_normals = scene.normals is not None and scene.points is not None
    has_colors = (
        scene.colors is not None
        and scene.points is not None
        and len(scene.colors) == len(scene.points)
    )
    color_totals: dict[tuple[int, int, int], np.ndarray] | None = {} if has_colors else None
    if has_normals and scene.points is not None and scene.normals is not None:
        _accumulate(
            scene.points * scale,
            scene.normals,
            voxel,
            totals,
            normal_totals,
            scene.colors if has_colors else None,
            color_totals,
        )
    elif has_colors and scene.points is not None:
        _accumulate(scene.points * scale, None, voxel, totals, None, scene.colors, color_totals)
    elif scene.points is not None:
        _accumulate(scene.points * scale, None, voxel, totals, None)
    if not totals:
        return np.zeros((0, 3)), None, None
    points = np.empty((len(totals), 3), dtype=np.float64)
    normals = np.empty((len(totals), 3), dtype=np.float64) if has_normals else None
    colors = np.empty((len(totals), 3), dtype=np.uint8) if color_totals is not None else None
    for index, (key, total) in enumerate(totals.items()):
        points[index] = total[:3] / total[3]
        if normals is not None:
            direction = normal_totals[key]
            length = float(np.linalg.norm(direction))
            normals[index] = direction / length if length else np.array([0.0, 0.0, 1.0])
        if colors is not None and color_totals is not None:
            averaged = color_totals[key] / total[3]
            colors[index] = np.clip(np.rint(averaged), 0, 255)
    return points, normals, colors


def _accumulate(
    points: np.ndarray,
    normals: np.ndarray | None,
    voxel: float,
    totals: dict[tuple[int, int, int], np.ndarray],
    normal_totals: dict[tuple[int, int, int], np.ndarray] | None,
    colors: np.ndarray | None = None,
    color_totals: dict[tuple[int, int, int], np.ndarray] | None = None,
) -> None:
    if len(points) == 0:
        return
    keys = np.floor(points / voxel).astype(np.int64)
    packed = np.ascontiguousarray(keys).view(np.dtype((np.void, keys.dtype.itemsize * 3))).ravel()
    unique, inverse = np.unique(packed, return_inverse=True)
    order = np.argsort(inverse, kind="mergesort")
    ordered = points[order]
    inverse_ordered = inverse[order]
    breaks = np.flatnonzero(np.diff(inverse_ordered)) + 1
    starts = np.concatenate(([0], breaks))
    ends = np.concatenate((breaks, [len(ordered)]))
    unique_keys = keys[order][starts]
    sums = np.add.reduceat(ordered, starts, axis=0)
    counts = ends - starts
    normal_sums = None
    if normals is not None and normal_totals is not None:
        normal_sums = np.add.reduceat(normals[order], starts, axis=0)
    color_sums = None
    if colors is not None and color_totals is not None:
        color_sums = np.add.reduceat(np.asarray(colors, dtype=np.float64)[order], starts, axis=0)
    for index, key_row in enumerate(unique_keys):
        key = (int(key_row[0]), int(key_row[1]), int(key_row[2]))
        slot = totals.get(key)
        block = np.array([sums[index, 0], sums[index, 1], sums[index, 2], float(counts[index])])
        if slot is None:
            totals[key] = block
        else:
            slot += block
        if normal_sums is not None and normal_totals is not None:
            current = normal_totals.get(key)
            if current is None:
                normal_totals[key] = normal_sums[index].copy()
            else:
                current += normal_sums[index]
        if color_sums is not None and color_totals is not None:
            painted = color_totals.get(key)
            if painted is None:
                color_totals[key] = color_sums[index].copy()
            else:
                painted += color_sums[index]
    del unique


def _estimate_normals(points: np.ndarray) -> np.ndarray:
    if len(points) < 3:
        return np.tile(np.array([0.0, 0.0, 1.0]), (len(points), 1))
    import open3d as o3d

    cloud = o3d.geometry.PointCloud()
    cloud.points = o3d.utility.Vector3dVector(np.ascontiguousarray(points))
    knn = min(30, len(points) - 1)
    cloud.estimate_normals(search_param=o3d.geometry.KDTreeSearchParamKNN(knn=knn))
    center = (points.min(axis=0) + points.max(axis=0)) / 2.0
    cloud.orient_normals_towards_camera_location(center)
    normals = -np.asarray(cloud.normals)
    lengths = np.linalg.norm(normals, axis=1)
    normals[lengths > 0] /= lengths[lengths > 0, None]
    return normals


def _gravity(points: np.ndarray, normals: np.ndarray, up_axis: str) -> tuple[np.ndarray, bool]:
    extents = points.max(axis=0) - points.min(axis=0)
    axis = np.zeros(3)
    axis[int(np.argmin(extents))] = 1.0
    if up_axis in {"x", "y", "z"}:
        forced = {
            "x": np.array([1.0, 0.0, 0.0]),
            "y": np.array([0.0, 1.0, 0.0]),
            "z": np.array([0.0, 0.0, 1.0]),
        }[up_axis]
        return forced, False
    planes = _planes(points, normals)
    clusters = _cluster_planes(planes)
    aligned = [
        cluster
        for cluster in clusters
        if abs(float(np.dot(cluster.normal, axis))) >= np.cos(np.deg2rad(25))
    ]
    if not aligned:
        return _sign_up(axis, planes, axis), True
    chosen = max(aligned, key=lambda item: item.area)
    return _sign_up(chosen.normal, planes, axis), False


def _cluster_planes(planes: list[_Plane]) -> list[_Plane]:
    clusters: list[_Plane] = []
    limit = np.cos(np.deg2rad(10))
    for plane in planes:
        placed = False
        for cluster in clusters:
            if float(np.dot(cluster.normal, plane.normal)) <= limit:
                continue
            if plane.area > cluster.area:
                cluster.normal = plane.normal
                cluster.centroid = plane.centroid
            cluster.area += plane.area
            placed = True
            break
        if not placed:
            clusters.append(_Plane(plane.normal.copy(), plane.centroid.copy(), plane.area))
    return clusters


def _sign_up(up: np.ndarray, planes: list[_Plane], axis: np.ndarray) -> np.ndarray:
    up = up / max(float(np.linalg.norm(up)), 1e-12)
    limit = np.cos(np.deg2rad(15))
    horizontal = [plane for plane in planes if abs(float(np.dot(plane.normal, up))) >= limit]
    if len(horizontal) < 2:
        return up if float(np.dot(up, axis)) >= 0 else -up
    ranked = sorted(horizontal, key=lambda item: item.area, reverse=True)
    first, second = ranked[0], ranked[1]
    if float(np.dot(first.centroid, axis)) <= float(np.dot(second.centroid, axis)):
        lower, upper = first, second
    else:
        lower, upper = second, first
    direction = upper.centroid - lower.centroid
    if float(np.dot(up, direction)) < 0:
        return -up
    return up


def _planes(points: np.ndarray, normals: np.ndarray) -> list[_Plane]:
    """Split a 0.05 m cloud into planes by normal bin and offset. Refit with SVD."""
    coarse, coarse_normals = _voxel_mean(points, normals, 0.05)
    if len(coarse) == 0:
        return []
    lengths = np.linalg.norm(coarse_normals, axis=1)
    valid = lengths > 1e-8
    coarse = coarse[valid]
    coarse_normals = coarse_normals[valid] / lengths[valid, None]
    offset = np.einsum("ij,ij->i", coarse, coarse_normals)
    step = float(np.sin(np.deg2rad(plane_angle_deg)))
    normal_bin = np.round(coarse_normals / step).astype(np.int32)
    offset_bin = np.round(offset / plane_dist_m).astype(np.int32)
    keys = np.column_stack((normal_bin, offset_bin))
    packed = np.ascontiguousarray(keys).view(np.dtype((np.void, keys.dtype.itemsize * 4))).ravel()
    _unique, inverse = np.unique(packed, return_inverse=True)
    order = np.argsort(inverse, kind="mergesort")
    inverse_ordered = inverse[order]
    breaks = np.flatnonzero(np.diff(inverse_ordered)) + 1
    starts = np.concatenate(([0], breaks))
    ends = np.concatenate((breaks, [len(order)]))
    planes: list[_Plane] = []
    cell = 0.05 * 0.05
    for start, end in zip(starts, ends, strict=True):
        count = int(end - start)
        if count < 500:
            continue
        chosen = order[start:end]
        cloud = coarse[chosen]
        centroid = cloud.mean(axis=0)
        _, _, vh = np.linalg.svd(cloud - centroid, full_matrices=False)
        fitted = vh[-1]
        seed = coarse_normals[chosen].mean(axis=0)
        if float(np.dot(fitted, seed)) < 0:
            fitted = -fitted
        fitted = fitted / max(float(np.linalg.norm(fitted)), 1e-12)
        planes.append(_Plane(fitted, centroid, float(count) * cell))
        if len(planes) >= 400:
            break
    return planes


def _voxel_mean(
    points: np.ndarray, normals: np.ndarray, voxel: float
) -> tuple[np.ndarray, np.ndarray]:
    if len(points) == 0:
        return np.zeros((0, 3)), np.zeros((0, 3))
    keys = np.floor(points / voxel).astype(np.int64)
    packed = np.ascontiguousarray(keys).view(np.dtype((np.void, keys.dtype.itemsize * 3))).ravel()
    _unique, inverse = np.unique(packed, return_inverse=True)
    order = np.argsort(inverse, kind="mergesort")
    inverse_ordered = inverse[order]
    breaks = np.flatnonzero(np.diff(inverse_ordered)) + 1
    starts = np.concatenate(([0], breaks))
    counts = np.diff(np.concatenate((starts, [len(order)])))
    point_sums = np.add.reduceat(points[order], starts, axis=0)
    normal_sums = np.add.reduceat(normals[order], starts, axis=0)
    return point_sums / counts[:, None], normal_sums / counts[:, None]


def _rotation_to_z(up: np.ndarray) -> np.ndarray:
    target = np.array([0.0, 0.0, 1.0])
    source = up / max(float(np.linalg.norm(up)), 1e-12)
    cross = np.cross(source, target)
    cosine = float(np.clip(np.dot(source, target), -1.0, 1.0))
    if cosine > 0.999999:
        return np.eye(3)
    if cosine < -0.999999:
        axis = np.array([1.0, 0.0, 0.0]) if abs(source[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        axis = np.cross(source, axis)
        axis = axis / np.linalg.norm(axis)
        return _rodrigues(axis, np.pi)
    skew = np.array(
        [
            [0.0, -cross[2], cross[1]],
            [cross[2], 0.0, -cross[0]],
            [-cross[1], cross[0], 0.0],
        ]
    )
    return np.eye(3) + skew + skew @ skew * (1.0 / (1.0 + cosine))


def _rodrigues(axis: np.ndarray, angle: float) -> np.ndarray:
    cross = np.array(
        [
            [0.0, -axis[2], axis[1]],
            [axis[2], 0.0, -axis[0]],
            [-axis[1], axis[0], 0.0],
        ]
    )
    return np.eye(3) + np.sin(angle) * cross + (1.0 - np.cos(angle)) * (cross @ cross)


def _manhattan(
    points: np.ndarray, normals: np.ndarray
) -> tuple[np.ndarray, np.ndarray, float, np.ndarray]:
    horizontal = np.abs(normals[:, 2]) < np.sin(np.deg2rad(15))
    if int(horizontal.sum()) < 50:
        return points, normals, 0.0, np.eye(3)
    angles = np.degrees(np.arctan2(normals[horizontal, 1], normals[horizontal, 0])) % 180.0
    hist, edges = np.histogram(angles, bins=180, range=(0.0, 180.0))
    peak = int(np.argmax(hist))
    in_bin = (angles >= edges[peak]) & (angles < edges[peak + 1])
    strongest = float(np.mean(angles[in_bin])) if int(in_bin.sum()) else float(edges[peak])
    # 0° and 180° are the same axis. Keep the turn inside (-90°, 90°] so the plan does not flip.
    strongest = ((strongest + 90.0) % 180.0) - 90.0
    radians = np.deg2rad(-strongest)
    cosine = float(np.cos(radians))
    sine = float(np.sin(radians))
    rotation = np.array([[cosine, -sine, 0.0], [sine, cosine, 0.0], [0.0, 0.0, 1.0]])
    return points @ rotation.T, normals @ rotation.T, float(np.degrees(radians)), rotation


def _seat_floors(points: np.ndarray, normals: np.ndarray) -> tuple[np.ndarray, float]:
    floor = normals[:, 2] > np.cos(np.deg2rad(15))
    if int(floor.sum()) == 0:
        return points, 0.0
    peaks = _peaks(points[floor, 2])
    shift = min(height for height, _count in peaks) if peaks else float(np.min(points[floor, 2]))
    moved = points.copy()
    moved[:, 2] -= shift
    return moved, shift


def _mesh(
    scene: RawScene,
    scale: float,
    up_rotation: np.ndarray,
    manhattan: np.ndarray,
    shift: float,
) -> tuple[np.ndarray | None, np.ndarray | None]:
    """Keep source triangles in the same frame as the point cloud."""
    if scene.mesh_vertices is None or scene.mesh_faces is None or len(scene.mesh_faces) == 0:
        return None, None
    vertices = np.asarray(scene.mesh_vertices, dtype=np.float64) * scale
    vertices = vertices @ up_rotation.T @ manhattan.T
    vertices = np.ascontiguousarray(vertices)
    vertices[:, 2] -= shift
    return vertices, np.asarray(scene.mesh_faces, dtype=np.int64)


def _storeys(
    points: np.ndarray, normals: np.ndarray
) -> tuple[list[LevelSlice], list[dict[str, str]]]:
    floor = normals[:, 2] > np.cos(np.deg2rad(15))
    ceiling = normals[:, 2] < -np.cos(np.deg2rad(15))
    floor_points = points[floor]
    floor_peaks = _peaks(floor_points[:, 2]) if len(floor_points) else []
    ceiling_peaks = _peaks(points[ceiling, 2]) if int(ceiling.sum()) else []
    areas = [_band_area(floor_points, height) for height, _count in floor_peaks]
    largest = max(areas) if areas else 0.0
    kept: list[tuple[float, int]] = []
    hints: list[dict[str, str]] = []
    for peak, area in zip(floor_peaks, areas, strict=True):
        if largest > 0 and area < 0.3 * largest:
            hints.append(
                {
                    "code": "mezzanine",
                    "severity": "info",
                    "message": "A small floor peak was ignored as a mezzanine hint.",
                }
            )
            continue
        kept.append(peak)
    levels: list[LevelSlice] = []
    for floor_z, _count in kept:
        ceilings = [height for height, _count in ceiling_peaks if 1.8 <= height - floor_z <= 8.0]
        if not ceilings:
            continue
        ceiling_z = min(ceilings)
        levels.append(
            LevelSlice(elevation=float(floor_z), ceiling_height=float(ceiling_z - floor_z))
        )
    if not levels and len(points):
        if kept:
            floor_z = max(kept, key=lambda peak: peak[1])[0]
        else:
            floor_z = float(np.min(points[:, 2]))
        levels.append(LevelSlice(elevation=float(floor_z), ceiling_height=2.7))
        hints.append(
            {
                "code": "ceiling_missing",
                "severity": "warning",
                "message": "No ceiling was found, so the storey height is assumed.",
            }
        )
    return levels, hints


def _band_area(points: np.ndarray, height: float) -> float:
    band = points[np.abs(points[:, 2] - height) <= 0.05]
    if len(band) == 0:
        return 0.0
    keys = np.floor(band[:, :2] / 0.05).astype(np.int64)
    packed = np.ascontiguousarray(keys).view(np.dtype((np.void, keys.dtype.itemsize * 2))).ravel()
    return float(len(np.unique(packed))) * 0.05 * 0.05


def _short_peaks(hist: np.ndarray, edges: np.ndarray) -> list[tuple[float, int]]:
    """Peaks when the histogram is shorter than the 3-bin smoother."""
    total = int(hist.sum())
    found: list[tuple[float, int]] = []
    for index in range(len(hist)):
        if total <= 0 or hist[index] < 0.02 * total:
            continue
        if index > 0 and hist[index] < hist[index - 1]:
            continue
        if index + 1 < len(hist) and hist[index] < hist[index + 1]:
            continue
        center = float((edges[index] + edges[index + 1]) / 2.0)
        found.append((center, int(hist[index])))
    return found


def _peaks(values: np.ndarray) -> list[tuple[float, int]]:
    """Smoothed peaks. Height is the weighted centre of the peak and its neighbours."""
    if len(values) == 0:
        return []
    low = float(values.min()) - 0.05
    high = float(values.max()) + 0.1
    hist, edges = np.histogram(values, bins=np.arange(low, high, 0.05))
    if len(hist) == 0:
        return []
    if len(hist) < 3:
        return _short_peaks(hist, edges)
    kernel = np.ones(3) / 3.0
    smooth = np.convolve(hist, kernel, mode="same")
    found: list[tuple[float, int]] = []
    total = int(hist.sum())
    last = len(smooth) - 1
    for index in range(len(smooth)):
        left = smooth[index - 1] if index > 0 else -1.0
        right = smooth[index + 1] if index < last else -1.0
        if smooth[index] < left or smooth[index] < right:
            continue
        # A 3-bin mean turns one full bin into a two-bin plateau. Keep the fuller bin.
        if index > 0 and smooth[index] == left and hist[index] <= hist[index - 1]:
            continue
        if hist[index] < 0.02 * total:
            continue
        start = max(index - 1, 0)
        stop = min(index + 1, len(hist) - 1)
        bins = np.arange(start, stop + 1)
        weights = hist[bins].astype(np.float64)
        centers = (edges[bins] + edges[bins + 1]) / 2.0
        weight = float(weights.sum())
        if weight <= 0:
            continue
        found.append((float(np.dot(weights, centers) / weight), int(hist[index])))
    return found


def _issues(guessed: bool, uncertain: bool) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    if guessed:
        issues.append(
            {
                "code": "units_guessed",
                "severity": "warning",
                "message": "The file units were guessed and converted to metres.",
            }
        )
    if uncertain:
        issues.append(
            {
                "code": "gravity_uncertain",
                "severity": "warning",
                "message": "Gravity was taken from the shortest bounding-box axis.",
            }
        )
    return issues
