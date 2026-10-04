"""Fixed fixtures and furniture from non-structural points. See docs/algorithms.md."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, cast

import numpy as np
from scipy.cluster.hierarchy import fclusterdata
from shapely.geometry import MultiPoint, Point, Polygon

from hero.pipeline.cells import DraftLevel
from hero.pipeline.normalize import Normalized
from hero.pipeline.openings import FoundColumn, FoundStair, column_footprint

Row = tuple[str, str, tuple[float, float], tuple[float, float], tuple[float, float]]
_ROWS: tuple[Row, ...] = (
    ("toilet", "fixture", (0.35, 0.45), (0.60, 0.80), (0.35, 0.55)),
    ("sink", "fixture", (0.40, 0.80), (0.35, 0.55), (0.10, 0.25)),
    ("bathtub", "fixture", (0.70, 0.90), (1.40, 1.90), (0.40, 0.60)),
    ("shower", "fixture", (0.70, 1.20), (0.70, 1.20), (0.05, 0.30)),
    ("kitchen-counter", "fixture", (1.20, 1.0e9), (0.50, 0.70), (0.80, 1.00)),
    ("stove", "fixture", (0.55, 0.65), (0.55, 0.65), (0.85, 1.00)),
    ("bed-double", "furniture", (1.30, 2.00), (1.90, 2.20), (0.40, 0.70)),
    ("sofa", "furniture", (0.80, 1.10), (1.40, 2.80), (0.70, 1.00)),
    ("table", "furniture", (0.60, 1.40), (0.60, 2.20), (0.65, 0.80)),
    ("wardrobe", "furniture", (0.80, 1.0e9), (0.50, 0.70), (1.80, 2.40)),
)


@dataclass
class FoundFixture:
    id: str
    symbol: str
    x: float
    y: float
    rotation_deg: float
    width: float
    depth: float
    confidence: float
    role: str


def attach_fixtures(drafts: list[DraftLevel], result: Normalized) -> None:
    for draft in drafts:
        _fixtures(draft, result)


def classify_box(width: float, depth: float, height: float) -> tuple[str, str, float, float, float]:
    """Return symbol, role, confidence, and the width/depth assignment that matched."""
    hits: list[tuple[float, str, str, float, float]] = []
    seen: set[str] = set()
    for symbol, role, width_range, depth_range, height_range in _ROWS:
        if not (height_range[0] <= height <= height_range[1]):
            continue
        direct = _in(width, width_range) and _in(depth, depth_range)
        swapped = _in(depth, width_range) and _in(width, depth_range)
        if not direct and not swapped:
            continue
        if symbol in seen:
            continue
        seen.add(symbol)
        use_width, use_depth = (width, depth) if direct else (depth, width)
        if direct and swapped:
            direct_distance = _area_distance(width, depth, width_range, depth_range)
            swapped_distance = _area_distance(depth, width, width_range, depth_range)
            if swapped_distance < direct_distance:
                use_width, use_depth = depth, width
        hits.append(
            (
                _area_distance(use_width, use_depth, width_range, depth_range),
                symbol,
                role,
                use_width,
                use_depth,
            )
        )
    if not hits:
        return "block", "furniture", 0.3, width, depth
    hits.sort(key=lambda item: item[0])
    _distance, symbol, role, use_width, use_depth = hits[0]
    confidence = 0.8 if len(hits) == 1 else 0.5
    return symbol, role, confidence, use_width, use_depth


def _fixtures(draft: DraftLevel, result: Normalized) -> None:
    points = result.points
    normals = result.normals
    if len(points) == 0:
        return
    mask = (points[:, 2] >= draft.elevation - 0.05) & (
        points[:, 2] <= draft.elevation + draft.ceiling_height + 0.05
    )
    mask &= np.abs(normals[:, 2]) <= math.sin(math.radians(20.0))
    mask &= _clear_of_walls(points[:, :2], draft)
    mask &= _clear_of_columns(points[:, :2], draft.columns)
    mask &= _clear_of_stairs(points[:, :2], draft.stairs)
    chosen = points[mask]
    if len(chosen) < 15:
        return
    chosen = _thin(chosen, 0.05)
    if len(chosen) < 15:
        return
    labels = fclusterdata(chosen, t=0.15, criterion="distance", method="single")
    for label in np.unique(labels):
        cluster = chosen[labels == label]
        if len(cluster) < 12:
            continue
        span_x = float(cluster[:, 0].max() - cluster[:, 0].min())
        span_y = float(cluster[:, 1].max() - cluster[:, 1].min())
        if span_x < 0.30 and span_y < 0.30:
            continue
        rect = _oriented(cluster[:, :2])
        if rect is None:
            continue
        edge_w, edge_d, angle, center = rect
        height = _cluster_height(cluster, points, draft.elevation, draft.ceiling_height)
        symbol, role, confidence, width, depth = classify_box(edge_w, edge_d, height)
        if _near_wall_center(center, draft):
            continue
        if width <= 0 or depth <= 0:
            continue
        draft.fixtures.append(
            FoundFixture(
                id=f"f{len(draft.fixtures) + 1}",
                symbol=symbol,
                x=center[0],
                y=center[1],
                rotation_deg=angle if abs(width - edge_w) <= abs(width - edge_d) else angle + 90.0,
                width=width,
                depth=depth,
                confidence=confidence,
                role=role,
            )
        )


def _cluster_height(
    cluster: np.ndarray, points: np.ndarray, elevation: float, ceiling: float
) -> float:
    """Vertical extent, including a horizontal top that the side points stop short of."""
    low = float(cluster[:, 2].min())
    high = float(cluster[:, 2].max())
    span_x0, span_x1 = float(cluster[:, 0].min()) - 0.02, float(cluster[:, 0].max()) + 0.02
    span_y0, span_y1 = float(cluster[:, 1].min()) - 0.02, float(cluster[:, 1].max()) + 0.02
    inside = (
        (points[:, 0] >= span_x0)
        & (points[:, 0] <= span_x1)
        & (points[:, 1] >= span_y0)
        & (points[:, 1] <= span_y1)
        & (points[:, 2] >= low - 0.08)
        & (points[:, 2] <= min(elevation + ceiling - 0.20, high + 0.12))
    )
    if not np.any(inside):
        return high - low
    return float(points[inside, 2].max() - points[inside, 2].min())


def _in(value: float, bounds: tuple[float, float]) -> bool:
    return bounds[0] - 1e-6 <= value <= bounds[1] + 1e-6


def _mid(bounds: tuple[float, float], measured: float) -> float:
    if bounds[1] >= 1.0e8:
        return max(bounds[0], measured)
    return (bounds[0] + bounds[1]) / 2.0


def _area_distance(
    width: float,
    depth: float,
    width_range: tuple[float, float],
    depth_range: tuple[float, float],
) -> float:
    return abs(width * depth - _mid(width_range, width) * _mid(depth_range, depth))


def _clear_of_walls(xy: np.ndarray, draft: DraftLevel) -> np.ndarray:
    keep = np.ones(len(xy), dtype=bool)
    verts = {vertex.id: vertex for vertex in draft.vertices}
    for wall in draft.walls:
        start = verts.get(wall.a)
        end = verts.get(wall.b)
        if start is None or end is None:
            continue
        dx = end.x - start.x
        dy = end.y - start.y
        length = math.hypot(dx, dy)
        if length < 1e-6:
            continue
        px = xy[:, 0] - start.x
        py = xy[:, 1] - start.y
        along = (px * dx + py * dy) / length
        cross = np.abs(dx * py - dy * px) / length
        band = wall.thickness / 2.0 + 0.12
        near = (along >= -0.1) & (along <= length + 0.1) & (cross <= band)
        keep &= ~near
    return keep


def _clear_of_columns(xy: np.ndarray, columns: list[FoundColumn]) -> np.ndarray:
    keep = np.ones(len(xy), dtype=bool)
    for column in columns:
        footprint = column_footprint(column).buffer(0.08)
        for index, (x, y) in enumerate(xy):
            if keep[index] and footprint.covers(Point(float(x), float(y))):
                keep[index] = False
    return keep


def _clear_of_stairs(xy: np.ndarray, stairs: list[FoundStair]) -> np.ndarray:
    keep = np.ones(len(xy), dtype=bool)
    for stair in stairs:
        if len(stair.outline) < 3:
            continue
        footprint = Polygon(stair.outline).buffer(0.08)
        for index, (x, y) in enumerate(xy):
            if keep[index] and footprint.covers(Point(float(x), float(y))):
                keep[index] = False
    return keep


def _near_wall_center(center: tuple[float, float], draft: DraftLevel) -> bool:
    verts = {vertex.id: vertex for vertex in draft.vertices}
    for wall in draft.walls:
        start = verts.get(wall.a)
        end = verts.get(wall.b)
        if start is None or end is None:
            continue
        dx = end.x - start.x
        dy = end.y - start.y
        length = math.hypot(dx, dy)
        if length < 1e-6:
            continue
        px = center[0] - start.x
        py = center[1] - start.y
        along = (px * dx + py * dy) / length
        cross = abs(dx * py - dy * px) / length
        if -0.05 <= along <= length + 0.05 and cross <= wall.thickness / 2.0 + 0.05:
            return True
    return False


def _thin(points: np.ndarray, size: float) -> np.ndarray:
    if len(points) <= 4000:
        keys = np.floor(points / size).astype(np.int64)
        _unique, index = np.unique(keys, axis=0, return_index=True)
        return points[np.sort(index)]
    step = max(1, len(points) // 4000)
    return points[::step]


def _oriented(
    xy: np.ndarray,
) -> tuple[float, float, float, tuple[float, float]] | None:
    if len(xy) < 3:
        return None
    rect = MultiPoint(xy).minimum_rotated_rectangle
    if rect.is_empty or not hasattr(rect, "exterior"):
        return None
    coords = np.asarray(cast(Any, rect).exterior.coords)
    if len(coords) < 4:
        return None
    edge_a = coords[1] - coords[0]
    edge_b = coords[2] - coords[1]
    width = float(np.hypot(edge_a[0], edge_a[1]))
    depth = float(np.hypot(edge_b[0], edge_b[1]))
    if width < 1e-3 or depth < 1e-3:
        return None
    angle = float(np.degrees(np.arctan2(edge_a[1], edge_a[0])))
    center = rect.centroid
    return width, depth, angle, (float(center.x), float(center.y))
