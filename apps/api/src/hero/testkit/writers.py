"""Write one synthetic building to the formats Phase 8 will read."""

import math
from pathlib import Path
from typing import Any, cast

import laspy
import numpy as np
import trimesh
from pxr import Gf, Usd, UsdGeom, UsdUtils

from hero.schema import dump_plan
from hero.testkit.building import Building, build_building


def write_building(
    folder: Path,
    seed: int = 1,
    *,
    noise_m: float = 0.0,
    tilt_deg: float = 0.0,
    millimetres: bool = False,
    missing_face: bool = False,
) -> dict[str, Path]:
    """Write the small default building."""
    folder.mkdir(parents=True, exist_ok=True)
    building = build_building(
        seed,
        noise_m=noise_m,
        tilt_deg=tilt_deg,
        millimetres=millimetres,
        missing_face=missing_face,
    )
    paths = {
        "building.obj": folder / "building.obj",
        "building.glb": folder / "building.glb",
        "building.ply": folder / "building.ply",
        "building.usdz": folder / "building.usdz",
        "building.las": folder / "building.las",
        "building.e57": folder / "building.e57",
        "building.ifc": folder / "building.ifc",
        "plan.json": folder / "plan.json",
    }
    paths["building.obj"].write_bytes(_obj_bytes(building))
    mesh = trimesh.Trimesh(vertices=building.vertices, faces=building.faces, process=False)
    mesh.export(paths["building.glb"])
    mesh.export(paths["building.ply"])
    _write_usdz(paths["building.usdz"], building)
    _write_las(paths["building.las"], building.vertices)
    _write_e57(paths["building.e57"], building.vertices)
    _write_ifc(paths["building.ifc"], building)
    paths["plan.json"].write_text(dump_plan(building.plan), encoding="utf-8", newline="\n")
    return paths


def obj_bytes(building: Building) -> bytes:
    return _obj_bytes(building)


def _obj_bytes(building: Building) -> bytes:
    lines: list[str] = []
    for x, y, z in building.vertices:
        lines.append(f"v {x:.6f} {y:.6f} {z:.6f}")
    for a, b, c in building.faces:
        lines.append(f"f {int(a) + 1} {int(b) + 1} {int(c) + 1}")
    return ("\n".join(lines) + "\n").encode("ascii")


def _write_usdz(path: Path, building: Building) -> None:
    usdc = path.with_suffix(".usdc")
    if usdc.exists():
        usdc.unlink()
    usd = cast(Any, Usd)
    geom = cast(Any, UsdGeom)
    gf = cast(Any, Gf)
    utils = cast(Any, UsdUtils)
    stage = usd.Stage.CreateNew(str(usdc))
    geom.SetStageMetersPerUnit(stage, building.unit_scale_to_meters)
    geom.SetStageUpAxis(stage, geom.Tokens.z)
    mesh = geom.Mesh.Define(stage, "/Building")
    points = [gf.Vec3f(float(x), float(y), float(z)) for x, y, z in building.vertices]
    mesh.CreatePointsAttr(points)
    mesh.CreateFaceVertexCountsAttr([3] * len(building.faces))
    mesh.CreateFaceVertexIndicesAttr([int(index) for index in building.faces.reshape(-1)])
    mesh.CreateExtentAttr(mesh.ComputeExtent(mesh.GetPointsAttr().Get()))
    stage.SetDefaultPrim(mesh.GetPrim())
    stage.GetRootLayer().Save()
    if path.exists():
        path.unlink()
    utils.CreateNewUsdzPackage(str(usdc), str(path))
    usdc.unlink(missing_ok=True)


def _write_las(path: Path, vertices: np.ndarray) -> None:
    header = laspy.LasHeader(point_format=0, version="1.2")
    header.scales = np.array([0.001, 0.001, 0.001])
    header.offsets = vertices.min(axis=0)
    cloud = laspy.LasData(header)
    cloud.x = vertices[:, 0]
    cloud.y = vertices[:, 1]
    cloud.z = vertices[:, 2]
    cast(Any, cloud).write(path)


