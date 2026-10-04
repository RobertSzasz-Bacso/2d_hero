"""Semantic IFC import. Axis walls do not go through the mesh detector."""

from __future__ import annotations

import math
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Literal, cast

import numpy as np
from shapely.geometry import MultiPoint

from hero.schema import (
    Column,
    Fixture,
    Level,
    Opening,
    Point,
    Room,
    Stair,
    Vertex,
    Wall,
)

_SYMBOL_ROLE = {
    "toilet": "fixture",
    "sink": "fixture",
    "bathtub": "fixture",
    "shower": "fixture",
    "kitchen-counter": "fixture",
    "stove": "fixture",
    "bed-double": "furniture",
    "sofa": "furniture",
    "table": "furniture",
    "wardrobe": "furniture",
    "block": "furniture",
    "chair": "furniture",
}


def read_ifc_plan(path: Path) -> tuple[list[Level], list[dict[str, str]]]:
    """Storeys, walls, openings, spaces, columns, stairs, and furnishing, in metres."""
    import ifcopenshell
    import ifcopenshell.util.unit

    model = ifcopenshell.open(str(path))
    scale = float(ifcopenshell.util.unit.calculate_unit_scale(model))
    if scale <= 0:
        scale = 1.0
    storeys = list(model.by_type("IfcBuildingStorey"))
    issues: list[dict[str, str]] = []
    if not storeys:
        level, extra = _level_from(model, None, scale, model.by_type("IfcProduct"), set())
        return ([level] if level is not None else []), issues + extra
    levels: list[Level] = []
    used: set[str] = set()
    for storey in storeys:
        contained = _contained(storey)
        level, extra = _level_from(model, storey, scale, contained, used)
        issues.extend(extra)
        if level is not None:
            levels.append(level)
    return levels, issues


def _contained(storey) -> list:
    elements: list = []
    for relation in storey.ContainsElements or []:
        elements.extend(relation.RelatedElements or [])
    for relation in storey.IsDecomposedBy or []:
        elements.extend(relation.RelatedObjects or [])
    return elements


def _level_from(model, storey, scale: float, products: Sequence[Any], used: set[str]):
    name = storey.Name if storey is not None and storey.Name else "Level"
    elevation = _storey_elevation(storey, scale)
    walls: list[Wall] = []
    vertices: list[Vertex] = []
    vertex_ids: dict[tuple[float, float], str] = {}
    hosts: dict[int, str] = {}
    segments: dict[str, tuple[float, float, float, float]] = {}
    heights: list[float] = []
    issues: list[dict[str, str]] = []
    wall_index = 0
    for product in products:
        if not product.is_a("IfcWall"):
            continue
        endpoints, thickness, from_solid = _wall_axis(product, scale)
        if endpoints is None or thickness is None:
            continue
        start, end = endpoints
        if math.hypot(end[0] - start[0], end[1] - start[1]) < 0.05:
            continue
        wall_index += 1
        wall_id = f"w{wall_index}"
        kind = _wall_kind(product)
        walls.append(
            Wall(
                id=wall_id,
                a=_vertex(vertices, vertex_ids, start[0], start[1]),
                b=_vertex(vertices, vertex_ids, end[0], end[1]),
                thickness=min(1.5, max(thickness, 0.01)),
                kind=kind,
                confidence=1.0 if not from_solid else 0.6,
            )
        )
        hosts[product.id()] = wall_id
        segments[wall_id] = (start[0], start[1], end[0], end[1])
        height = _body_height(product, scale)
        if height is not None:
            heights.append(height)
        if from_solid:
            issues.append(
                {
                    "code": "ifc_wall_from_solid",
                    "severity": "warning",
                    "message": "A wall had no axis curve. The centerline follows the solid.",
                    "elementId": wall_id,
                }
            )
    ceiling = max(heights) if heights else 2.7
    if ceiling <= 1.5:
        ceiling = 2.7
    openings = _openings(products, hosts, segments, elevation, ceiling, scale)
    for opening in openings:
        if opening.head > ceiling:
            ceiling = opening.head
    rooms = _rooms(products, scale)
    columns = _columns(products, scale)
    stairs = _stairs(products, elevation, scale)
    fixtures = _fixtures(products, scale)
    if not walls and not rooms and not openings:
        return None, issues
    level_id = _level_id(str(name), used)
    return (
        Level(
            id=level_id,
            name=str(name),
            elevation=elevation,
            ceilingHeight=ceiling,
            vertices=vertices,
            walls=walls,
            openings=openings,
            columns=columns,
            stairs=stairs,
            rooms=rooms,
            fixtures=fixtures,
        ),
        issues,
    )


