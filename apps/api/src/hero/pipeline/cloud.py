"""Normalized cloud on disk. Points stay binary, never a JSON array."""

import json
import os
from pathlib import Path

import numpy as np

from hero.pipeline.normalize import Normalized

MAGIC = b"HEROCLOUD"


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
