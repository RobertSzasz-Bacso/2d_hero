"""Readers for the formats in docs/algorithms.md. LAS stays a generator."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import numpy as np

from hero.ingest.scene import RawScene


def read_source(path: Path) -> RawScene:
    """Open one supported file. Mesh formats are sampled onto their faces."""
    suffix = path.suffix.lower()
    if suffix in {".las", ".laz"}:
        return RawScene(None, None, lambda: iter_las_chunks(path), None, suffix[1:])
    if suffix == ".e57":
        points = _read_e57(path)
        return RawScene(points, None, None, None, "e57")
    if suffix in {".usd", ".usda", ".usdc", ".usdz"}:
        points, normals, scale = _read_usd(path)
        return RawScene(points, normals, None, scale, "usdz")
    if suffix == ".ifc":
        vertices, faces = _read_ifc(path)
        points, normals = sample_mesh(vertices, faces, _mesh_step(vertices))
        return _scene(points, normals, None, "ifc", vertices, faces)
    vertices, faces, colors = _read_trimesh(path)
    if len(faces):
        points, normals = sample_mesh(vertices, faces, _mesh_step(vertices))
        colors = None
    else:
        points, normals = vertices, None
    return _scene(points, normals, None, suffix[1:], vertices, faces, colors)


def _scene(
    points: np.ndarray,
    normals: np.ndarray | None,
    scale: float | None,
    source_format: str,
    vertices: np.ndarray,
    faces: np.ndarray,
    colors: np.ndarray | None = None,
) -> RawScene:
    mesh_vertices = None
    mesh_faces = None
    if len(faces):
        mesh_vertices = np.asarray(vertices, dtype=np.float64)
        mesh_faces = np.asarray(faces, dtype=np.int64)
    return RawScene(points, normals, None, scale, source_format, mesh_vertices, mesh_faces, colors)


def iter_las_chunks(path: Path, points_per_iteration: int = 250_000) -> Iterator[np.ndarray]:
    """Yield XYZ chunks. Never assemble the whole cloud."""
    import laspy

    with laspy.open(path) as reader:
        for chunk in reader.chunk_iterator(points_per_iteration):
            yield np.column_stack(
                (
                    np.asarray(chunk.x, dtype=np.float64),
                    np.asarray(chunk.y, dtype=np.float64),
                    np.asarray(chunk.z, dtype=np.float64),
                )
            )


def _mesh_step(vertices: np.ndarray) -> float:
    """0.05 m, expressed in the file's own units when the span is not metres."""
    if len(vertices) == 0:
        return 0.05
    span = float(np.ptp(vertices[:, :2], axis=0).max())
    if span > 200:
        return 50.0
    if span > 50:
        return 5.0
    return 0.05


def sample_mesh(
    vertices: np.ndarray, faces: np.ndarray, step: float
) -> tuple[np.ndarray, np.ndarray]:
    """Area samples with the face normal. Vectorized per triangle."""
    points: list[np.ndarray] = []
    normals: list[np.ndarray] = []
    for face in faces:
        tri = vertices[face]
        edge_ab = tri[1] - tri[0]
        edge_ac = tri[2] - tri[0]
        normal = np.cross(edge_ab, edge_ac)
        length = float(np.linalg.norm(normal))
        if length < 1e-10:
            continue
        normal = normal / length
        span = max(
            float(np.linalg.norm(edge_ab)),
            float(np.linalg.norm(edge_ac)),
            float(np.linalg.norm(tri[2] - tri[1])),
        )
        count = min(400, max(1, int(np.ceil(span / step))))
        grid = np.arange(count + 1)
        uu, vv = np.meshgrid(grid, grid, indexing="ij")
        mask = uu + vv <= count
        bary_u = uu[mask] / count
        bary_v = vv[mask] / count
        samples = tri[0] + bary_u[:, None] * edge_ab + bary_v[:, None] * edge_ac
        points.append(samples)
        normals.append(np.repeat(normal[None, :], len(samples), axis=0))
    if not points:
        empty = np.zeros((0, 3))
        return empty, empty
    return np.vstack(points), np.vstack(normals)


def _read_trimesh(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray | None]:
    import trimesh

    loaded = cast(Any, trimesh.load(path, force="mesh", process=False))
    vertices = np.asarray(loaded.vertices, dtype=np.float64)
    if hasattr(loaded, "faces"):
        faces = np.asarray(loaded.faces, dtype=np.int64)
    else:
        faces = np.zeros((0, 3), dtype=np.int64)
    if len(vertices) == 0 and len(faces) == 0:
        scene = cast(Any, trimesh.load(path, process=False))
        cloud = _point_cloud_vertices(scene)
        if cloud is not None:
            points, colors = cloud
            return points, np.zeros((0, 3), dtype=np.int64), colors
    return vertices, faces, None


def _point_cloud_vertices(loaded: Any) -> tuple[np.ndarray, np.ndarray | None] | None:
    """World-space points, and RGB when every point has a color."""
    import trimesh

    if isinstance(loaded, trimesh.Scene):
        geometries = list(loaded.geometry.values())
        if not geometries or any(_face_count(geom) > 0 for geom in geometries):
            return None
        blocks: list[np.ndarray] = []
        color_blocks: list[np.ndarray] = []
        colored = True
        for node in loaded.graph.nodes_geometry:
            transform, name = loaded.graph[node]
            if name is None or name not in loaded.geometry:
                continue
            geom = loaded.geometry[name]
            raw = getattr(geom, "vertices", None)
            if raw is None or len(raw) == 0 or _face_count(geom) > 0:
                continue
            points = np.asarray(trimesh.transform_points(raw, transform), dtype=np.float64)
            blocks.append(points)
            rgb = _rgb_colors(geom, len(points))
            if rgb is None:
                colored = False
            else:
                color_blocks.append(rgb)
        if not blocks:
            return None
        colors = np.vstack(color_blocks) if colored and color_blocks else None
        return np.vstack(blocks), colors
    raw = getattr(loaded, "vertices", None)
    if raw is None or len(raw) == 0 or _face_count(loaded) > 0:
        return None
    points = np.asarray(raw, dtype=np.float64)
    return points, _rgb_colors(loaded, len(points))


