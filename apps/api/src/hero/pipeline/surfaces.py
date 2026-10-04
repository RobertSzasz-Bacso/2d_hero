"""Planar wall faces: region grow, snap, merge, and thickness pairing."""

from dataclasses import dataclass, field
from typing import cast

import numpy as np
from scipy.spatial import KDTree
from shapely.geometry import MultiPoint, Point

from hero.pipeline.normalize import LevelSlice, Normalized
from hero.pipeline.tolerances import (
    assumed_exterior_m,
    assumed_interior_m,
    manhattan_snap_deg,
    min_wall_m,
    plane_angle_deg,
    plane_dist_m,
    thickness_max_m,
    thickness_min_m,
)

_HORIZONTAL = float(np.cos(np.deg2rad(15.0)))
_GROW_COS = float(np.cos(np.deg2rad(plane_angle_deg)))
_MIN_POINTS = 200
_MIN_AREA = 0.5
_MIN_HEIGHT = 1.2
_MAX_PLANES = 400


@dataclass
class WallFace:
    """One wall after thickness pairing. Coordinates are plan metres."""

    x1: float
    y1: float
    x2: float
    y2: float
    thickness: float
    assumed: bool
    kind: str
    confidence: float
    sides: int
    normal_x: float
    normal_y: float
    offset: float
    polygon: list[tuple[float, float]]
    level_index: int


@dataclass
class SurfaceResult:
    faces: list[WallFace] = field(default_factory=list)
    issues: list[dict[str, str]] = field(default_factory=list)


@dataclass
class _Region:
    normal: np.ndarray
    offset: float
    points: np.ndarray
    along0: float
    along1: float
    z0: float
    z1: float
    tangent: np.ndarray


def detect_surfaces(result: Normalized) -> SurfaceResult:
    """Vertical patches for every storey. Output is face records, not a plan."""
    faces: list[WallFace] = []
    issues: list[dict[str, str]] = []
    levels = list(result.levels) or [LevelSlice(0.0, 2.7)]
    for index, level in enumerate(levels):
        mask = _level_mask(result.points, level)
        found, level_issues = _level_faces(result.points[mask], result.normals[mask], index)
        faces.extend(found)
        issues.extend(level_issues)
    for face in faces:
        if _off_manhattan(face.x1, face.y1, face.x2, face.y2):
            issues.append(
                {
                    "code": "non_manhattan",
                    "severity": "info",
                    "message": "A wall is diagonal and was not snapped to the Manhattan frame.",
                }
            )
    return SurfaceResult(faces, issues)


def _level_mask(points: np.ndarray, level: LevelSlice) -> np.ndarray:
    if len(points) == 0:
        return np.zeros(0, dtype=bool)
    low = level.elevation - 0.3
    high = level.elevation + level.ceiling_height + 0.3
    return (points[:, 2] >= low) & (points[:, 2] <= high)


def _level_faces(
    points: np.ndarray, normals: np.ndarray, level_index: int
) -> tuple[list[WallFace], list[dict[str, str]]]:
    if len(points) == 0:
        return [], []
    vertical = np.abs(normals[:, 2]) <= np.sin(np.deg2rad(15.0))
    wall_points = points[vertical]
    wall_normals = normals[vertical]
    if len(wall_points) < _MIN_POINTS:
        return [], []
    regions = _grow(wall_points, wall_normals)
    regions = [_snap(region) for region in regions]
    regions = _merge(regions)
    floor = points[normals[:, 2] > _HORIZONTAL]
    return _pair(regions, floor[:, :2] if len(floor) else floor, level_index)


def _grow(points: np.ndarray, normals: np.ndarray) -> list[_Region]:
    count = len(points)
    k = min(31, count)
    tree = KDTree(points)
    neighbors = cast(np.ndarray, np.asarray(tree.query(points, k=k)[1]))
    if neighbors.ndim == 1:
        neighbors = neighbors.reshape(-1, 1)
    curvature = _curvature(points, neighbors)
    order = np.argsort(curvature, kind="mergesort")
    unused = np.ones(count, dtype=bool)
    regions: list[_Region] = []
    for seed in order:
        if not unused[seed] or len(regions) >= _MAX_PLANES:
            continue
        normal = _unit(normals[seed])
        if normal[2] != 0.0 and abs(normal[2]) > 0.2:
            normal = _horizontal(normal)
        members = _collect(seed, points, normals, neighbors, unused, normal)
        if len(members) < _MIN_POINTS:
            for index in members:
                if index != int(seed):
                    unused[index] = True
            continue
        chosen = np.asarray(members, dtype=np.int64)
        region = _fit(points[chosen], normals[chosen].mean(axis=0))
        if region is None:
            continue
        regions.append(region)
    return regions


