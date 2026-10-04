"""Per-level underlay images. They are pictures, not geometry."""

import json

import numpy as np
from PIL import Image

from hero.atomic import atomic_write_bytes, atomic_write_text
from hero.pipeline.normalize import LevelSlice, Normalized

PIXEL_M = 0.02
MARGIN_M = 1.0
SECTION_M = 1.20
SECTION_BAND_M = 0.15


def write_underlays(folder, result: Normalized) -> list[dict[str, float | str]]:
    """Write a section PNG and a top-down density PNG for each level."""
    from pathlib import Path

    root = Path(folder) / "underlay"
    root.mkdir(parents=True, exist_ok=True)
    levels = list(result.levels)
    frames: list[dict[str, float | str]] = []
    for index, level in enumerate(levels):
        level_id = f"L{index + 1}"
        slab = _level_points(result.points, level)
        if len(slab) == 0:
            slab = result.points
        frame = _frame(slab if len(slab) else result.points)
        section_z = level.elevation + SECTION_M
        section = slab[np.abs(slab[:, 2] - section_z) <= SECTION_BAND_M] if len(slab) else slab
        _write_raster(root / f"{level_id}.png", section[:, :2] if len(section) else section, frame)
        _write_raster(root / f"{level_id}-density.png", slab[:, :2] if len(slab) else slab, frame)
        frames.append(
            {
                "id": level_id,
                "minX": frame[0],
                "minY": frame[1],
                "maxX": frame[2],
                "maxY": frame[3],
                "elevation": float(level.elevation),
                "ceilingHeight": float(level.ceiling_height),
            }
        )
    atomic_write_text(root / "frames.json", json.dumps({"levels": frames}) + "\n")
    return frames


def _level_points(points: np.ndarray, level: LevelSlice) -> np.ndarray:
    if len(points) == 0:
        return points
    low = level.elevation - 0.3
    high = level.elevation + level.ceiling_height + 0.3
    return points[(points[:, 2] >= low) & (points[:, 2] <= high)]


def _frame(points: np.ndarray) -> tuple[float, float, float, float]:
    if len(points) == 0:
        return (-MARGIN_M, -MARGIN_M, MARGIN_M, MARGIN_M)
    return (
        float(points[:, 0].min()) - MARGIN_M,
        float(points[:, 1].min()) - MARGIN_M,
        float(points[:, 0].max()) + MARGIN_M,
        float(points[:, 1].max()) + MARGIN_M,
    )


def _write_raster(path, xy: np.ndarray, frame: tuple[float, float, float, float]) -> None:
    min_x, min_y, max_x, max_y = frame
    width = max(32, int(np.ceil((max_x - min_x) / PIXEL_M)))
    height = max(32, int(np.ceil((max_y - min_y) / PIXEL_M)))
    width = min(width, 4096)
    height = min(height, 4096)
    image = np.zeros((height, width, 4), dtype=np.uint8)
    if len(xy):
        cols = np.floor((xy[:, 0] - min_x) / PIXEL_M).astype(np.int32)
        rows = np.floor((max_y - xy[:, 1]) / PIXEL_M).astype(np.int32)
        keep = (cols >= 0) & (cols < width) & (rows >= 0) & (rows < height)
        image[rows[keep], cols[keep]] = (30, 41, 59, 255)
    buffer = _png_bytes(image)
    atomic_write_bytes(path, buffer)


def _png_bytes(image: np.ndarray) -> bytes:
    import io

    handle = io.BytesIO()
    Image.fromarray(image, mode="RGBA").save(handle, format="PNG")
    return handle.getvalue()