def _storey_elevation(storey, scale: float) -> float:
    import ifcopenshell.util.placement

    if storey is None:
        return 0.0
    if storey.Elevation is not None:
        return float(storey.Elevation) * scale
    if storey.ObjectPlacement:
        matrix = ifcopenshell.util.placement.get_local_placement(storey.ObjectPlacement)
        return float(matrix[2][3]) * scale
    return 0.0


def _wall_kind(product) -> Literal["exterior", "interior", "partition"]:
    import ifcopenshell.util.element

    psets = ifcopenshell.util.element.get_psets(product)
    common = psets.get("Pset_WallCommon", {})
    external = common.get("IsExternal")
    if external is True:
        return "exterior"
    if external is False:
        return "partition"
    return "interior"


def _wall_axis(product, scale: float):
    points = _representation_points(product, "Axis")
    if len(points) >= 2:
        world = _world(product, points, scale)
        thickness = _layer_thickness(product, scale)
        if thickness is None:
            thickness = _solid_thickness(product, scale)
        if thickness is None:
            thickness = 0.2
        return (world[0], world[-1]), thickness, False
    solid = _solid_centerline(product, scale)
    if solid is None:
        return None, None, True
    endpoints, thickness = solid
    return endpoints, thickness, True


def _representation_points(product, identifier: str) -> list[tuple[float, ...]]:
    if not product.Representation:
        return []
    for representation in product.Representation.Representations or []:
        if representation.RepresentationIdentifier != identifier:
            continue
        for item in representation.Items or []:
            points = _curve_points(item)
            if points:
                return points
            for curve in _nested_curves(item):
                points = _curve_points(curve)
                if points:
                    return points
    return []


def _nested_curves(item) -> list:
    curves = []
    elements = getattr(item, "Elements", None)
    if elements:
        curves.extend(elements)
    curve = getattr(item, "OuterCurve", None)
    if curve is not None:
        curves.append(curve)
    return curves


def _curve_points(item) -> list[tuple[float, ...]]:
    if item is None:
        return []
    if item.is_a("IfcIndexedPolyCurve"):
        return [tuple(point) for point in item.Points.CoordList]
    if item.is_a("IfcPolyline"):
        return [tuple(point.Coordinates) for point in item.Points]
    return []


def _world(product, points: list[tuple[float, ...]], scale: float) -> list[tuple[float, float]]:
    import ifcopenshell.util.placement

    if product.ObjectPlacement:
        matrix = ifcopenshell.util.placement.get_local_placement(product.ObjectPlacement)
    else:
        matrix = np.eye(4)
    rotation = matrix[:3, :3]
    origin = matrix[:3, 3] * scale
    world: list[tuple[float, float]] = []
    for point in points:
        local = np.zeros(3)
        local[0] = point[0] * scale
        if len(point) > 1:
            local[1] = point[1] * scale
        if len(point) > 2:
            local[2] = point[2] * scale
        mapped = rotation @ local + origin
        world.append((float(mapped[0]), float(mapped[1])))
    return world


def _world_xyz(product, scale: float) -> tuple[float, float, float, float]:
    import ifcopenshell.util.placement

    if not product.ObjectPlacement:
        return 0.0, 0.0, 0.0, 0.0
    matrix = ifcopenshell.util.placement.get_local_placement(product.ObjectPlacement)
    x = float(matrix[0][3]) * scale
    y = float(matrix[1][3]) * scale
    z = float(matrix[2][3]) * scale
    angle = math.degrees(math.atan2(float(matrix[1][0]), float(matrix[0][0])))
    return x, y, z, angle


def _layer_thickness(product, scale: float) -> float | None:
    import ifcopenshell.util.element

    material = ifcopenshell.util.element.get_material(product)
    if material is None:
        return None
    if material.is_a("IfcMaterialLayerSetUsage"):
        material = material.ForLayerSet
    if material is not None and material.is_a("IfcMaterialLayerSet"):
        total = 0.0
        for layer in material.MaterialLayers or []:
            total += float(layer.LayerThickness or 0.0)
        if total > 0:
            return total * scale
    return None


def _body_height(product, scale: float) -> float | None:
    if not product.Representation:
        return None
    for representation in product.Representation.Representations or []:
        if representation.RepresentationIdentifier != "Body":
            continue
        for item in representation.Items or []:
            depth = getattr(item, "Depth", None)
            if depth:
                return float(depth) * scale
    return None


def _solid_centerline(product, scale: float):
    xy = _solid_xy(product, scale)
    if xy is None or len(xy) < 3:
        return None
    rect = MultiPoint(xy).minimum_rotated_rectangle
    coords = np.asarray(cast(Any, rect).exterior.coords)
    if len(coords) < 4:
        return None
    edge_a = coords[1] - coords[0]
    edge_b = coords[2] - coords[1]
    length_a = float(np.hypot(edge_a[0], edge_a[1]))
    length_b = float(np.hypot(edge_b[0], edge_b[1]))
    if length_a >= length_b:
        direction = edge_a / length_a
        length = length_a
        thickness = length_b
    else:
        direction = edge_b / length_b
        length = length_b
        thickness = length_a
    if length < 0.05 or thickness <= 0:
        return None
    center = np.asarray(rect.centroid.coords[0])
    half = direction * (length / 2.0)
    start = center - half
    end = center + half
    return ((float(start[0]), float(start[1])), (float(end[0]), float(end[1]))), thickness