def _curvature(points: np.ndarray, neighbors: np.ndarray) -> np.ndarray:
    cloud = points[neighbors]
    centered = cloud - cloud.mean(axis=1, keepdims=True)
    cov = np.einsum("nki,nkj->nij", centered, centered)
    return np.linalg.eigvalsh(cov)[:, 0]


def _collect(
    seed: int,
    points: np.ndarray,
    normals: np.ndarray,
    neighbors: np.ndarray,
    unused: np.ndarray,
    normal: np.ndarray,
) -> list[int]:
    unused[seed] = False
    members = [int(seed)]
    queue = [int(seed)]
    origin = points[seed]
    while queue:
        current = queue.pop()
        for other in neighbors[current]:
            index = int(other)
            if not unused[index]:
                continue
            other_normal = normals[index]
            if float(np.dot(normal, other_normal)) < _GROW_COS:
                continue
            if abs(float(np.dot(points[index] - origin, normal))) > plane_dist_m:
                continue
            unused[index] = False
            members.append(index)
            queue.append(index)
    return members


def _fit(points: np.ndarray, hint: np.ndarray | None = None) -> _Region | None:
    center = points.mean(axis=0)
    _u, _s, vh = np.linalg.svd(points - center, full_matrices=False)
    normal = _horizontal(vh[-1])
    if hint is not None and float(np.dot(normal, _horizontal(hint))) < 0:
        normal = -normal
    offset = float(np.dot(normal, center))
    tangent = _unit(np.array([-normal[1], normal[0], 0.0]))
    along = (points - center) @ tangent
    height = float(points[:, 2].max() - points[:, 2].min())
    span = float(along.max() - along.min())
    if span * height < _MIN_AREA:
        return None
    return _Region(
        normal,
        offset,
        points,
        float(along.min()),
        float(along.max()),
        float(points[:, 2].min()),
        float(points[:, 2].max()),
        tangent,
    )


def _snap(region: _Region) -> _Region:
    angle = float(np.degrees(np.arctan2(region.normal[1], region.normal[0])))
    delta = abs(angle) % 90.0
    delta = min(delta, 90.0 - delta)
    if delta > manhattan_snap_deg:
        return _refit_horizontal(region)
    target = round(angle / 90.0) * 90.0
    radians = np.deg2rad(target)
    normal = np.array([float(np.cos(radians)), float(np.sin(radians)), 0.0])
    if float(np.dot(normal, region.normal)) < 0:
        normal = -normal
    return _with_normal(region, normal)


def _refit_horizontal(region: _Region) -> _Region:
    return _with_normal(region, _horizontal(region.normal))


def _with_normal(region: _Region, normal: np.ndarray) -> _Region:
    normal = _unit(normal)
    center = region.points.mean(axis=0)
    offset = float(np.dot(normal, center))
    tangent = _unit(np.array([-normal[1], normal[0], 0.0]))
    along = (region.points - center) @ tangent
    return _Region(
        normal,
        offset,
        region.points,
        float(along.min()),
        float(along.max()),
        region.z0,
        region.z1,
        tangent,
    )


def _merge(regions: list[_Region]) -> list[_Region]:
    pending = list(regions)
    changed = True
    while changed:
        changed = False
        index = 0
        while index < len(pending):
            other = index + 1
            while other < len(pending):
                if _can_merge(pending[index], pending[other]):
                    pending[index] = _combine(pending[index], pending[other])
                    del pending[other]
                    changed = True
                else:
                    other += 1
            index += 1
    kept = [region for region in pending if region.z1 - region.z0 >= _MIN_HEIGHT]
    return kept


def _can_merge(left: _Region, right: _Region) -> bool:
    if float(np.dot(left.normal, right.normal)) < 0.99:
        return False
    if abs(left.offset - right.offset) > 0.03:
        return False
    if min(left.z1, right.z1) - max(left.z0, right.z0) < -0.15:
        return False
    gap = _interval_gap(left.along0, left.along1, *_projected(left, right))
    return gap <= 0.15