def _write_e57(path: Path, vertices: np.ndarray) -> None:
    from pye57 import E57

    if path.exists():
        path.unlink()
    with E57(str(path), mode="w") as handle:
        handle.write_scan_raw(
            {
                "cartesianX": np.ascontiguousarray(vertices[:, 0]),
                "cartesianY": np.ascontiguousarray(vertices[:, 1]),
                "cartesianZ": np.ascontiguousarray(vertices[:, 2]),
            },
            rotation=np.array([1.0, 0.0, 0.0, 0.0]),
            translation=np.zeros(3),
        )


def _write_ifc(path: Path, building: Building) -> None:
    """Semantic IFC: storeys, wall axes, layers, doors, windows, and spaces."""
    import ifcopenshell.api.aggregate
    import ifcopenshell.api.context
    import ifcopenshell.api.project
    import ifcopenshell.api.root
    import ifcopenshell.api.unit
    import ifcopenshell.util.unit

    scale = building.unit_scale_to_meters if building.unit_scale_to_meters > 0 else 1.0
    file = ifcopenshell.api.project.create_file(version="IFC4")
    project = ifcopenshell.api.root.create_entity(file, ifc_class="IfcProject", name="Synthetic")
    prefix = "MILLI" if scale < 0.5 else None
    length = ifcopenshell.api.unit.add_si_unit(file, unit_type="LENGTHUNIT", prefix=prefix)
    ifcopenshell.api.unit.assign_unit(file, units=[length])
    unit_scale = float(ifcopenshell.util.unit.calculate_unit_scale(file))
    model = ifcopenshell.api.context.add_context(file, context_type="Model")
    body = ifcopenshell.api.context.add_context(
        file,
        context_type="Model",
        context_identifier="Body",
        target_view="MODEL_VIEW",
        parent=model,
    )
    plan = ifcopenshell.api.context.add_context(file, context_type="Plan")
    axis = ifcopenshell.api.context.add_context(
        file,
        context_type="Plan",
        context_identifier="Axis",
        target_view="GRAPH_VIEW",
        parent=plan,
    )
    footprint = ifcopenshell.api.context.add_context(
        file,
        context_type="Plan",
        context_identifier="FootPrint",
        target_view="PLAN_VIEW",
        parent=plan,
    )
    site = ifcopenshell.api.root.create_entity(file, ifc_class="IfcSite", name="Site")
    block = ifcopenshell.api.root.create_entity(file, ifc_class="IfcBuilding", name="Building")
    ifcopenshell.api.aggregate.assign_object(file, products=[site], relating_object=project)
    ifcopenshell.api.aggregate.assign_object(file, products=[block], relating_object=site)
    for level in building.plan.levels:
        _write_storey(file, block, level, body, axis, footprint, unit_scale)
    file.write(str(path))


def _write_storey(file, block, level, body, axis_context, footprint, unit_scale: float) -> None:
    import ifcopenshell.api.aggregate
    import ifcopenshell.api.root
    import ifcopenshell.api.spatial

    storey = ifcopenshell.api.root.create_entity(
        file, ifc_class="IfcBuildingStorey", name=level.name
    )
    storey.Elevation = level.elevation / unit_scale
    ifcopenshell.api.aggregate.assign_object(file, products=[storey], relating_object=block)
    _place(file, storey, 0.0, 0.0, level.elevation, 0.0)
    verts = {vertex.id: vertex for vertex in level.vertices}
    hosted: dict[str, tuple[Any, Any, Any, float]] = {}
    for wall in level.walls:
        hosted[wall.id] = _write_wall(
            file, storey, wall, verts[wall.a], verts[wall.b], level, body, axis_context, unit_scale
        )
    for opening in level.openings:
        host = hosted.get(opening.wall)
        if host is not None:
            _write_opening(file, storey, opening, host, level.elevation, unit_scale)
    for room in level.rooms:
        _write_space(file, storey, room, level.elevation)
    for column in level.columns:
        _write_column(file, storey, column, level.elevation, footprint, unit_scale)
    for stair in level.stairs:
        _write_stair(file, storey, stair, level.elevation, footprint, unit_scale)
    for fixture in level.fixtures:
        _write_fixture(file, storey, fixture, level.elevation)


