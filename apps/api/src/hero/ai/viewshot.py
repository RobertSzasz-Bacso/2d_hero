"""Map a pixel in the user's 3D screenshot onto the floor plan."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

_BACK_STEP = {
    "up": (0.0, -1.0),
    "down": (0.0, 1.0),
    "left": (-1.0, 0.0),
    "right": (1.0, 0.0),
}


@dataclass(frozen=True)
class ViewShot:
    """Three.js camera matrices. Arrays are column-major, matching ``Matrix4.toArray``."""

    projection: tuple[float, ...]
    matrix_world: tuple[float, ...]
    floor_z: float

    def __post_init__(self) -> None:
        if len(self.projection) != 16 or len(self.matrix_world) != 16:
            raise ValueError("A camera matrix needs 16 numbers.")


def plan_xy(nx: float, ny: float, shot: ViewShot) -> tuple[float, float] | None:
    """Floor position under one image pixel. nx is left to right. ny is top to bottom."""
    near = _unproject(nx * 2.0 - 1.0, 1.0 - ny * 2.0, -1.0, shot)
    far = _unproject(nx * 2.0 - 1.0, 1.0 - ny * 2.0, 1.0, shot)
    direction = far - near
    if abs(float(direction[2])) < 1e-8:
        return None
    distance = (shot.floor_z - float(near[2])) / float(direction[2])
    if distance < 0:
        return None
    point = near + distance * direction
    camera = _matrix(shot.matrix_world)[:3, 3]
    if float(np.hypot(point[0] - camera[0], point[1] - camera[1])) > 80.0:
        return None
    return float(point[0]), float(point[1])


def fixture_pose(
    nx: float,
    ny: float,
    span_x: float,
    span_y: float,
    back: str,
    shot: ViewShot,
) -> tuple[float, float, float, float, float] | None:
    """Plan pose from the picture. ``back`` is up, down, left, or right in the picture.

    Width runs across the back. Depth runs from the back to the front.
    """
    center = plan_xy(nx, ny, shot)
    step = _BACK_STEP.get(back)
    if center is None or step is None or span_x <= 0 or span_y <= 0:
        return None
    sample = 0.02
    along_x = _offset(nx, ny, sample * step[0], sample * step[1], shot)
    across_x = _offset(nx, ny, sample * step[1], sample * step[0], shot)
    if along_x is None or across_x is None:
        return None
    along = (along_x[0] - center[0], along_x[1] - center[1])
    across = (across_x[0] - center[0], across_x[1] - center[1])
    along_span = span_y if step[1] else span_x
    across_span = span_x if step[1] else span_y
    depth = _length(along) / sample * along_span
    width = _length(across) / sample * across_span
    if depth <= 0 or width <= 0:
        return None
    rotation = math.degrees(math.atan2(-along[0], along[1]))
    quarter = int((rotation % 360.0) / 90.0 + 0.5) * 90
    return center[0], center[1], float(quarter % 360), width, depth


def _offset(
    nx: float, ny: float, du: float, dv: float, shot: ViewShot
) -> tuple[float, float] | None:
    return plan_xy(nx + du, ny + dv, shot)


def _length(vector: tuple[float, float]) -> float:
    return float(math.hypot(vector[0], vector[1]))


def _unproject(ndc_x: float, ndc_y: float, ndc_z: float, shot: ViewShot) -> np.ndarray:
    clip = np.array([ndc_x, ndc_y, ndc_z, 1.0], dtype=np.float64)
    eye = np.linalg.inv(_matrix(shot.projection)) @ clip
    eye /= eye[3]
    world = _matrix(shot.matrix_world) @ eye
    world /= world[3]
    return world[:3]


def _matrix(elements: tuple[float, ...]) -> np.ndarray:
    return np.array(elements, dtype=np.float64).reshape((4, 4), order="F")
