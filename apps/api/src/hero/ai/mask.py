"""Decode the flat-color furniture mask returned by the vision step."""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from typing import Any, cast

import cv2
import numpy as np
from PIL import Image
from shapely.geometry import Point

from hero.ai.room import RoomBounds

MASK_PALETTE: dict[str, tuple[int, int, int]] = {
    "outside": (0, 0, 0),
    "floor": (238, 238, 238),
    "toilet": (220, 60, 60),
    "sink": (60, 180, 75),
    "bathtub": (50, 100, 220),
    "shower": (40, 200, 200),
    "kitchen-counter": (220, 170, 40),
    "stove": (240, 120, 30),
    "bed-double": (150, 70, 200),
    "sofa": (220, 70, 160),
    "table": (150, 90, 40),
    "wardrobe": (30, 160, 160),
    "block": (100, 100, 100),
    "chair": (200, 120, 200),
}

_SYMBOLS = tuple(name for name in MASK_PALETTE if name not in {"outside", "floor"})
_COLOUR_TOLERANCE = 100.0
_WALL_SNAP_M = 0.15
_PARALLEL_SIN = math.sin(math.radians(12.0))


@dataclass(frozen=True)
class MaskFrame:
    """World vectors covered by one mask image.

    ``origin`` is the image's bottom-left world point. ``x_axis`` and
    ``y_axis`` are the world vectors from the bottom-left to the bottom-right
    and top-left respectively.
    """

    origin: tuple[float, float]
    x_axis: tuple[float, float]
    y_axis: tuple[float, float]


@dataclass(frozen=True)
class MaskFixture:
    symbol: str
    x: float
    y: float
    rotation_deg: float
    width: float
    depth: float
    confidence: float
    role: str