def _solid_thickness(product, scale: float) -> float | None:
    solid = _solid_centerline(product, scale)
    if solid is None:
        return None
    return solid[1]


def _solid_xy(product, scale: float) -> np.ndarray | None:
    import ifcopenshell.geom

    if not product.Representation:
        return None
    geometry = cast(Any, ifcopenshell.geom)
    settings = geometry.settings()
    settings.set("USE_WORLD_COORDS", True)
    try:
        shape = geometry.create_shape(settings, product)
    except Exception:
        return None
    verts = np.asarray(shape.geometry.verts, dtype=np.float64).reshape(-1, 3) * scale
    if len(verts) == 0:
        return None
    return verts[:, :2]


def _openings(products, hosts, segments, elevation: float, ceiling: float, scale: float):
    openings: list[Opening] = []
    seen: set[int] = set()
    for product in products:
        if product.is_a("IfcDoor") or product.is_a("IfcWindow"):
            opening = _filled_opening(product, hosts, segments, elevation, ceiling, scale)
            if opening is not None:
                seen.add(product.id())
                openings.append(opening)
    for product in products:
        if not product.is_a("IfcOpeningElement") or product.id() in seen:
            continue
        if product.HasFillings:
            continue
        opening = _void_opening(product, hosts, segments, elevation, ceiling, scale, "passage")
        if opening is not None:
            openings.append(opening)
    return openings


def _filled_opening(product, hosts, segments, elevation, ceiling, scale):
    fills = product.FillsVoids or []
    if not fills:
        return None
    feature = fills[0].RelatingOpeningElement
    host = _void_host(feature)
    if host is None:
        return None
    wall_id = hosts.get(host.id())
    if wall_id is None:
        return None
    width = _measure(product, "OverallWidth", scale)
    height = _measure(product, "OverallHeight", scale)
    x, y, z, _angle = _world_xyz(feature if feature.ObjectPlacement else product, scale)
    if width is None or height is None or width <= 0 or height <= 0:
        return None
    return _make_opening(
        wall_id,
        segments[wall_id],
        "door" if product.is_a("IfcDoor") else "window",
        x,
        y,
        z,
        width,
        height,
        elevation,
        ceiling,
        len(hosts),
    )


def _void_opening(product, hosts, segments, elevation, ceiling, scale, kind: str):
    host = _void_host(product)
    if host is None:
        return None
    wall_id = hosts.get(host.id())
    if wall_id is None:
        return None
    x, y, z, _angle = _world_xyz(product, scale)
    height = max(ceiling * 0.9, 0.2)
    width = 1.0
    return _make_opening(
        wall_id, segments[wall_id], kind, x, y, z, width, height, elevation, ceiling, len(hosts)
    )


def _void_host(feature):
    voids = feature.VoidsElements or []
    if not voids:
        return None
    return voids[0].RelatingBuildingElement


def _make_opening(wall_id, segment, kind, x, y, z, width, height, elevation, ceiling, salt: int):
    ax, ay, bx, by = segment
    length = math.hypot(bx - ax, by - ay)
    if length <= width:
        return None
    along = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (length * length)
    offset = min(1.0, max(0.0, along))
    sill = max(0.0, z - elevation - height / 2.0)
    head = sill + height
    if head > ceiling + 0.05:
        head = ceiling
    if head <= sill:
        return None
    if kind == "window":
        swing = "none"
    elif width > 1.2:
        swing = "double"
    else:
        swing = "left"
    if kind == "passage":
        swing = "none"
    return Opening(
        id=f"o{wall_id[1:]}{salt}",
        wall=wall_id,
        kind=kind,
        offset=offset,
        width=width,
        sill=sill,
        head=head,
        swing=swing,
        swingSide="positive",
        confidence=1.0,
    )


def _measure(product, name: str, scale: float) -> float | None:
    value = getattr(product, name, None)
    if value is None:
        return None
    return float(value) * scale


def _rooms(products, scale: float) -> list[Room]:
    rooms: list[Room] = []
    for product in products:
        if not product.is_a("IfcSpace"):
            continue
        name = product.LongName or product.Name or "Room"
        number = product.Name if product.LongName and product.Name else f"{len(rooms) + 1:02d}"
        x, y, _z, _angle = _world_xyz(product, scale)
        rooms.append(
            Room(
                id=f"r{len(rooms) + 1}",
                name=str(name),
                number=str(number),
                seed=Point(x=x, y=y),
            )
        )
    return rooms


