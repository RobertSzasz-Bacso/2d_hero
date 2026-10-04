"""Write one synthetic building to the formats Phase 8 will read."""

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
    import ifcopenshell.api.aggregate
    import ifcopenshell.api.context
    import ifcopenshell.api.geometry
    import ifcopenshell.api.project
    import ifcopenshell.api.root
    import ifcopenshell.api.spatial
    import ifcopenshell.api.unit

    file = ifcopenshell.api.project.create_file(version="IFC4")
    model = ifcopenshell.api.root.create_entity(file, ifc_class="IfcProject", name="Synthetic")
    length = ifcopenshell.api.unit.add_si_unit(file, unit_type="LENGTHUNIT")
    ifcopenshell.api.unit.assign_unit(file, units=[length])
    context = ifcopenshell.api.context.add_context(file, context_type="Model")
    body = ifcopenshell.api.context.add_context(
        file,
        context_type="Model",
        context_identifier="Body",
        target_view="MODEL_VIEW",
        parent=context,
    )
    site = ifcopenshell.api.root.create_entity(file, ifc_class="IfcSite", name="Site")
    block = ifcopenshell.api.root.create_entity(file, ifc_class="IfcBuilding", name="Building")
    storey = ifcopenshell.api.root.create_entity(file, ifc_class="IfcBuildingStorey", name="Ground")
    ifcopenshell.api.aggregate.assign_object(file, products=[site], relating_object=model)
    ifcopenshell.api.aggregate.assign_object(file, products=[block], relating_object=site)
    ifcopenshell.api.aggregate.assign_object(file, products=[storey], relating_object=block)
    wall = ifcopenshell.api.root.create_entity(file, ifc_class="IfcWall", name="South")
    representation = ifcopenshell.api.geometry.create_2pt_wall(
        file,
        element=wall,
        context=body,
        p1=(0.0, 0.0),
        p2=(8.0, 0.0),
        elevation=0.0,
        height=2.7,
        thickness=0.25,
        is_si=True,
    )
    ifcopenshell.api.geometry.assign_representation(
        file, product=wall, representation=representation
    )
    ifcopenshell.api.spatial.assign_container(file, products=[wall], relating_structure=storey)
    file.write(str(path))
    del building
