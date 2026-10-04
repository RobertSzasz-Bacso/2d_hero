"""Read a mesh out of a USDZ package and draft the same plan as an OBJ."""

from __future__ import annotations

import re
import zipfile
from pathlib import Path

import numpy as np
import trimesh

from hero.geometry import generate_from_trimesh
from hero.schema import Plan

_NUMBER = re.compile(r"[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?")


def generate_from_usdz(path: str | Path, slice_height: float = 1.2, gap_tolerance: float = 0.2) -> Plan:
    mesh = load_usdz_mesh(path)
    return generate_from_trimesh(mesh, slice_height=slice_height, gap_tolerance=gap_tolerance)


def load_usdz_mesh(path: str | Path) -> trimesh.Trimesh:
    package = Path(path)
    if not zipfile.is_zipfile(package):
        raise ValueError("This USDZ package could not be opened.")
    texts: list[str] = []
    saw_crate = False
    with zipfile.ZipFile(package) as archive:
        for name in archive.namelist():
            lowered = name.lower()
            if lowered.endswith(".usdc"):
                saw_crate = True
                continue
            if not lowered.endswith((".usda", ".usd")):
                continue
            raw = archive.read(name)
            if raw.startswith(b"PXR-USDC"):
                saw_crate = True
                continue
            texts.append(raw.decode("utf-8", errors="replace"))
    if not texts:
        if saw_crate:
            raise ValueError("This USDZ uses a binary USD crate. Export USDA or glTF instead.")
        raise ValueError("This USDZ did not contain a USD scene.")
    vertices: list[np.ndarray] = []
    faces: list[np.ndarray] = []
    for text in texts:
        scale = _meters_per_unit(text)
        for block in _mesh_blocks(text):
            points = _vector_array(block, "points")
            counts = _scalar_array(block, "faceVertexCounts")
            indices = _scalar_array(block, "faceVertexIndices")
            if points is None or counts is None or indices is None or len(points) < 9:
                continue
            coords = points.reshape(-1, 3) * scale
            coords = coords + _translate(block)
            tris = _triangulate(counts.astype(int), indices.astype(int))
            if len(tris) == 0:
                continue
            offset = sum(len(item) for item in vertices)
            vertices.append(coords)
            faces.append(tris + offset)
    if not vertices:
        raise ValueError("This USDZ did not contain a mesh.")
    return trimesh.Trimesh(np.vstack(vertices), np.vstack(faces), process=False)


def _meters_per_unit(text: str) -> float:
    match = re.search(r"metersPerUnit\s*=\s*([-+0-9.eE]+)", text)
    if not match:
        return 1.0
    return float(match.group(1))


def _mesh_blocks(text: str) -> list[str]:
    blocks: list[str] = []
    for match in re.finditer(r"\bdef\s+Mesh\b", text):
        brace = text.find("{", match.end())
        if brace < 0:
            continue
        blocks.append(text[brace + 1 : _matching_brace(text, brace)])
    return blocks


def _matching_brace(text: str, open_at: int) -> int:
    depth = 0
    for index in range(open_at, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
    return len(text)


def _array_body(block: str, name: str) -> str | None:
    match = re.search(rf"\b{name}\b\s*=\s*\[", block)
    if not match:
        return None
    start = match.end()
    end = block.find("]", start)
    if end < 0:
        return None
    return block[start:end]


def _vector_array(block: str, name: str) -> np.ndarray | None:
    body = _array_body(block, name)
    if body is None:
        return None
    numbers = [float(item) for item in _NUMBER.findall(body)]
    if len(numbers) < 3:
        return None
    usable = len(numbers) - (len(numbers) % 3)
    return np.array(numbers[:usable], dtype=float)


def _scalar_array(block: str, name: str) -> np.ndarray | None:
    body = _array_body(block, name)
    if body is None:
        return None
    numbers = [float(item) for item in _NUMBER.findall(body)]
    if not numbers:
        return None
    return np.array(numbers, dtype=float)


def _translate(block: str) -> np.ndarray:
    match = re.search(r"xformOp:translate\s*=\s*\(([^)]*)\)", block)
    if not match:
        return np.zeros(3)
    numbers = [float(item) for item in _NUMBER.findall(match.group(1))]
    if len(numbers) < 3:
        return np.zeros(3)
    return np.array(numbers[:3], dtype=float)


def _triangulate(counts: np.ndarray, indices: np.ndarray) -> np.ndarray:
    faces: list[tuple[int, int, int]] = []
    cursor = 0
    for count in counts:
        size = int(count)
        polygon = indices[cursor : cursor + size]
        cursor += size
        if size < 3:
            continue
        anchor = int(polygon[0])
        for index in range(1, size - 1):
            faces.append((anchor, int(polygon[index]), int(polygon[index + 1])))
    if not faces:
        return np.zeros((0, 3), dtype=int)
    return np.array(faces, dtype=int)
