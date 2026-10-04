"""Pull wall centerlines out of an IFC model, in meters."""

from __future__ import annotations

from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.unit
import numpy as np

from hero.geometry import _segments_to_plan
from hero.schema import Plan


def generate_from_ifc(path: str | Path) -> Plan:
    model = ifcopenshell.open(str(path))
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    scale = float(ifcopenshell.util.unit.calculate_unit_scale(model))
    walls = list(model.by_type("IfcWall"))
    grouped: dict[int, list] = {}
    for wall in walls:
        container = ifcopenshell.util.element.get_container(wall)
        key = int(container.id()) if container is not None else 0
        grouped.setdefault(key, []).append(wall)
    if not grouped:
        return Plan()

    def footprint_area(wall) -> float:
        vertices = _vertices(settings, wall, scale)
        if vertices is None:
            return 0.0
        span = vertices.max(axis=0) - vertices.min(axis=0)
        return float(max(span[0], span[1]) * span[2])

    chosen = max(grouped.values(), key=lambda group: sum(footprint_area(wall) for wall in group))
    segments = []
    for wall in chosen:
        vertices = _vertices(settings, wall, scale)
        if vertices is None:
            continue
        segments.append(_centerline(vertices))
    # Keep a corner gap caused by wall thickness from fusing two walls into one.
    return _segments_to_plan(segments, gap_tolerance=0.05)


def _vertices(settings, wall, scale: float):
    try:
        shape = ifcopenshell.geom.create_shape(settings, wall)
    except RuntimeError:
        return None
    vertices = np.array(shape.geometry.verts, dtype=float).reshape(-1, 3)
    if len(vertices) == 0:
        return None
    return vertices * scale


def _centerline(vertices: np.ndarray) -> tuple[float, float, float, float]:
    span = vertices.max(axis=0) - vertices.min(axis=0)
    if span[0] >= span[1]:
        y = float((vertices[:, 1].min() + vertices[:, 1].max()) / 2.0)
        return (float(vertices[:, 0].min()), y, float(vertices[:, 0].max()), y)
    x = float((vertices[:, 0].min() + vertices[:, 0].max()) / 2.0)
    return (x, float(vertices[:, 1].min()), x, float(vertices[:, 1].max()))
