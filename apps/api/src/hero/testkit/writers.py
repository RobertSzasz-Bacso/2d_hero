"""Write a synthetic GLB building for tests."""

from pathlib import Path

import trimesh

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
        "building.glb": folder / "building.glb",
        "plan.json": folder / "plan.json",
    }
    paths["building.glb"].write_bytes(glb_bytes(building))
    paths["plan.json"].write_text(dump_plan(building.plan), encoding="utf-8", newline="\n")
    return paths


def glb_bytes(building: Building) -> bytes:
    mesh = trimesh.Trimesh(vertices=building.vertices, faces=building.faces, process=False)
    payload = mesh.export(file_type="glb")
    if not isinstance(payload, bytes):
        raise TypeError("GLB export did not return bytes.")
    return payload
