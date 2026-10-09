"""Underlay images, decimated preview, and a skip when the owner scan is absent."""

from pathlib import Path
from typing import Any, cast

import numpy as np
import pytest
import trimesh
from PIL import Image

from hero.jobs import execute_import
from hero.pipeline.normalize import Normalized
from hero.pipeline.preview import TRIANGLE_CAP, write_preview

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "fixtures" / "synthetic" / "building.glb"
USER_GLB = ROOT / "samples" / "user" / "two_social_rooms_in_a_ruined_building.glb"


def test_underlay_png_is_a_real_image(tmp_path: Path, client, token: str) -> None:
    created = client.post(
        "/api/projects",
        files={"file": ("building.glb", FIXTURE.read_bytes(), "application/octet-stream")},
        headers={"X-Hero-Token": token},
    )
    assert created.status_code == 200
    project_id = created.json()["id"]
    folder = tmp_path / "projects" / project_id
    outcome = execute_import(str(folder), "auto", "auto")
    assert outcome["state"] == "done"
    image = client.get(
        f"/api/projects/{project_id}/underlay/L1.png",
        headers={"X-Hero-Token": token},
    )
    assert image.status_code == 200
    picture = Image.open(__import__("io").BytesIO(image.content))
    assert picture.size[0] >= 32
    assert picture.size[1] >= 32
    colors = picture.convert("RGBA").getcolors(maxcolors=picture.size[0] * picture.size[1])
    assert colors is None or len(colors) > 1


def test_preview_glb_has_fewer_triangles_than_a_dense_source(
    tmp_path: Path, client, token: str
) -> None:
    source = tmp_path / "dense.glb"
    count = TRIANGLE_CAP + 8_000
    _write_grid(source, count)
    created = client.post(
        "/api/projects",
        files={"file": ("dense.glb", source.read_bytes(), "application/octet-stream")},
        headers={"X-Hero-Token": token},
    )
    assert created.status_code == 200
    project_id = created.json()["id"]
    folder = tmp_path / "projects" / project_id
    empty = Normalized(
        points=np.zeros((1, 3)),
        normals=np.zeros((1, 3)),
        unit_scale=1.0,
        voxel=0.02,
        estimated_up=np.array([0.0, 0.0, 1.0]),
        levels=[],
        manhattan_angle_deg=0.0,
    )
    write_preview(folder / "source.glb", folder, empty)
    preview = client.get(f"/api/projects/{project_id}/preview", headers={"X-Hero-Token": token})
    assert preview.status_code == 200
    loaded = cast(
        Any,
        trimesh.load(__import__("io").BytesIO(preview.content), file_type="glb", force="mesh"),
    )
    assert len(loaded.faces) < count
    assert len(loaded.faces) > 0


def test_mesh_preview_uses_the_normalized_geometry_frame(tmp_path: Path) -> None:
    source = tmp_path / "raw.glb"
    source.write_text(
        "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
        encoding="utf-8",
    )
    vertices = np.array(
        [[10.0, 20.0, 30.0], [11.0, 20.0, 30.0], [10.0, 21.0, 30.0]],
        dtype=np.float64,
    )
    result = Normalized(
        points=vertices,
        normals=np.zeros((3, 3)),
        unit_scale=1.0,
        voxel=0.02,
        estimated_up=np.array([0.0, 0.0, 1.0]),
        levels=[],
        manhattan_angle_deg=0.0,
        mesh_vertices=vertices,
        mesh_faces=np.array([[0, 1, 2]], dtype=np.int32),
    )

    write_preview(source, tmp_path, result)
    loaded = cast(
        Any,
        trimesh.load(
            __import__("io").BytesIO((tmp_path / "preview.glb").read_bytes()),
            file_type="glb",
            force="mesh",
        ),
    )
    assert np.asarray(loaded.vertices).min(axis=0) == pytest.approx([10.0, 20.0, 30.0])


def test_point_preview_stores_rgb(tmp_path: Path) -> None:
    points = np.array([[0.0, 0.0, 0.0], [1.0, 2.0, 3.0]], dtype=np.float64)
    colors = np.array([[255, 0, 0], [0, 128, 255]], dtype=np.uint8)
    result = Normalized(
        points=points,
        normals=np.zeros((2, 3)),
        unit_scale=1.0,
        voxel=0.02,
        estimated_up=np.array([0.0, 0.0, 1.0]),
        levels=[],
        manhattan_angle_deg=0.0,
        colors=colors,
    )
    write_preview(tmp_path / "empty.glb", tmp_path, result)
    blob = (tmp_path / "preview.pts").read_bytes()
    count = int(np.frombuffer(blob[8:12], dtype="<u4")[0])
    flags = int(np.frombuffer(blob[12:16], dtype="<u4")[0])
    assert blob[:8] == b"HEROPTS\x00"
    assert count == 2
    assert flags == 1
    positions = np.frombuffer(blob[16 : 16 + count * 12], dtype="<f4").reshape(count, 3)
    stored = np.frombuffer(blob[16 + count * 12 :], dtype=np.uint8).reshape(count, 3)
    assert positions[1].tolist() == pytest.approx([1.0, 2.0, 3.0])
    assert stored[0].tolist() == [255, 0, 0]
    assert stored[1].tolist() == [0, 128, 255]


def test_user_ruined_building_opens_when_present() -> None:
    if not USER_GLB.is_file():
        pytest.skip("samples/user/two_social_rooms_in_a_ruined_building.glb is missing")
    from hero.ingest.read import read_source

    scene = read_source(USER_GLB)
    assert scene.points is not None
    assert len(scene.points) > 10


def _write_grid(path: Path, triangles: int) -> None:
    columns = int(np.ceil(np.sqrt(triangles / 2)))
    rows = columns
    xs = np.linspace(0.0, 10.0, columns + 1)
    ys = np.linspace(0.0, 10.0, rows + 1)
    grid_x, grid_y = np.meshgrid(xs, ys, indexing="xy")
    vertices = np.column_stack((grid_x.ravel(), grid_y.ravel(), np.zeros(grid_x.size)))
    faces: list[list[int]] = []
    for row in range(rows):
        for column in range(columns):
            base = row * (columns + 1) + column
            nxt = base + columns + 1
            faces.append([base, base + 1, nxt + 1])
            faces.append([base, nxt + 1, nxt])
            if len(faces) >= triangles:
                break
        if len(faces) >= triangles:
            break
    mesh = trimesh.Trimesh(vertices, np.asarray(faces[:triangles], dtype=np.int64), process=False)
    mesh.export(path)
