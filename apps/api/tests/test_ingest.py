"""Ingest, units, gravity, storeys, streaming, and cancel."""

import gc
import inspect
import json
import tracemalloc
from pathlib import Path
from typing import Any, cast

import numpy as np
import pytest

from hero.ingest.read import iter_las_chunks, read_source
from hero.jobs import execute_import
from hero.pipeline.normalize import normalize_scene
from hero.schema import blank_plan, dump_plan
from hero.testkit.building import build_building
from hero.testkit.writers import obj_bytes

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "fixtures" / "synthetic"


def _write_obj(path: Path, **options: object) -> None:
    building = build_building(1, **options)  # type: ignore[arg-type]
    path.write_bytes(obj_bytes(building))


def test_millimetre_building_is_converted_to_metres(tmp_path: Path) -> None:
    path = tmp_path / "building.obj"
    _write_obj(path, millimetres=True)
    scene = read_source(path)
    result = normalize_scene(scene)
    assert result.unit_scale == pytest.approx(0.001)
    assert any(issue["code"] == "units_guessed" for issue in result.issues)
    span = float(np.ptp(result.points[:, :2], axis=0).max())
    assert 5.0 < span < 30.0


def test_three_degree_tilt_recovers_up(tmp_path: Path) -> None:
    path = tmp_path / "tilted.obj"
    _write_obj(path, tilt_deg=3.0)
    truth = build_building(1, tilt_deg=3.0).true_up
    result = normalize_scene(read_source(path))
    cosine = float(np.dot(result.estimated_up, truth) / np.linalg.norm(result.estimated_up))
    angle = float(np.degrees(np.arccos(np.clip(cosine, -1.0, 1.0))))
    assert angle < 1.0, f"up-axis error {angle:.3f} deg"


def test_two_storeys_match_truth(tmp_path: Path) -> None:
    path = tmp_path / "building.obj"
    _write_obj(path)
    result = normalize_scene(read_source(path))
    elevations = sorted(level.elevation for level in result.levels)
    assert len(elevations) == 2
    assert elevations[0] == pytest.approx(0.0, abs=0.05)
    assert elevations[1] == pytest.approx(3.0, abs=0.05)


@pytest.mark.parametrize(
    "name",
    [
        "building.obj",
        "building.glb",
        "building.ply",
        "building.usdz",
        "building.las",
        "building.e57",
        "building.ifc",
    ],
)
def test_synthetic_format_loads(name: str) -> None:
    scene = read_source(FIXTURE / name)
    result = normalize_scene(scene)
    assert len(result.points) > 10


def test_e57_pose_is_applied(tmp_path: Path) -> None:
    from pye57 import E57

    path = tmp_path / "posed.e57"
    count = 1000
    local = np.zeros((count, 3))
    local[:, 0] = np.linspace(0, 1, count)
    with E57(str(path), mode="w") as handle:
        handle.write_scan_raw(
            {
                "cartesianX": local[:, 0],
                "cartesianY": local[:, 1],
                "cartesianZ": local[:, 2],
            },
            rotation=np.array([1.0, 0.0, 0.0, 0.0]),
            translation=np.array([10.0, 0.0, 0.0]),
        )
    scene = read_source(path)
    assert scene.points is not None
    assert float(scene.points[:, 0].mean()) == pytest.approx(10.5, abs=0.05)


def test_las_reader_is_a_generator_and_downsample_stays_small(tmp_path: Path) -> None:
    path = tmp_path / "large.las"
    try:
        _write_surface_las(path, 5_000_000)
    except MemoryError:
        pytest.skip("This machine cannot allocate scratch space for 5 million points.")
    reader = iter_las_chunks(path)
    assert inspect.isgenerator(reader)
    reader.close()
    gc.collect()
    tracemalloc.start()
    result = normalize_scene(read_source(path))
    _current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert len(result.points) > 0
    assert peak < int(1.5 * 1024**3), f"downsample heap {peak / 1024**3:.2f} GB"


def test_cancel_does_not_write_a_plan(tmp_path: Path) -> None:
    folder = tmp_path / "project"
    folder.mkdir()
    _write_obj(folder / "source.obj")
    meta = {
        "name": "Cancel",
        "createdAt": "2026-01-01T00:00:00+00:00",
        "sourceFileName": "source.obj",
        "linkedPath": None,
    }
    (folder / "project.json").write_text(json.dumps(meta), encoding="utf-8")
    plan_text = dump_plan(blank_plan("Cancel"))
    (folder / "plan.json").write_text(plan_text, encoding="utf-8")
    (folder / "job.cancel").write_text("1", encoding="utf-8")
    outcome = execute_import(str(folder), units="auto", up_axis="auto")
    assert outcome["state"] == "cancelled"
    assert (folder / "plan.json").read_text(encoding="utf-8") == plan_text
    assert not (folder / "cloud.bin").exists()


def _write_surface_las(path: Path, count: int) -> None:
    import laspy

    rng = np.random.default_rng(1)
    xs = rng.random(count) * 10.0
    ys = rng.random(count) * 10.0
    zs = rng.random(count) * 0.02
    header = laspy.LasHeader(point_format=0, version="1.2")
    header.scales = np.array([0.001, 0.001, 0.001])
    header.offsets = np.array([0.0, 0.0, 0.0])
    cloud = laspy.LasData(header)
    cloud.x = xs
    cloud.y = ys
    cloud.z = zs
    cast(Any, cloud).write(path)
