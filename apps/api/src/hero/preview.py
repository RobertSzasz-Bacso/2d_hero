"""A lightweight mesh or point sample for the 3D view. Coordinates stay Z-up."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh

from hero.geometry import _align_z_up, _best_up_axis
from hero.pointcloud import _level_to_floor, _mesh_from_loaded, _points_from_loaded, _read_e57, _read_las


def build_preview(path: str | Path, limit: int = 20000) -> dict:
    source = Path(path)
    suffix = source.suffix.lower()
    if suffix == ".ifc":
        return _ifc_preview(source, limit)
    if suffix == ".usdz":
        from hero.usdz_extract import load_usdz_mesh

        return _mesh_payload(_align_mesh(load_usdz_mesh(source)), limit)
    if suffix in {".e57", ".las", ".laz"}:
        points = _read_e57(source) if suffix == ".e57" else _read_las(source)
        return _point_payload(_level_to_floor(np.asarray(points, dtype=float)), limit)
    if suffix == ".ply":
        loaded = trimesh.load(source, process=False)
        mesh = _mesh_from_loaded(loaded)
        if mesh is not None:
            return _mesh_payload(_align_mesh(mesh), limit)
        return _point_payload(_level_to_floor(_points_from_loaded(loaded)), limit)
    loaded = trimesh.load(source, force="mesh")
    if not isinstance(loaded, trimesh.Trimesh):
        raise ValueError("This file did not contain a mesh.")
    return _mesh_payload(_align_mesh(loaded), limit)


def _align_mesh(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    return _align_z_up(mesh, _best_up_axis(mesh))


def _mesh_payload(mesh: trimesh.Trimesh, limit: int) -> dict:
    vertices = np.asarray(mesh.vertices, dtype=float)
    faces = np.asarray(mesh.faces, dtype=int)
    if len(faces) > limit:
        chosen = np.linspace(0, len(faces) - 1, limit, dtype=int)
        faces = faces[chosen]
        used = np.unique(faces)
        remap = np.full(len(vertices), -1, dtype=int)
        remap[used] = np.arange(len(used))
        vertices = vertices[used]
        faces = remap[faces]
    return {
        "kind": "mesh",
        "positions": _round(vertices),
        "indices": faces.reshape(-1).astype(int).tolist(),
        "floor": float(vertices[:, 2].min()) if len(vertices) else 0.0,
        "ceiling": float(vertices[:, 2].max()) if len(vertices) else 1.0,
    }


def _point_payload(points: np.ndarray, limit: int) -> dict:
    cloud = np.asarray(points, dtype=float)
    if len(cloud) > limit:
        cloud = cloud[np.linspace(0, len(cloud) - 1, limit, dtype=int)]
    return {
        "kind": "points",
        "positions": _round(cloud),
        "indices": [],
        "floor": float(cloud[:, 2].min()) if len(cloud) else 0.0,
        "ceiling": float(cloud[:, 2].max()) if len(cloud) else 1.0,
    }


def _round(points: np.ndarray) -> list[float]:
    return [round(float(value), 4) for value in points.reshape(-1)]


def _ifc_preview(path: Path, limit: int) -> dict:
    import ifcopenshell
    import ifcopenshell.geom
    import ifcopenshell.util.unit

    model = ifcopenshell.open(str(path))
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    scale = float(ifcopenshell.util.unit.calculate_unit_scale(model))
    vertices: list[np.ndarray] = []
    faces: list[np.ndarray] = []
    offset = 0
    for wall in model.by_type("IfcWall"):
        try:
            shape = ifcopenshell.geom.create_shape(settings, wall)
        except RuntimeError:
            continue
        verts = np.array(shape.geometry.verts, dtype=float).reshape(-1, 3) * scale
        tris = np.array(shape.geometry.faces, dtype=int).reshape(-1, 3)
        if len(verts) == 0 or len(tris) == 0:
            continue
        vertices.append(verts)
        faces.append(tris + offset)
        offset += len(verts)
    if not vertices:
        return {"kind": "mesh", "positions": [], "indices": [], "floor": 0.0, "ceiling": 1.0}
    return _mesh_payload(trimesh.Trimesh(np.vstack(vertices), np.vstack(faces), process=False), limit)
