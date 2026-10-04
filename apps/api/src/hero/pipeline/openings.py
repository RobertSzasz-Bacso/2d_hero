"""Doors, windows, passages, columns, and stairs. See docs/algorithms.md."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, cast

import cv2
import numpy as np
from scipy.cluster.hierarchy import fclusterdata
from shapely.geometry import MultiPoint, Point, Polygon

from hero.pipeline.cells import DraftLevel, DraftVertex, DraftWall
from hero.pipeline.normalize import Normalized
from hero.pipeline.surfaces import WallFace
from hero.pipeline.tolerances import opening_cell_m

_CELL = opening_cell_m
_CLOSE_M = 0.04
_BAND_EXTRA = 0.05


@dataclass
class FoundOpening:
    id: str
    wall: str
    kind: str
    offset: float
    width: float
    sill: float
    head: float
    swing: str
    swing_side: str
    confidence: float


@dataclass
class FoundColumn:
    id: str
    x: float
    y: float
    width: float
    depth: float
    rotation_deg: float


@dataclass
class FoundStair:
    id: str
    outline: list[tuple[float, float]]
    direction: tuple[float, float]
    riser_count: int
    from_elevation: float
    to_elevation: float


def attach_structure(
    drafts: list[DraftLevel], result: Normalized, faces: list[WallFace] | None = None
) -> None:
    """Fill openings, columns, and stairs on each drafted storey."""
    for index, draft in enumerate(drafts):
        _openings(draft, result)
        own = [face for face in faces or [] if face.level_index == index]
        _passages_in_gaps(draft, own)
        _columns(draft, result)
        _stairs(draft, result)


def _openings(draft: DraftLevel, result: Normalized) -> None:
    verts = {vertex.id: (vertex.x, vertex.y) for vertex in draft.vertices}
    for wall in draft.walls:
        start = verts.get(wall.a)
        end = verts.get(wall.b)
        if start is None or end is None:
            continue
        length = math.hypot(end[0] - start[0], end[1] - start[1])
        if length < 0.5:
            continue
        solid = _elevation(result, draft, start, end, length, wall.thickness)
        if solid is None:
            continue
        for void in _voids(solid, length, draft.ceiling_height):
            kind = _kind(void["sill"], void["head"], void["width"], draft.ceiling_height)
            if kind is None:
                continue
            width = min(void["width"], length - 0.01)
            if width <= 0.05:
                continue
            offset = min(1.0, max(0.0, void["center"] / length))
            swing = "none"
            if kind == "door":
                swing = "double" if width > 1.20 else "left"
            low = bool(void["low_confidence"])
            opening = FoundOpening(
                id=f"o{len(draft.openings) + 1}",
                wall=wall.id,
                kind=kind,
                offset=offset,
                width=width,
                sill=void["sill"],
                head=min(void["head"], draft.ceiling_height),
                swing=swing,
                swing_side="positive",
                confidence=0.45 if low else 0.9,
            )
            if opening.head <= opening.sill:
                continue
            draft.openings.append(opening)
            if low:
                draft.issues.append(
                    {
                        "code": "low_confidence_opening",
                        "severity": "warning",
                        "message": "An opening is only partly empty and was kept.",
                        "elementId": opening.id,
                    }
                )


def _elevation(
    result: Normalized,
    draft: DraftLevel,
    start: tuple[float, float],
    end: tuple[float, float],
    length: float,
    thickness: float,
) -> np.ndarray | None:
    z0 = draft.elevation + 0.05
    z1 = draft.elevation + draft.ceiling_height - 0.05
    if z1 <= z0:
        return None
    nu = max(1, int(math.ceil(length / _CELL)))
    nz = max(1, int(math.ceil((z1 - z0) / _CELL)))
    image = np.zeros((nz, nu), dtype=np.uint8)
    band = thickness / 2.0 + _BAND_EXTRA
    if result.mesh_vertices is not None and result.mesh_faces is not None:
        _raster_mesh(
            image, result.mesh_vertices, result.mesh_faces, start, end, length, band, z0, z1
        )
    else:
        _raster_points(image, result, draft, start, end, length, band, z0, z1)
    radius = max(1, int(round(_CLOSE_M / _CELL / 2.0)))
    size = radius * 2 + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
    closed = cv2.morphologyEx(image, cv2.MORPH_CLOSE, kernel)
    return np.asarray(closed)


def _raster_mesh(
    image: np.ndarray,
    vertices: np.ndarray,
    faces: np.ndarray,
    start: tuple[float, float],
    end: tuple[float, float],
    length: float,
    band: float,
    z0: float,
    z1: float,
) -> None:
    tris = vertices[faces]
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    px = tris[:, :, 0] - start[0]
    py = tris[:, :, 1] - start[1]
    cross = np.abs(dx * py - dy * px) / length
    along = (px * dx + py * dy) / length
    z = tris[:, :, 2]
    keep = (
        (np.max(cross, axis=1) <= band)
        & (np.max(along, axis=1) >= -0.05)
        & (np.min(along, axis=1) <= length + 0.05)
        & (np.max(z, axis=1) >= z0)
        & (np.min(z, axis=1) <= z1)
    )
    for triangle_u, triangle_z in zip(along[keep], z[keep], strict=True):
        pixels = np.column_stack(
            (
                np.round(triangle_u / _CELL).astype(np.int32),
                np.round((triangle_z - z0) / _CELL).astype(np.int32),
            )
        )
        cv2.fillConvexPoly(image, pixels, 255)


def _raster_points(
    image: np.ndarray,
    result: Normalized,
    draft: DraftLevel,
    start: tuple[float, float],
    end: tuple[float, float],
    length: float,
    band: float,
    z0: float,
    z1: float,
) -> None:
    points = result.points
    if len(points) == 0:
        return
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    px = points[:, 0] - start[0]
    py = points[:, 1] - start[1]
    cross = np.abs(dx * py - dy * px) / length
    along = (px * dx + py * dy) / length
    keep = (
        (cross <= band)
        & (along >= -0.02)
        & (along <= length + 0.02)
        & (points[:, 2] >= draft.elevation)
        & (points[:, 2] <= draft.elevation + draft.ceiling_height)
        & (points[:, 2] >= z0)
        & (points[:, 2] <= z1)
    )
    if not np.any(keep):
        return
    cols = np.clip(np.floor(along[keep] / _CELL).astype(np.int32), 0, image.shape[1] - 1)
    rows = np.clip(np.floor((points[keep, 2] - z0) / _CELL).astype(np.int32), 0, image.shape[0] - 1)
    counts = np.zeros(image.shape, dtype=np.int32)
    np.add.at(counts, (rows, cols), 1)
    image[counts >= 2] = 255


def _voids(solid: np.ndarray, length: float, ceiling: float) -> list[dict[str, float | bool]]:
    empty = solid == 0
    columns: list[tuple[int, int, int]] = []
    min_rows = max(3, int(round(0.35 / _CELL)))
    for col in range(solid.shape[1]):
        rows = np.flatnonzero(empty[:, col])
        if len(rows) < min_rows:
            continue
        z0 = int(rows[0])
        z1 = int(rows[-1])
        if z1 - z0 + 1 < min_rows:
            continue
        columns.append((col, z0, z1))
    voids: list[dict[str, float | bool]] = []
    group: list[tuple[int, int, int]] = []

    def flush() -> None:
        if len(group) < max(3, int(round(0.35 / _CELL))):
            group.clear()
            return
        z0 = int(np.median([item[1] for item in group]))
        z1 = int(np.median([item[2] for item in group]))
        c0 = group[0][0]
        c1 = group[-1][0]
        if z1 <= z0:
            group.clear()
            return
        bbox = empty[z0 : z1 + 1, c0 : c1 + 1]
        ratio = float(np.count_nonzero(bbox)) / float(bbox.size)
        width = (c1 - c0 + 1) * _CELL
        center = (c0 + c1 + 1) * _CELL / 2.0
        sill = 0.0 if z0 <= 1 else 0.05 + z0 * _CELL
        head = ceiling if z1 >= solid.shape[0] - 2 else 0.05 + (z1 + 1) * _CELL
        if width < length:
            voids.append(
                {
                    "sill": sill,
                    "head": min(head, ceiling),
                    "width": width,
                    "center": min(center, length),
                    "low_confidence": ratio < 0.70,
                }
            )
        group.clear()

    for column in columns:
        split = False
        if group:
            previous = group[-1]
            split = column[0] > previous[0] + 1
            split = split or abs(column[1] - previous[1]) > 4 or abs(column[2] - previous[2]) > 4
        if split:
            flush()
        group.append(column)
    flush()
    return voids


def _kind(sill: float, head: float, width: float, ceiling: float) -> str | None:
    if sill <= 0.15 and abs(ceiling - head) <= 0.20 and width >= 0.90:
        return "passage"
    below = ceiling - head
    if sill <= 0.15 and 1.90 <= head <= 2.40 and below >= 0.20 and 0.60 <= width <= 1.80:
        return "door"
    height = head - sill
    if sill >= 0.40 and head <= ceiling - 0.05 and height >= 0.40 and 0.40 <= width <= 3.00:
        return "window"
    return None


def _passages_in_gaps(draft: DraftLevel, faces: list[WallFace]) -> None:
    """A full-height hole splits one wall into two faces. That hole is a passage."""
    solid = [face for face in faces if not face.assumed and _face_length(face) >= 0.4]
    for left in range(len(solid)):
        for right in range(left + 1, len(solid)):
            gap = _collinear_gap(solid[left], solid[right])
            if gap is None:
                continue
            x1, y1, x2, y2, thickness, center, width = gap
            if _opening_already(draft, center[0], center[1]):
                continue
            wall = _span_wall(draft, x1, y1, x2, y2, thickness, solid[left].kind)
            if wall is None:
                continue
            length = math.hypot(x2 - x1, y2 - y1)
            if width >= length:
                continue
            offset = _offset_on_span(draft, wall, center[0], center[1])
            draft.openings.append(
                FoundOpening(
                    id=f"o{len(draft.openings) + 1}",
                    wall=wall.id,
                    kind="passage",
                    offset=offset,
                    width=width,
                    sill=0.0,
                    head=draft.ceiling_height,
                    swing="none",
                    swing_side="positive",
                    confidence=0.85,
                )
            )


def _face_length(face: WallFace) -> float:
    return math.hypot(face.x2 - face.x1, face.y2 - face.y1)


def _collinear_gap(
    left: WallFace, right: WallFace
) -> tuple[float, float, float, float, float, tuple[float, float], float] | None:
    if abs(left.thickness - right.thickness) > 0.05:
        return None
    ldx, ldy = left.x2 - left.x1, left.y2 - left.y1
    left_length = math.hypot(ldx, ldy)
    rdx, rdy = right.x2 - right.x1, right.y2 - right.y1
    right_length = math.hypot(rdx, rdy)
    if left_length < 0.2 or right_length < 0.2:
        return None
    if abs(ldx * rdy - ldy * rdx) / (left_length * right_length) > 0.05:
        return None
    cross = abs(ldx * (right.y1 - left.y1) - ldy * (right.x1 - left.x1)) / left_length
    if cross > 0.08:
        return None
    origin = (left.x1, left.y1)
    axis = (ldx / left_length, ldy / left_length)
    points = (
        (left.x1, left.y1),
        (left.x2, left.y2),
        (right.x1, right.y1),
        (right.x2, right.y2),
    )
    projected = sorted(
        ((_along(point, origin, axis), point) for point in points),
        key=lambda item: item[0],
    )
    intervals = sorted(
        (
            min(_along((face.x1, face.y1), origin, axis), _along((face.x2, face.y2), origin, axis)),
            max(_along((face.x1, face.y1), origin, axis), _along((face.x2, face.y2), origin, axis)),
        )
        for face in (left, right)
    )
    gap_start = intervals[0][1]
    gap_end = intervals[1][0]
    width = gap_end - gap_start
    if width < 0.90 or width > 2.50:
        return None
    start = projected[0][0]
    end = projected[-1][0]
    x1 = origin[0] + axis[0] * start
    y1 = origin[1] + axis[1] * start
    x2 = origin[0] + axis[0] * end
    y2 = origin[1] + axis[1] * end
    mid = (gap_start + gap_end) / 2.0
    center = (origin[0] + axis[0] * mid, origin[1] + axis[1] * mid)
    return x1, y1, x2, y2, left.thickness, center, width


def _along(
    point: tuple[float, float], origin: tuple[float, float], axis: tuple[float, float]
) -> float:
    return (point[0] - origin[0]) * axis[0] + (point[1] - origin[1]) * axis[1]


def _opening_already(draft: DraftLevel, x: float, y: float) -> bool:
    verts = {vertex.id: vertex for vertex in draft.vertices}
    for opening in draft.openings:
        wall = next((item for item in draft.walls if item.id == opening.wall), None)
        if wall is None:
            continue
        start = verts.get(wall.a)
        end = verts.get(wall.b)
        if start is None or end is None:
            continue
        ox = start.x + (end.x - start.x) * opening.offset
        oy = start.y + (end.y - start.y) * opening.offset
        if math.hypot(ox - x, oy - y) < 0.4:
            return True
    return False


def _span_wall(
    draft: DraftLevel, x1: float, y1: float, x2: float, y2: float, thickness: float, kind: str
) -> DraftWall | None:
    verts = {vertex.id: vertex for vertex in draft.vertices}
    length = math.hypot(x2 - x1, y2 - y1)
    for wall in draft.walls:
        start = verts.get(wall.a)
        end = verts.get(wall.b)
        if start is None or end is None:
            continue
        same = math.hypot(start.x - x1, start.y - y1) < 0.08
        same = same and math.hypot(end.x - x2, end.y - y2) < 0.08
        flipped = math.hypot(start.x - x2, start.y - y2) < 0.08
        flipped = flipped and math.hypot(end.x - x1, end.y - y1) < 0.08
        if same or flipped:
            return wall
    if length < 0.5:
        return None
    kind_name = kind if kind in {"exterior", "interior", "partition", "assumed"} else "exterior"
    wall = DraftWall(
        id=f"w{len(draft.walls) + 1}",
        a=_ensure_vertex(draft, x1, y1),
        b=_ensure_vertex(draft, x2, y2),
        thickness=thickness,
        kind=kind_name,
        confidence=0.8,
    )
    if wall.a == wall.b:
        return None
    draft.walls.append(wall)
    return wall


def _ensure_vertex(draft: DraftLevel, x: float, y: float) -> str:
    for vertex in draft.vertices:
        if math.hypot(vertex.x - x, vertex.y - y) <= 0.03:
            return vertex.id
    vertex = DraftVertex(f"v{len(draft.vertices) + 1}", round(x, 3), round(y, 3))
    draft.vertices.append(vertex)
    return vertex.id


def _offset_on_span(draft: DraftLevel, wall: DraftWall, x: float, y: float) -> float:
    verts = {vertex.id: vertex for vertex in draft.vertices}
    start = verts[wall.a]
    end = verts[wall.b]
    dx = end.x - start.x
    dy = end.y - start.y
    length = math.hypot(dx, dy)
    if length < 1e-6:
        return 0.5
    offset = ((x - start.x) * dx + (y - start.y) * dy) / (length * length)
    return min(1.0, max(0.0, offset))


def _columns(draft: DraftLevel, result: Normalized) -> None:
    points = result.points
    normals = result.normals
    if len(points) == 0:
        return
    vertical = np.abs(normals[:, 2]) <= math.sin(math.radians(15.0))
    band = (
        (points[:, 2] >= draft.elevation + 0.05)
        & (points[:, 2] <= draft.elevation + draft.ceiling_height - 0.05)
    )
    chosen = points[vertical & band]
    if len(chosen) < 20:
        return
    chosen = chosen[_away_from_walls(chosen[:, :2], draft)]
    if len(chosen) < 20:
        return
    centers, zmin, zmax = _plan_cells(chosen, 0.08)
    if len(centers) < 8:
        return
    labels = fclusterdata(centers, t=0.18, criterion="distance", method="single")
    found: list[FoundColumn] = []
    for label in np.unique(labels):
        mask = labels == label
        if int(mask.sum()) < 6:
            continue
        if float(zmax[mask].max() - zmin[mask].min()) < 1.2:
            continue
        rect = _rectangle(centers[mask])
        if rect is None:
            continue
        width, depth, angle, x, y = rect
        short = min(width, depth)
        long = max(width, depth)
        if short < 0.15 or long > 0.80:
            continue
        found.append(FoundColumn(id="", x=x, y=y, width=width, depth=depth, rotation_deg=angle))
    found = _merge_columns(found)
    for column in found:
        column.id = f"c{len(draft.columns) + 1}"
        column.width = max(column.width, 0.01)
        column.depth = max(column.depth, 0.01)
        draft.columns.append(column)


def _away_from_walls(xy: np.ndarray, draft: DraftLevel) -> np.ndarray:
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
        cross = (dx * py - dy * px) / length
        band = wall.thickness / 2.0 + 0.08
        near = (along >= -0.08) & (along <= length + 0.08) & (np.abs(cross) <= band)
        keep &= ~near
    return keep


def _plan_cells(points: np.ndarray, size: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """One plan sample per cell, keeping the vertical extent of the points in it."""
    keys = np.floor(points[:, :2] / size).astype(np.int64)
    order = np.lexsort((keys[:, 1], keys[:, 0]))
    keys = keys[order]
    ordered = points[order]
    change = np.any(np.diff(keys, axis=0) != 0, axis=1)
    starts = np.concatenate(([0], np.flatnonzero(change) + 1))
    ends = np.concatenate((starts[1:], [len(ordered)]))
    centers = np.empty((len(starts), 2), dtype=np.float64)
    zmin = np.empty(len(starts), dtype=np.float64)
    zmax = np.empty(len(starts), dtype=np.float64)
    for index, (start, end) in enumerate(zip(starts, ends, strict=True)):
        block = ordered[start:end]
        centers[index] = block[:, :2].mean(axis=0)
        zmin[index] = float(block[:, 2].min())
        zmax[index] = float(block[:, 2].max())
    return centers, zmin, zmax


def _rectangle(xy: np.ndarray) -> tuple[float, float, float, float, float] | None:
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
    return width, depth, angle, float(center.x), float(center.y)


def _merge_columns(found: list[FoundColumn]) -> list[FoundColumn]:
    used = [False] * len(found)
    merged: list[FoundColumn] = []
    for index, column in enumerate(found):
        if used[index]:
            continue
        used[index] = True
        group = [column]
        for other_index, other in enumerate(found):
            if used[other_index]:
                continue
            if math.hypot(other.x - column.x, other.y - column.y) <= 0.55:
                used[other_index] = True
                group.append(other)
        if len(group) == 1:
            merged.append(column)
            continue
        xs = [item.x for item in group]
        ys = [item.y for item in group]
        merged.append(
            FoundColumn(
                id="",
                x=float(np.mean(xs)),
                y=float(np.mean(ys)),
                width=max(item.width for item in group),
                depth=max(item.depth for item in group),
                rotation_deg=group[0].rotation_deg,
            )
        )
    return merged


def _stairs(draft: DraftLevel, result: Normalized) -> None:
    stair = None
    if result.mesh_vertices is not None and result.mesh_faces is not None:
        stair = _slope_mesh(
            result.mesh_vertices, result.mesh_faces, draft.elevation, draft.ceiling_height
        )
    if stair is None:
        stair = _slope_points(result, draft)
    if stair is None:
        return
    outline, direction, risers, z0, z1 = stair
    if z1 <= z0:
        return
    draft.stairs.append(
        FoundStair(
            id=f"s{len(draft.stairs) + 1}",
            outline=outline,
            direction=direction,
            riser_count=risers,
            from_elevation=z0,
            to_elevation=z1,
        )
    )


def _slope_mesh(
    vertices: np.ndarray,
    faces: np.ndarray,
    elevation: float,
    ceiling: float,
) -> tuple[list[tuple[float, float]], tuple[float, float], int, float, float] | None:
    tris = vertices[faces]
    edge_ab = tris[:, 1] - tris[:, 0]
    edge_ac = tris[:, 2] - tris[:, 0]
    normal = np.cross(edge_ab, edge_ac)
    length = np.linalg.norm(normal, axis=1)
    valid = length > 1e-8
    normal = normal[valid] / length[valid, None]
    tris = tris[valid]
    normal[normal[:, 2] < 0] *= -1
    angle = np.degrees(np.arccos(np.clip(normal[:, 2], -1.0, 1.0)))
    centroid_z = tris[:, :, 2].mean(axis=1)
    keep = (
        (angle >= 20.0)
        & (angle <= 45.0)
        & (centroid_z >= elevation - 0.05)
        & (centroid_z <= elevation + ceiling + 0.05)
    )
    if not np.any(keep):
        return None
    chosen = tris[keep]
    edges = np.cross(chosen[:, 1] - chosen[:, 0], chosen[:, 2] - chosen[:, 0])
    areas = 0.5 * np.linalg.norm(edges, axis=1)
    if float(areas.sum()) < 1.0:
        return None
    return _stair_from_triangles(chosen, normal[keep], areas, elevation)


def _slope_points(
    result: Normalized, draft: DraftLevel
) -> tuple[list[tuple[float, float]], tuple[float, float], int, float, float] | None:
    points = result.points
    normals = result.normals
    if len(points) < 30:
        return None
    normal = normals.copy()
    normal[normal[:, 2] < 0] *= -1
    angle = np.degrees(np.arccos(np.clip(normal[:, 2], -1.0, 1.0)))
    keep = (
        (angle >= 20.0)
        & (angle <= 45.0)
        & (points[:, 2] >= draft.elevation)
        & (points[:, 2] <= draft.elevation + draft.ceiling_height)
    )
    if int(keep.sum()) < 30:
        return None
    chosen = points[keep]
    hull = MultiPoint(chosen[:, :2]).convex_hull
    if hull.area < 1.0:
        return None
    horiz = normal[keep][:, :2]
    hlen = np.linalg.norm(horiz, axis=1)
    use = hlen > 1e-6
    if not np.any(use):
        return None
    uphill = -horiz[use] / hlen[use, None]
    direction = uphill.mean(axis=0)
    direction = direction / max(float(np.linalg.norm(direction)), 1e-8)
    outline = [(float(x), float(y)) for x, y in cast(Any, hull).exterior.coords[:-1]]
    z0 = float(chosen[:, 2].min()) - draft.elevation
    z1 = float(chosen[:, 2].max()) - draft.elevation
    risers = max(1, int(round((z1 - z0) / 0.18)))
    return outline, (float(direction[0]), float(direction[1])), risers, z0, z1


def _stair_from_triangles(
    tris: np.ndarray,
    normal: np.ndarray,
    areas: np.ndarray,
    elevation: float,
) -> tuple[list[tuple[float, float]], tuple[float, float], int, float, float] | None:
    xy = tris.reshape(-1, 3)[:, :2]
    hull = MultiPoint(xy).convex_hull
    if hull.is_empty or hull.area < 0.5:
        return None
    horiz = normal[:, :2]
    hlen = np.linalg.norm(horiz, axis=1)
    use = hlen > 1e-6
    uphill = -horiz[use] / hlen[use, None]
    weights = areas[use]
    direction = np.average(uphill, axis=0, weights=weights)
    direction = direction / max(float(np.linalg.norm(direction)), 1e-8)
    outline = [(float(x), float(y)) for x, y in list(cast(Any, hull).exterior.coords)[:-1]]
    if len(outline) < 3:
        return None
    z0 = float(tris[:, :, 2].min()) - elevation
    z1 = float(tris[:, :, 2].max()) - elevation
    risers = max(1, int(round(max(z1 - z0, 0.0) / 0.18)))
    return outline, (float(direction[0]), float(direction[1])), risers, max(0.0, z0), z1


def column_footprint(column: FoundColumn) -> Polygon:
    angle = math.radians(column.rotation_deg)
    ux, uy = math.cos(angle), math.sin(angle)
    vx, vy = -uy, ux
    hx, hy = column.width / 2.0, column.depth / 2.0
    cx, cy = column.x, column.y
    corners = [
        (cx + ux * hx + vx * hy, cy + uy * hx + vy * hy),
        (cx - ux * hx + vx * hy, cy - uy * hx + vy * hy),
        (cx - ux * hx - vx * hy, cy - uy * hx - vy * hy),
        (cx + ux * hx - vx * hy, cy + uy * hx - vy * hy),
    ]
    return Polygon(corners)


def point_on_wall(draft: DraftLevel, wall_id: str, offset: float) -> Point | None:
    verts = {vertex.id: vertex for vertex in draft.vertices}
    wall = next((item for item in draft.walls if item.id == wall_id), None)
    if wall is None:
        return None
    start = verts.get(wall.a)
    end = verts.get(wall.b)
    if start is None or end is None:
        return None
    return Point(start.x + (end.x - start.x) * offset, start.y + (end.y - start.y) * offset)