def _columns(products, scale: float) -> list[Column]:
    columns: list[Column] = []
    for product in products:
        if not product.is_a("IfcColumn"):
            continue
        points = _representation_points(product, "FootPrint")
        if len(points) < 3:
            continue
        xs = [point[0] * scale for point in points]
        ys = [point[1] * scale for point in points if len(point) > 1]
        if not xs or not ys:
            continue
        width = max(xs) - min(xs)
        depth = max(ys) - min(ys)
        if width <= 0 or depth <= 0:
            continue
        x, y, _z, angle = _world_xyz(product, scale)
        columns.append(
            Column(
                id=f"c{len(columns) + 1}",
                x=x,
                y=y,
                width=width,
                depth=depth,
                rotationDeg=angle,
            )
        )
    return columns


def _stairs(products, elevation: float, scale: float) -> list[Stair]:
    import ifcopenshell.util.element

    stairs: list[Stair] = []
    for product in products:
        if not product.is_a("IfcStair"):
            continue
        points = _representation_points(product, "FootPrint")
        if len(points) < 3:
            continue
        world = _world(product, points, scale)
        outline = _drop_close(world)
        if len(outline) < 3:
            continue
        _x, _y, _z, angle = _world_xyz(product, scale)
        direction = (math.cos(math.radians(angle)), math.sin(math.radians(angle)))
        psets = ifcopenshell.util.element.get_psets(product)
        meta = psets.get("HeroStair", {})
        risers = int(meta.get("RiserCount") or 1)
        to_elevation = float(meta.get("ToElevation") or elevation + 0.18 * risers)
        if to_elevation <= elevation:
            to_elevation = elevation + 0.15
        stairs.append(
            Stair(
                id=f"s{len(stairs) + 1}",
                outline=[Point(x=x, y=y) for x, y in outline],
                direction=Point(x=direction[0], y=direction[1]),
                riserCount=max(1, risers),
                fromElevation=elevation,
                toElevation=to_elevation,
            )
        )
    return stairs


def _fixtures(products, scale: float) -> list[Fixture]:
    import ifcopenshell.util.element

    from hero.pipeline.fixtures import classify_box

    fixtures: list[Fixture] = []
    for product in products:
        if not product.is_a("IfcFurnishingElement"):
            continue
        psets = ifcopenshell.util.element.get_psets(product)
        size = psets.get("HeroFixture", {})
        width = float(size.get("Width") or 0.0)
        depth = float(size.get("Depth") or 0.0)
        if width <= 0 or depth <= 0:
            continue
        name = str(product.Name or "")
        x, y, _z, angle = _world_xyz(product, scale)
        if name in _SYMBOL_ROLE:
            symbol = name
            role = _SYMBOL_ROLE[name]
            confidence = 0.3 if symbol == "block" else 0.8
        else:
            symbol, role, confidence, width, depth = classify_box(width, depth, 0.5)
        fixtures.append(
            Fixture(
                id=f"f{len(fixtures) + 1}",
                symbol=symbol,  # type: ignore[arg-type]
                x=x,
                y=y,
                rotationDeg=angle,
                width=width,
                depth=depth,
                confidence=confidence,
                role=role,  # type: ignore[arg-type]
            )
        )
    return fixtures


def _drop_close(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    kept: list[tuple[float, float]] = []
    for point in points:
        if kept and math.hypot(point[0] - kept[-1][0], point[1] - kept[-1][1]) < 1e-4:
            continue
        kept.append(point)
    if len(kept) >= 2 and math.hypot(kept[0][0] - kept[-1][0], kept[0][1] - kept[-1][1]) < 1e-4:
        kept.pop()
    return kept


def _vertex(vertices: list[Vertex], ids: dict[tuple[float, float], str], x: float, y: float) -> str:
    key = (round(x, 3), round(y, 3))
    found = ids.get(key)
    if found is not None:
        return found
    for (ex, ey), existing in ids.items():
        if math.hypot(ex - key[0], ey - key[1]) <= 0.05:
            return existing
    vertex_id = f"v{len(vertices) + 1}"
    ids[key] = vertex_id
    vertices.append(Vertex(id=vertex_id, x=key[0], y=key[1]))
    return vertex_id


def _level_id(name: str, used: set[str]) -> str:
    cleaned = "".join(char if char.isalnum() else "_" for char in name)
    if not cleaned[:1].isalpha():
        cleaned = f"L{cleaned}"
    cleaned = cleaned[:31] or "L"
    candidate = cleaned
    index = 2
    while candidate in used:
        suffix = str(index)
        candidate = f"{cleaned[: 31 - len(suffix)]}{suffix}"
        index += 1
    used.add(candidate)
    return candidate
