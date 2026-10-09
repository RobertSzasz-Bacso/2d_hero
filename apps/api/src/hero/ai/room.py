"""Room outline from the scan, and a check that furniture stays inside it."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from shapely.geometry import Point, Polygon, box

from hero.pipeline.cells import DraftLevel, DraftRoom, DraftVertex, DraftWall
from hero.pipeline.normalize import Normalized
from hero.pipeline.planwrite import detect_structure, level_from_draft
from hero.pipeline.tolerances import assumed_exterior_m, endpoint_snap_m
from hero.schema import Level


@dataclass(frozen=True)
class RoomBounds:
    """Clear floor the furniture has to occupy."""

    polygon: Polygon
    width: float
    depth: float
    area: float
    min_x: float
    min_y: float
    max_x: float
    max_y: float


def measure_cloud(result: Normalized) -> tuple[Level, RoomBounds]:
    """Walls from the scan. A short model with no wall faces becomes one rectangle."""
    drafts, _surfaces = detect_structure(result)
    walled = next((draft for draft in drafts if draft.walls), None)
    if walled is not None:
        level = level_from_draft(walled)
        return level, bounds_of(level)
    if len(result.points) == 0:
        raise ValueError("The scan has no points.")
    draft, bounds = _rectangle(result)
    return level_from_draft(draft), bounds


def bounds_of(level: Level) -> RoomBounds:
    """Interior of a closed wall loop. The outline is the clear side of the walls."""
    from hero.planops.model import wrap
    from hero.planops.polygons import free_faces, wall_polygons
    from hero.schema import blank_plan

    plan = blank_plan("Room")
    plan.levels = [level]
    rings = free_faces(wall_polygons(wrap(plan.model_dump(mode="json")), level.id))
    polygons = [
        Polygon([(float(point["x"]), float(point["y"])) for point in ring])
        for ring in rings
        if len(ring) >= 3
    ]
    polygons = [polygon for polygon in polygons if polygon.area > 0]
    if not polygons:
        raise ValueError("The walls do not close a room.")
    interior = max(polygons, key=lambda polygon: polygon.area)
    return _bounds(interior)


def outside_messages(items: list[Any], bounds: RoomBounds) -> list[str]:
    """Name each object whose footprint crosses the room by more than a few centimetres."""
    allowed = bounds.polygon.buffer(endpoint_snap_m)
    messages: list[str] = []
    for item in items:
        if _inside(item, allowed):
            continue
        messages.append(
            f"The {item.symbol} at x={item.x:.2f} m, y={item.y:.2f} m, "
            f"{item.width:.2f} m by {item.depth:.2f} m, is outside the room."
        )
    return messages


def _rectangle(result: Normalized) -> tuple[DraftLevel, RoomBounds]:
    xy = result.points[:, :2]
    min_x, min_y = (float(value) for value in xy.min(axis=0))
    max_x, max_y = (float(value) for value in xy.max(axis=0))
    thickness = assumed_exterior_m
    outset = thickness / 2.0
    x0, y0 = min_x - outset, min_y - outset
    x1, y1 = max_x + outset, max_y + outset
    elevation = result.levels[0].elevation if result.levels else 0.0
    ceiling = result.levels[0].ceiling_height if result.levels else 2.7
    draft = DraftLevel(
        level_id="L1",
        elevation=elevation,
        ceiling_height=ceiling if ceiling > 1.5 else 2.7,
        vertices=[
            DraftVertex("v1", x0, y0),
            DraftVertex("v2", x1, y0),
            DraftVertex("v3", x1, y1),
            DraftVertex("v4", x0, y1),
        ],
        walls=[
            DraftWall("w1", "v1", "v2", thickness, "exterior", 0.4),
            DraftWall("w2", "v2", "v3", thickness, "exterior", 0.4),
            DraftWall("w3", "v3", "v4", thickness, "exterior", 0.4),
            DraftWall("w4", "v4", "v1", thickness, "exterior", 0.4),
        ],
        rooms=[
            DraftRoom(
                "r1",
                (min_x + max_x) / 2.0,
                (min_y + max_y) / 2.0,
                "Room",
                "1",
            )
        ],
    )
    return draft, _bounds(box(min_x, min_y, max_x, max_y))


def _bounds(interior: Polygon) -> RoomBounds:
    min_x, min_y, max_x, max_y = (float(value) for value in interior.bounds)
    return RoomBounds(
        polygon=interior,
        width=max_x - min_x,
        depth=max_y - min_y,
        area=float(interior.area),
        min_x=min_x,
        min_y=min_y,
        max_x=max_x,
        max_y=max_y,
    )


def _inside(item: Any, allowed: Polygon) -> bool:
    return all(allowed.covers(Point(x, y)) for x, y in _corners(item))


def _corners(item: Any) -> list[tuple[float, float]]:
    angle = math.radians(item.rotation_deg)
    cosine, sine = math.cos(angle), math.sin(angle)
    half_width = item.width / 2.0
    half_depth = item.depth / 2.0
    corners: list[tuple[float, float]] = []
    for local_x, local_y in (
        (-half_width, -half_depth),
        (half_width, -half_depth),
        (half_width, half_depth),
        (-half_width, half_depth),
    ):
        corners.append(
            (
                item.x + cosine * local_x - sine * local_y,
                item.y + sine * local_x + cosine * local_y,
            )
        )
    return corners
