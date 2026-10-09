"""Colored top-down picture of a Z-up point preview."""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from hero.pipeline.preview import POINT_MAGIC


@dataclass(frozen=True)
class TopFrame:
    """World rectangle covered by the picture. Y increases toward the top edge."""

    min_x: float
    min_y: float
    max_x: float
    max_y: float


def read_point_preview(path: Path) -> tuple[np.ndarray, np.ndarray | None]:
    """Read a HEROPTS preview. Flags 1 carries uint8 RGB after the positions."""
    payload = path.read_bytes()
    if len(payload) < 16 or payload[:8] != POINT_MAGIC:
        raise ValueError("The 3D preview could not be read.")
    count = int(np.frombuffer(payload, dtype=np.uint32, count=1, offset=8)[0])
    flags = int(np.frombuffer(payload, dtype=np.uint32, count=1, offset=12)[0])
    points = np.frombuffer(payload, dtype=np.float32, count=count * 3, offset=16).reshape(count, 3)
    colors = None
    if flags & 1:
        offset = 16 + count * 12
        colors = np.frombuffer(payload, dtype=np.uint8, count=count * 3, offset=offset).reshape(
            count, 3
        )
    return np.array(points, copy=True), None if colors is None else np.array(colors, copy=True)


def render_top_view(
    points: np.ndarray, colors: np.ndarray | None, *, size: int = 768
) -> tuple[bytes, TopFrame]:
    """Draw the plan view. Picture X is plan X. Picture top is plan +Y."""
    if len(points) == 0:
        raise ValueError("The 3D preview has no points.")
    xy = np.asarray(points, dtype=np.float64)[:, :2]
    low = xy.min(axis=0)
    high = xy.max(axis=0)
    span = max(float(high[0] - low[0]), float(high[1] - low[1]), 1.0)
    pad = span * 0.08
    center_x = (float(low[0]) + float(high[0])) / 2.0
    center_y = (float(low[1]) + float(high[1])) / 2.0
    half = span / 2.0 + pad
    frame = TopFrame(center_x - half, center_y - half, center_x + half, center_y + half)
    width = frame.max_x - frame.min_x
    height = frame.max_y - frame.min_y
    columns = np.clip(((xy[:, 0] - frame.min_x) / width) * (size - 1), 0, size - 1).astype(np.int32)
    rows = np.clip(((frame.max_y - xy[:, 1]) / height) * (size - 1), 0, size - 1).astype(np.int32)
    if colors is None or len(colors) != len(points):
        paint = np.full((len(points), 3), 140, dtype=np.uint8)
    else:
        paint = np.asarray(colors, dtype=np.uint8)[:, :3]
    canvas = np.full((size, size, 3), 255, dtype=np.uint8)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            placed_rows = np.clip(rows + dy, 0, size - 1)
            placed_columns = np.clip(columns + dx, 0, size - 1)
            canvas[placed_rows, placed_columns] = paint
    buffer = io.BytesIO()
    Image.fromarray(canvas, mode="RGB").save(buffer, format="PNG")
    return buffer.getvalue(), frame