def _projected(base: _Region, other: _Region) -> tuple[float, float]:
    center = base.points.mean(axis=0)
    along = (other.points - center) @ base.tangent
    return float(along.min()), float(along.max())


def _interval_gap(a0: float, a1: float, b0: float, b1: float) -> float:
    if a1 < b0:
        return b0 - a1
    if b1 < a0:
        return a0 - b1
    return 0.0


def _combine(left: _Region, right: _Region) -> _Region:
    fitted = _fit(np.vstack((left.points, right.points)), left.normal)
    if fitted is None:
        return left
    return _snap(fitted)


def _pair(
    regions: list[_Region], floor_xy: np.ndarray, level_index: int
) -> tuple[list[WallFace], list[dict[str, str]]]:
    faces: list[WallFace] = []
    issues: list[dict[str, str]] = []
    hull = _hull(regions)
    choice = [_best_partner(regions, index) for index in range(len(regions))]
    consumed: set[int] = set()
    for index, region in enumerate(regions):
        if index in consumed:
            continue
        partner = choice[index]
        mutual = partner is not None and choice[partner] == index
        if not mutual or partner is None:
            face = _assumed(region, hull, level_index)
            if face is None:
                continue
            faces.append(face)
            issues.append(
                {
                    "code": "assumed_thickness",
                    "severity": "warning",
                    "message": "A wall was seen from one side, so its thickness is assumed.",
                }
            )
            continue
        if partner < index:
            continue
        consumed.add(index)
        consumed.add(partner)
        face = _paired(region, regions[partner], floor_xy, level_index)
        if face is not None:
            faces.append(face)
    return faces, issues


def _best_partner(regions: list[_Region], index: int) -> int | None:
    region = regions[index]
    best: int | None = None
    best_overlap = 0.0
    best_distance = float("inf")
    for other_index, other in enumerate(regions):
        if other_index == index:
            continue
        scored = _pair_overlap(region, other)
        if scored is None:
            continue
        overlap, distance = scored
        better = overlap > best_overlap + 1e-6 or (
            abs(overlap - best_overlap) <= 1e-6 and distance < best_distance
        )
        if not better:
            continue
        best = other_index
        best_overlap = overlap
        best_distance = distance
    return best


def _pair_overlap(left: _Region, right: _Region) -> tuple[float, float] | None:
    if float(np.dot(left.normal, right.normal)) > -0.95:
        return None
    point = right.normal * right.offset
    distance = abs(left.offset - float(np.dot(left.normal, point)))
    if distance < thickness_min_m or distance > thickness_max_m:
        return None
    a0, a1 = left.along0, left.along1
    b0, b1 = _projected(left, right)
    overlap = min(a1, b1) - max(a0, b0)
    shorter = min(a1 - a0, b1 - b0)
    if shorter <= 0 or overlap < 0.5 * shorter:
        return None
    return overlap, distance


def _paired(
    left: _Region, right: _Region, floor_xy: np.ndarray, level_index: int
) -> WallFace | None:
    point = right.normal * right.offset
    other = float(np.dot(left.normal, point))
    thickness = abs(left.offset - other)
    mid = (left.offset + other) / 2.0
    b0, b1 = _projected(left, right)
    along0 = max(left.along0, b0)
    along1 = min(left.along1, b1)
    if along1 - along0 < min_wall_m:
        return None
    x1, y1, x2, y2 = _endpoints(left, mid, along0, along1)
    kind = _kind(x1, y1, x2, y2, floor_xy, thickness)
    return _face(
        x1, y1, x2, y2, thickness, False, kind, 1.0, 2, left.normal, mid, level_index
    )


def _assumed(region: _Region, hull, level_index: int) -> WallFace | None:
    if region.along1 - region.along0 < min_wall_m:
        return None
    if region.z1 - region.z0 < _MIN_HEIGHT:
        return None
    on_hull = _on_hull(region, hull)
    thickness = assumed_exterior_m if on_hull else assumed_interior_m
    kind = "exterior" if on_hull else "interior"
    # The seen plane is a face. The centerline sits half a thickness into the wall.
    midline = region.offset + thickness / 2.0
    x1, y1, x2, y2 = _endpoints(region, midline, region.along0, region.along1)
    return _face(
        x1, y1, x2, y2, thickness, True, kind, 0.4, 1, region.normal, region.offset, level_index
    )


