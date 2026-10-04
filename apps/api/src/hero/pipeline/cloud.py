"""Normalized cloud on disk. Points stay binary, never a JSON array."""

import json
import os
from pathlib import Path

import numpy as np

from hero.pipeline.normalize import LevelSlice, Normalized

MAGIC = b"HEROCLOUD"


def read_cloud(path: Path) -> Normalized:
    """Load a cloud written by ``write_cloud``."""
    blob = path.read_bytes()
    if not blob.startswith(MAGIC):
        raise ValueError("Cloud file is not a HEROCLOUD.")
    length = int.from_bytes(blob[len(MAGIC) : len(MAGIC) + 4], "little")
    start = len(MAGIC) + 4
    meta = json.loads(blob[start : start + length])
    count = int(meta["count"])
    payload = blob[start + length :]
    points = np.frombuffer(payload[: count * 12], dtype=np.float32).reshape(count, 3).copy()
    normal_bytes = payload[count * 12 : count * 24]
    normals = np.frombuffer(normal_bytes, dtype=np.float32).reshape(count, 3).copy()
    levels = [
        LevelSlice(
            elevation=float(level["elevation"]),
            ceiling_height=float(level["ceilingHeight"]),
        )
        for level in meta.get("levels", [])
    ]
    up = np.asarray(meta.get("estimatedUp", [0.0, 0.0, 1.0]), dtype=np.float64)
    return Normalized(
        points.astype(np.float64),
        normals.astype(np.float64),
        float(meta.get("unitScale", 1.0)),
        float(meta.get("voxel", 0.02)),
        up,
        levels,
        float(meta.get("manhattanAngleDeg", 0.0)),
        list(meta.get("issues", [])),
    )


def write_cloud(path: Path, result: Normalized) -> None:
    """Write one cloud. The header is JSON metadata; the points are float32."""
    meta = {
        "unitScale": result.unit_scale,
        "voxel": result.voxel,
        "manhattanAngleDeg": result.manhattan_angle_deg,
        "estimatedUp": [float(value) for value in result.estimated_up],
        "levels": [
            {"elevation": level.elevation, "ceilingHeight": level.ceiling_height}
            for level in result.levels
        ],
        "issues": result.issues,
        "count": int(len(result.points)),
    }
    payload = json.dumps(meta, ensure_ascii=False).encode("utf-8")
    points = np.ascontiguousarray(result.points, dtype=np.float32)
    normals = np.ascontiguousarray(result.normals, dtype=np.float32)
    blob = b"".join(
        (
            MAGIC,
            len(payload).to_bytes(4, "little"),
            payload,
            points.tobytes(),
            normals.tobytes(),
        )
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_bytes(blob)
    os.replace(temporary, path)
