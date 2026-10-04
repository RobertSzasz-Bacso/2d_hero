"""HTTP API for local projects. Written before the routes."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hero.main import create_app

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(data_dir=tmp_path))


def _upload(client: TestClient, name: str) -> str:
    payload = (FIXTURES / name).read_bytes()
    response = client.post("/api/projects", files={"file": (name, payload, "application/octet-stream")})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_upload_generates_obj_glb_and_ifc(client):
    expectations = {"box.obj": 4, "box.glb": 4, "box.usdz": 4, "two_walls.ifc": 2, "room.las": 4}
    for name, wall_count in expectations.items():
        project_id = _upload(client, name)
        generated = client.post(f"/api/projects/{project_id}/generate", json={"slice_height": 1.2})
        assert generated.status_code == 200, generated.text
        assert len(generated.json()["walls"]) == wall_count
        assert generated.json()["units"] == "m"


def test_saved_plan_round_trips(client):
    project_id = _upload(client, "box.obj")
    generated = client.post(f"/api/projects/{project_id}/generate", json={}).json()
    generated["annotations"] = [{"id": "a1", "x": 1.0, "y": 2.0, "text": "Kitchen"}]
    saved = client.put(f"/api/projects/{project_id}/plan", json=generated)
    assert saved.status_code == 200, saved.text
    loaded = client.get(f"/api/projects/{project_id}")
    assert loaded.status_code == 200
    assert loaded.json()["plan"]["annotations"][0]["text"] == "Kitchen"


def test_preview_route_returns_the_source_mesh(client):
    project_id = _upload(client, "box.obj")
    preview = client.get(f"/api/projects/{project_id}/preview")
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["kind"] == "mesh"
    assert body["ceiling"] > body["floor"]


def test_dxf_and_svg_download(client):
    project_id = _upload(client, "box.obj")
    generated = client.post(f"/api/projects/{project_id}/generate", json={"slice_height": 1.2})
    assert generated.status_code == 200, generated.text
    dxf = client.get(f"/api/projects/{project_id}/dxf")
    svg = client.get(f"/api/projects/{project_id}/svg")
    assert dxf.status_code == 200, dxf.text
    assert b"WALLS" in dxf.content
    assert svg.status_code == 200, svg.text
    assert b'id="walls"' in svg.content
    pdf = client.get(f"/api/projects/{project_id}/pdf")
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF")


def test_other_formats_are_rejected_in_plain_language(client):
    response = client.post(
        "/api/projects",
        files={"file": ("room.stl", b"solid room", "application/octet-stream")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "This file is not a glTF, OBJ, IFC, USDZ, E57, LAS, or PLY."