def _endpoints(
    region: _Region, offset: float, along0: float, along1: float
) -> tuple[float, float, float, float]:
    center = region.points.mean(axis=0)
    origin = np.array([center[0], center[1], 0.0])
    origin = origin + region.normal * (offset - float(np.dot(region.normal, origin)))
    tangent = region.tangent
    start = origin + tangent * along0
    end = origin + tangent * along1
    # along is measured from center, so shift by the along of the origin... 
    # _with_normal stores along relative to center. origin above is the plane point
    # through center's projection, and along 0 is center's along which is 0.
    # along values are relative to center, and origin is the projection of center
    # onto the plane, whose along is 0. Adding tangent * along is correct.
    return _millimetre(start[0]), _millimetre(start[1]), _millimetre(end[0]), _millimetre(end[1])


def _face(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    thickness: float,
    assumed: bool,
    kind: str,
    confidence: float,
    sides: int,
    normal: np.ndarray,
    offset: float,
    level_index: int,
) -> WallFace:
    half = thickness / 2.0
    nx, ny = float(normal[0]), float(normal[1])
    polygon = [
        (x1 + nx * half, y1 + ny * half),
        (x2 + nx * half, y2 + ny * half),
        (x2 - nx * half, y2 - ny * half),
        (x1 - nx * half, y1 - ny * half),
    ]
    return WallFace(
        x1,
        y1,
        x2,
        y2,
        thickness,
        assumed,
        kind,
        confidence,
        sides,
        nx,
        ny,
        offset,
        polygon,
        level_index,
    )


def _kind(
    x1: float, y1: float, x2: float, y2: float, floor_xy: np.ndarray, thickness: float
) -> str:
    if len(floor_xy) == 0:
        return "interior"
    margin = thickness / 2.0 + 0.05
    positive = _side_hits(x1, y1, x2, y2, floor_xy, positive=True, margin=margin)
    negative = _side_hits(x1, y1, x2, y2, floor_xy, positive=False, margin=margin)
    if positive and negative:
        return "partition"
    if positive != negative:
        return "exterior"
    return "interior"


def _side_hits(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    floor_xy: np.ndarray,
    *,
    positive: bool,
    margin: float,
) -> bool:
    dx = x2 - x1
    dy = y2 - y1
    length = float(np.hypot(dx, dy))
    if length == 0 or len(floor_xy) == 0:
        return False
    px = floor_xy[:, 0] - x1
    py = floor_xy[:, 1] - y1
    cross = dx * py - dy * px
    signed = cross / length
    along = (px * dx + py * dy) / (length * length)
    band = (along >= -0.05) & (along <= 1.05)
    if positive:
        return bool(np.any(band & (signed > margin) & (signed < 0.5)))
    return bool(np.any(band & (signed < -margin) & (signed > -0.5)))


def _hull(regions: list[_Region]):
    if not regions:
        return None
    samples = np.vstack(
        [region.points[:: max(1, len(region.points) // 40)][:, :2] for region in regions]
    )
    return MultiPoint(samples).convex_hull


def _on_hull(region: _Region, hull) -> bool:
    if hull is None or hull.is_empty:
        return False
    center = region.points.mean(axis=0)
    start = center + region.tangent * region.along0
    end = center + region.tangent * region.along1
    mid_x = (float(start[0]) + float(end[0])) / 2.0
    mid_y = (float(start[1]) + float(end[1])) / 2.0
    return float(Point(mid_x, mid_y).distance(hull.boundary)) <= 0.08


def _off_manhattan(x1: float, y1: float, x2: float, y2: float) -> bool:
    angle = abs(float(np.degrees(np.arctan2(y2 - y1, x2 - x1)))) % 90.0
    delta = min(angle, 90.0 - angle)
    return delta > manhattan_snap_deg + 1e-6


def _millimetre(value: float) -> float:
    return round(float(value), 3)


def _horizontal(vector: np.ndarray) -> np.ndarray:
    flat = np.array([float(vector[0]), float(vector[1]), 0.0])
    length = float(np.linalg.norm(flat))
    if length < 1e-8:
        return np.array([1.0, 0.0, 0.0])
    return flat / length


def _unit(vector: np.ndarray) -> np.ndarray:
    length = float(np.linalg.norm(vector))
    if length < 1e-8:
        return np.array([1.0, 0.0, 0.0])
    return vector / length