def decode_mask(png: bytes, frame: MaskFrame, bounds: RoomBounds) -> list[MaskFixture]:
    """Turn a flat-color PNG into metric fixture boxes.

    The image is deliberately decoded by nearest palette colour rather than
    exact RGB equality. Image generation commonly antialiases the edges of a
    filled region.
    """

    image = _read_rgb(png)
    height, width, _channels = image.shape
    palette_names = tuple(MASK_PALETTE)
    palette = np.asarray([MASK_PALETTE[name] for name in palette_names], dtype=np.float32)
    distances = np.linalg.norm(
        image.astype(np.float32)[:, :, None, :] - palette[None, None, :, :],
        axis=3,
    )
    nearest = distances.argmin(axis=2)
    nearest_distance = distances.min(axis=2)
    floor_index = palette_names.index("floor")
    floor = (nearest == floor_index) & (nearest_distance <= _COLOUR_TOLERANCE)
    if int(floor.sum()) < max(10, int(width * height * 0.01)):
        raise ValueError("The Cursor mask has no recognizable floor region.")
    floor_pixels = np.argwhere(floor)
    floor_y_min, floor_x_min = floor_pixels.min(axis=0)
    floor_y_max, floor_x_max = floor_pixels.max(axis=0)
    floor_window = (
        float(floor_x_min),
        float(floor_x_max),
        float(floor_y_min),
        float(floor_y_max),
    )

    result: list[MaskFixture] = []
    cv2_any = cast(Any, cv2)
    for symbol in _SYMBOLS:
        symbol_index = palette_names.index(symbol)
        pixels = ((nearest == symbol_index) & (nearest_distance <= _COLOUR_TOLERANCE)).astype(
            np.uint8
        )
        pixels = cv2.morphologyEx(pixels, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        count, labels, stats, _centroids = cv2_any.connectedComponentsWithStats(pixels, 8)
        minimum_area = max(12, int(width * height * 0.00015))
        for label in range(1, count):
            if int(stats[label, cv2.CC_STAT_AREA]) < minimum_area:
                continue
            component = np.where(labels == label, 255, 0).astype(np.uint8)
            contours, _hierarchy = cv2.findContours(
                component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            if not contours:
                continue
            contour = max(contours, key=cv2.contourArea)
            if cv2.contourArea(contour) < minimum_area:
                continue
            result.append(
                _fixture_from_contour(
                    symbol,
                    contour,
                    width,
                    height,
                    frame,
                    bounds,
                    floor_window,
                )
            )
    return result


def _read_rgb(png: bytes) -> np.ndarray:
    try:
        with Image.open(io.BytesIO(png)) as image:
            return np.asarray(image.convert("RGB"), dtype=np.uint8)
    except (OSError, ValueError) as exc:
        raise ValueError("The Cursor mask is not a readable image.") from exc


def _fixture_from_contour(
    symbol: str,
    contour: np.ndarray,
    image_width: int,
    image_height: int,
    frame: MaskFrame,
    bounds: RoomBounds,
    floor_window: tuple[float, float, float, float],
) -> MaskFixture:
    rectangle = cv2.minAreaRect(contour)
    corners = cv2.boxPoints(rectangle).astype(np.float64)
    world = np.asarray(
        [
            _world_at(
                float(x),
                float(y),
                image_width,
                image_height,
                frame,
                bounds,
                floor_window,
            )
            for x, y in corners
        ]
    )
    edges = np.roll(world, -1, axis=0) - world
    lengths = np.linalg.norm(edges, axis=1)
    width_edge = int(np.argmax(np.abs(edges[:, 0]) + 0.001 * lengths))
    depth_edge = (width_edge + 1) % 4
    width_m = float(lengths[width_edge])
    depth_m = float(lengths[depth_edge])
    centre = world.mean(axis=0)
    rotation = math.degrees(math.atan2(edges[width_edge, 1], edges[width_edge, 0]))
    if rotation < -90.0:
        rotation += 180.0
    if rotation >= 90.0:
        rotation -= 180.0
    fixture = MaskFixture(
        symbol=symbol,
        x=float(centre[0]),
        y=float(centre[1]),
        rotation_deg=float(rotation),
        width=width_m,
        depth=depth_m,
        confidence=0.8,
        role="fixture"
        if symbol in {"toilet", "sink", "bathtub", "shower", "kitchen-counter", "stove"}
        else "furniture",
    )
    return _snap_to_wall(fixture, bounds)


def _world_at(
    pixel_x: float,
    pixel_y: float,
    image_width: int,
    image_height: int,
    frame: MaskFrame,
    bounds: RoomBounds,
    floor_window: tuple[float, float, float, float],
) -> np.ndarray:
    floor_x_min, floor_x_max, floor_y_min, floor_y_max = floor_window
    floor_width = max(1.0, floor_x_max - floor_x_min)
    floor_height = max(1.0, floor_y_max - floor_y_min)
    u = (pixel_x - floor_x_min) / floor_width
    v = 1.0 - (pixel_y - floor_y_min) / floor_height
    return np.asarray(
        (bounds.min_x + u * bounds.width, bounds.min_y + v * bounds.depth),
        dtype=np.float64,
    )


def _snap_to_wall(item: MaskFixture, bounds: RoomBounds) -> MaskFixture:
    corners = _corners(item)
    best: tuple[float, float, float] | None = None
    boundary = list(bounds.polygon.exterior.coords)
    for start, end in zip(boundary, boundary[1:]):
        wall = np.asarray(end, dtype=np.float64) - np.asarray(start, dtype=np.float64)
        wall_length = float(np.linalg.norm(wall))
        if wall_length <= 1e-9:
            continue
        direction = wall / wall_length
        normal = np.asarray((-direction[1], direction[0]), dtype=np.float64)
        for index in range(4):
            edge = corners[(index + 1) % 4] - corners[index]
            edge_length = float(np.linalg.norm(edge))
            if edge_length <= 1e-9:
                continue
            edge_direction = edge / edge_length
            cross = float(direction[0] * edge_direction[1] - direction[1] * edge_direction[0])
            if abs(cross) > _PARALLEL_SIN:
                continue
            gap = float(np.dot((corners[index] + corners[(index + 1) % 4]) / 2.0 - start, normal))
            if not 0.0 <= gap <= _WALL_SNAP_M:
                continue
            delta = -normal * gap
            shifted = [
                (float(point[0] + delta[0]), float(point[1] + delta[1]))
                for point in corners
            ]
            if not all(bounds.polygon.buffer(1e-7).covers(Point(point)) for point in shifted):
                continue
            score = (gap, wall_length, float(index))
            if best is None or score < best:
                best = score
                snapped = delta
    if best is None:
        return item
    return MaskFixture(
        symbol=item.symbol,
        x=item.x + float(snapped[0]),
        y=item.y + float(snapped[1]),
        rotation_deg=item.rotation_deg,
        width=item.width,
        depth=item.depth,
        confidence=item.confidence,
        role=item.role,
    )


def _corners(item: MaskFixture) -> list[np.ndarray]:
    angle = math.radians(item.rotation_deg)
    cosine, sine = math.cos(angle), math.sin(angle)
    result = []
    for local_x, local_y in (
        (-item.width / 2.0, -item.depth / 2.0),
        (item.width / 2.0, -item.depth / 2.0),
        (item.width / 2.0, item.depth / 2.0),
        (-item.width / 2.0, item.depth / 2.0),
    ):
        result.append(
            np.asarray(
                (
                    item.x + cosine * local_x - sine * local_y,
                    item.y + sine * local_x + cosine * local_y,
                ),
                dtype=np.float64,
            )
        )
    return result