def _write_wall(file, storey, wall, start, end, level, body, axis_context, unit_scale: float):
    import ifcopenshell.api.geometry
    import ifcopenshell.api.material
    import ifcopenshell.api.pset
    import ifcopenshell.api.root
    import ifcopenshell.api.spatial

    product = ifcopenshell.api.root.create_entity(file, ifc_class="IfcWall", name=wall.id)
    ifcopenshell.api.spatial.assign_container(file, products=[product], relating_structure=storey)
    representation = ifcopenshell.api.geometry.create_2pt_wall(
        file,
        element=product,
        context=body,
        p1=(start.x, start.y),
        p2=(end.x, end.y),
        elevation=level.elevation,
        height=level.ceilingHeight,
        thickness=wall.thickness,
        is_si=True,
    )
    ifcopenshell.api.geometry.assign_representation(
        file, product=product, representation=representation
    )
    length = math.hypot(end.x - start.x, end.y - start.y)
    curve = ifcopenshell.api.geometry.add_axis_representation(
        file, context=axis_context, axis=((0.0, 0.0), (length, 0.0))
    )
    ifcopenshell.api.geometry.assign_representation(file, product=product, representation=curve)
    material = ifcopenshell.api.material.add_material(file, name="Generic")
    layers = ifcopenshell.api.material.add_material_set(
        file, name=wall.id, set_type="IfcMaterialLayerSet"
    )
    layer = ifcopenshell.api.material.add_layer(file, layer_set=layers, material=material)
    ifcopenshell.api.material.edit_layer(
        file, layer=layer, attributes={"LayerThickness": wall.thickness / unit_scale}
    )
    ifcopenshell.api.material.assign_material(
        file, products=[product], type="IfcMaterialLayerSet", material=layers
    )
    pset = ifcopenshell.api.pset.add_pset(file, product=product, name="Pset_WallCommon")
    ifcopenshell.api.pset.edit_pset(
        file, pset=pset, properties={"IsExternal": wall.kind == "exterior"}
    )
    return product, start, end, length


def _write_opening(file, storey, opening, host, elevation: float, unit_scale: float) -> None:
    import ifcopenshell.api.feature
    import ifcopenshell.api.root
    import ifcopenshell.api.spatial

    product, start, end, length = host
    dx = (end.x - start.x) / length
    dy = (end.y - start.y) / length
    center_x = start.x + dx * opening.offset * length
    center_y = start.y + dy * opening.offset * length
    height = max(opening.head - opening.sill, 0.05)
    center_z = elevation + opening.sill + height / 2.0
    angle = math.atan2(dy, dx)
    feature = ifcopenshell.api.root.create_entity(
        file, ifc_class="IfcOpeningElement", name=f"{opening.id}Void"
    )
    _place(file, feature, center_x, center_y, center_z, angle)
    ifcopenshell.api.feature.add_feature(file, feature=feature, element=product)
    if opening.kind == "passage":
        return
    ifc_class = "IfcDoor" if opening.kind == "door" else "IfcWindow"
    element = ifcopenshell.api.root.create_entity(file, ifc_class=ifc_class, name=opening.id)
    element.OverallWidth = opening.width / unit_scale
    element.OverallHeight = height / unit_scale
    _place(file, element, center_x, center_y, center_z, angle)
    ifcopenshell.api.spatial.assign_container(file, products=[element], relating_structure=storey)
    ifcopenshell.api.feature.add_filling(file, opening=feature, element=element)


def _write_space(file, storey, room, elevation: float) -> None:
    import ifcopenshell.api.aggregate
    import ifcopenshell.api.root

    space = ifcopenshell.api.root.create_entity(
        file, ifc_class="IfcSpace", name=room.number or room.name
    )
    space.LongName = room.name
    ifcopenshell.api.aggregate.assign_object(file, products=[space], relating_object=storey)
    _place(file, space, room.seed.x, room.seed.y, elevation, 0.0)