def _rgb_colors(geom: Any, count: int) -> np.ndarray | None:
    """RGB bytes from a point cloud. Float colors in 0..1 are scaled to 0..255."""
    colors = getattr(geom, "colors", None)
    if colors is None:
        return None
    array = np.asarray(colors)
    if array.ndim != 2 or len(array) != count or array.shape[1] < 3:
        return None
    source = array[:, :3]
    rgb = np.asarray(source, dtype=np.float64)
    if np.issubdtype(source.dtype, np.floating) and float(np.max(rgb)) <= 1.0:
        rgb = np.round(rgb * 255.0)
    return np.clip(np.rint(rgb), 0, 255).astype(np.uint8)


def _face_count(geom: Any) -> int:
    faces = getattr(geom, "faces", None)
    if faces is None:
        return 0
    return len(faces)


def _read_e57(path: Path) -> np.ndarray:
    from pye57 import E57

    blocks: list[np.ndarray] = []
    with E57(str(path), mode="r") as handle:
        for index in range(handle.scan_count):
            try:
                data = handle.read_scan(index, transform=True, ignore_missing_fields=True)
            except Exception:
                continue
            if "cartesianX" not in data:
                continue
            block = np.column_stack(
                (
                    np.asarray(data["cartesianX"], dtype=np.float64),
                    np.asarray(data["cartesianY"], dtype=np.float64),
                    np.asarray(data["cartesianZ"], dtype=np.float64),
                )
            )
            if len(block):
                blocks.append(block)
    if not blocks:
        return np.zeros((0, 3))
    return np.vstack(blocks)


def _read_usd(path: Path) -> tuple[np.ndarray, np.ndarray, float]:
    from pxr import Usd, UsdGeom

    usd = cast(Any, Usd)
    geom = cast(Any, UsdGeom)
    stage = usd.Stage.Open(str(path))
    if stage is None:
        raise ValueError(f"Could not open {path.name}.")
    scale = float(geom.GetStageMetersPerUnit(stage))
    points: list[np.ndarray] = []
    normals: list[np.ndarray] = []
    for prim in stage.Traverse():
        if not prim.IsA(geom.Mesh):
            continue
        mesh = geom.Mesh(prim)
        raw = mesh.GetPointsAttr().Get()
        counts = mesh.GetFaceVertexCountsAttr().Get()
        indices = mesh.GetFaceVertexIndicesAttr().Get()
        if not raw or not counts or not indices:
            continue
        local = np.array([[point[0], point[1], point[2]] for point in raw], dtype=np.float64)
        transform = geom.Xformable(prim).ComputeLocalToWorldTransform(usd.TimeCode.Default())
        matrix = np.array(transform).reshape(4, 4)
        # GfMatrix4d is row-major. Translation lives in the last row.
        rotation = matrix[:3, :3]
        translation = matrix[3, :3]
        world = local @ rotation + translation
        faces = _usd_faces(counts, indices)
        sampled, face_normals = sample_mesh(world, faces, _mesh_step(world))
        if len(sampled):
            points.append(sampled)
            normals.append(face_normals)
    if not points:
        return np.zeros((0, 3)), np.zeros((0, 3)), scale
    return np.vstack(points), np.vstack(normals), scale


def _usd_faces(counts: list[int], indices: list[int]) -> np.ndarray:
    faces: list[list[int]] = []
    cursor = 0
    for count in counts:
        polygon = list(indices[cursor : cursor + count])
        cursor += count
        for index in range(1, len(polygon) - 1):
            faces.append([polygon[0], polygon[index], polygon[index + 1]])
    if not faces:
        return np.zeros((0, 3), dtype=np.int64)
    return np.asarray(faces, dtype=np.int64)


def _read_ifc(path: Path) -> tuple[np.ndarray, np.ndarray]:
    import ifcopenshell
    import ifcopenshell.geom
    import ifcopenshell.util.unit

    model = ifcopenshell.open(str(path))
    scale = float(ifcopenshell.util.unit.calculate_unit_scale(model))
    if scale <= 0:
        scale = 1.0
    geometry = cast(Any, ifcopenshell.geom)
    settings = geometry.settings()
    settings.set("USE_WORLD_COORDS", True)
    vertices: list[np.ndarray] = []
    faces: list[np.ndarray] = []
    offset = 0
    for product in model.by_type("IfcProduct"):
        if not product.Representation:
            continue
        try:
            shape = geometry.create_shape(settings, product)
        except Exception:
            continue
        verts = np.asarray(shape.geometry.verts, dtype=np.float64).reshape(-1, 3) * scale
        tris = np.asarray(shape.geometry.faces, dtype=np.int64).reshape(-1, 3)
        if len(verts) == 0 or len(tris) == 0:
            continue
        vertices.append(verts)
        faces.append(tris + offset)
        offset += len(verts)
    if not vertices:
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)
    return np.vstack(vertices), np.vstack(faces)
