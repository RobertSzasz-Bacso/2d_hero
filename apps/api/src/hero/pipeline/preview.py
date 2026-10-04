"""Decimated mesh or capped point preview. Never a JSON array of coordinates."""

from pathlib import Path
from typing import Any, cast

import numpy as np

from hero.atomic import atomic_write_bytes
from hero.pipeline.normalize import Normalized

TRIANGLE_CAP = 200_000
POINT_CAP = 500_000
POINT_MAGIC = b"HEROPTS\x00"


def write_preview(source: Path, folder: Path, result: Normalized) -> Path:
    """Write ``preview.glb`` when the source is a mesh, otherwise ``preview.pts``."""
    mesh = _load_mesh(source, result.unit_scale)
    if mesh is not None:
        path = folder / "preview.glb"
        payload = cast(Any, mesh).export(file_type="glb")
        if not isinstance(payload, bytes):
            raise TypeError("GLB export did not return bytes.")
        atomic_write_bytes(path, payload)
        points = folder / "preview.pts"
        if points.is_file():
            points.unlink()
        return path
    path = folder / "preview.pts"
    atomic_write_bytes(path, _point_blob(result.points))
    return path


def _load_mesh(source: Path, unit_scale: float):
    import trimesh

    try:
        loaded = trimesh.load(source, force="mesh", process=False)
    except Exception:
        return None
    faces = getattr(loaded, "faces", None)
    vertices = getattr(loaded, "vertices", None)
    if faces is None or vertices is None or len(faces) == 0:
        return None
    mesh = loaded
    if len(faces) > TRIANGLE_CAP:
        mesh = _decimate(np.asarray(vertices), np.asarray(faces))
    if unit_scale != 1.0:
        mesh.apply_scale(unit_scale)
    return mesh


def _decimate(vertices: np.ndarray, faces: np.ndarray):
    """Open3D quadric decimation. trimesh's wrapper needs an extra package."""
    import open3d as o3d
    import trimesh

    triangle = o3d.geometry.TriangleMesh(
        o3d.utility.Vector3dVector(np.ascontiguousarray(vertices, dtype=np.float64)),
        o3d.utility.Vector3iVector(np.ascontiguousarray(faces, dtype=np.int32)),
    )
    simple = triangle.simplify_quadric_decimation(target_number_of_triangles=TRIANGLE_CAP)
    return trimesh.Trimesh(
        np.asarray(simple.vertices),
        np.asarray(simple.triangles),
        process=False,
    )


def _point_blob(points: np.ndarray) -> bytes:
    if len(points) > POINT_CAP:
        step = int(np.ceil(len(points) / POINT_CAP))
        chosen = points[::step][:POINT_CAP]
    else:
        chosen = points
    cloud = np.ascontiguousarray(chosen, dtype=np.float32)
    header = POINT_MAGIC + np.uint32(len(cloud)).tobytes() + np.uint32(0).tobytes()
    return header + cloud.tobytes()