def _write_column(file, storey, column, elevation, footprint, unit_scale: float) -> None:
    import ifcopenshell.api.geometry
    import ifcopenshell.api.root
    import ifcopenshell.api.spatial

    product = ifcopenshell.api.root.create_entity(file, ifc_class="IfcColumn", name=column.id)
    ifcopenshell.api.spatial.assign_container(file, products=[product], relating_structure=storey)
    _place(file, product, column.x, column.y, elevation, math.radians(column.rotationDeg))
    half_w = column.width / 2.0
    half_d = column.depth / 2.0
    ring = [(-half_w, -half_d), (half_w, -half_d), (half_w, half_d), (-half_w, half_d)]
    ring.append(ring[0])
    curve = _polyline(file, ring, unit_scale)
    representation = ifcopenshell.api.geometry.add_footprint_representation(
        file, context=footprint, curves=[curve]
    )
    ifcopenshell.api.geometry.assign_representation(
        file, product=product, representation=representation
    )


def _write_stair(file, storey, stair, elevation, footprint, unit_scale: float) -> None:
    import ifcopenshell.api.geometry
    import ifcopenshell.api.pset
    import ifcopenshell.api.root
    import ifcopenshell.api.spatial

    xs = [point.x for point in stair.outline]
    ys = [point.y for point in stair.outline]
    center_x = sum(xs) / len(xs)
    center_y = sum(ys) / len(ys)
    product = ifcopenshell.api.root.create_entity(file, ifc_class="IfcStair", name=stair.id)
    ifcopenshell.api.spatial.assign_container(file, products=[product], relating_structure=storey)
    angle = math.atan2(stair.direction.y, stair.direction.x)
    _place(file, product, center_x, center_y, elevation, angle)
    cosine = math.cos(angle)
    sine = math.sin(angle)
    local = []
    for point in stair.outline:
        dx = point.x - center_x
        dy = point.y - center_y
        local.append((dx * cosine + dy * sine, -dx * sine + dy * cosine))
    local.append(local[0])
    curve = _polyline(file, local, unit_scale)
    representation = ifcopenshell.api.geometry.add_footprint_representation(
        file, context=footprint, curves=[curve]
    )
    ifcopenshell.api.geometry.assign_representation(
        file, product=product, representation=representation
    )
    pset = ifcopenshell.api.pset.add_pset(file, product=product, name="HeroStair")
    ifcopenshell.api.pset.edit_pset(
        file,
        pset=pset,
        properties={"RiserCount": int(stair.riserCount), "ToElevation": float(stair.toElevation)},
    )


def _write_fixture(file, storey, fixture, elevation: float) -> None:
    import ifcopenshell.api.pset
    import ifcopenshell.api.root
    import ifcopenshell.api.spatial

    product = ifcopenshell.api.root.create_entity(
        file, ifc_class="IfcFurnishingElement", name=fixture.symbol
    )
    ifcopenshell.api.spatial.assign_container(file, products=[product], relating_structure=storey)
    _place(file, product, fixture.x, fixture.y, elevation, math.radians(fixture.rotationDeg))
    pset = ifcopenshell.api.pset.add_pset(file, product=product, name="HeroFixture")
    ifcopenshell.api.pset.edit_pset(
        file,
        pset=pset,
        properties={"Width": float(fixture.width), "Depth": float(fixture.depth)},
    )


def _polyline(file, points: list[tuple[float, float]], unit_scale: float):
    coords = [
        file.createIfcCartesianPoint((x / unit_scale, y / unit_scale)) for x, y in points
    ]
    return file.createIfcPolyline(coords)


def _place(file, product, x: float, y: float, z: float, angle: float) -> None:
    import ifcopenshell.api.geometry

    cosine = math.cos(angle)
    sine = math.sin(angle)
    matrix = np.array(
        [
            [cosine, -sine, 0.0, x],
            [sine, cosine, 0.0, y],
            [0.0, 0.0, 1.0, z],
            [0.0, 0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )
    ifcopenshell.api.geometry.edit_object_placement(
        file, product=product, matrix=matrix, is_si=True
    )
