"""Learned cleanup returns a schema-valid plan and does not download a model."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from hero.cleanup import DeterministicCleanup, LearnedCleanup, ScriptedCleanup
from hero.main import create_app
from hero.schema import Annotation, Plan, Vertex, Wall


def _gapped() -> Plan:
    return Plan(
        vertices=[
            Vertex(id="v1", x=0, y=0),
            Vertex(id="v2", x=1.85, y=0.04),
            Vertex(id="v3", x=2, y=0),
            Vertex(id="v4", x=2, y=2),
        ],
        walls=[Wall(id="w1", a="v1", b="v2"), Wall(id="w2", a="v3", b="v4")],
        annotations=[Annotation(id="a1", x=0.2, y=0.2, text="Hall")],
    )


def test_deterministic_cleanup_snaps_and_closes_the_gap():
    cleaned = DeterministicCleanup().clean(_gapped())
    assert isinstance(cleaned, Plan)
    assert cleaned.annotations[0].text == "Hall"
    assert len(cleaned.vertices) == 3
    by_id = {vertex.id: vertex for vertex in cleaned.vertices}
    horizontal = [
        wall
        for wall in cleaned.walls
        if by_id[wall.a].y == pytest.approx(by_id[wall.b].y)
        and abs(by_id[wall.a].x - by_id[wall.b].x) > 1
    ]
    assert horizontal


def test_scripted_cleanup_must_match_the_schema():
    valid = {
        "units": "m",
        "vertices": [{"id": "v1", "x": 0, "y": 0}, {"id": "v2", "x": 3, "y": 0}],
        "walls": [{"id": "w1", "a": "v1", "b": "v2"}],
        "annotations": [],
    }
    assert ScriptedCleanup(valid).clean(Plan()).walls[0].id == "w1"
    with pytest.raises(ValidationError):
        ScriptedCleanup({"units": "ft", "vertices": []}).clean(Plan())


def test_learned_cleanup_uses_a_local_fixture_and_does_not_download(tmp_path, monkeypatch):
    monkeypatch.delenv("HERO_CLEANUP_MODEL", raising=False)

    def blocked(*_args, **_kwargs):
        raise AssertionError("cleanup tried to use the network")

    monkeypatch.setattr("socket.socket", blocked)
    offline = LearnedCleanup().clean(_gapped())
    assert offline.annotations[0].text == "Hall"

    fixture = tmp_path / "cleanup-model.json"
    fixture.write_text(
        Plan(
            vertices=[Vertex(id="v9", x=0, y=0), Vertex(id="v8", x=1, y=0)],
            walls=[Wall(id="w9", a="v9", b="v8")],
        ).model_dump_json()
    )
    monkeypatch.setenv("HERO_CLEANUP_MODEL", str(fixture))
    loaded = LearnedCleanup().clean(Plan())
    assert loaded.walls[0].id == "w9"

    fixture.write_text('{"units": "ft"}')
    with pytest.raises(ValidationError):
        LearnedCleanup().clean(Plan())


def test_cleanup_route_uses_the_injected_double(tmp_path):
    app = create_app(
        data_dir=tmp_path,
        cleanup=ScriptedCleanup(
            {
                "units": "m",
                "vertices": [{"id": "v1", "x": 0, "y": 0}, {"id": "v2", "x": 2, "y": 0}],
                "walls": [{"id": "w1", "a": "v1", "b": "v2"}],
                "annotations": [{"id": "a1", "x": 1, "y": 0, "text": "Hall"}],
            }
        ),
    )
    client = TestClient(app)
    project_id = _project(client)
    revised = client.post(f"/api/projects/{project_id}/cleanup")
    assert revised.status_code == 200, revised.text
    assert revised.json()["annotations"][0]["text"] == "Hall"

    bad = create_app(data_dir=tmp_path / "bad", cleanup=ScriptedCleanup({"units": "ft", "vertices": []}))
    bad_client = TestClient(bad)
    rejected = bad_client.post(f"/api/projects/{_project(bad_client)}/cleanup")
    assert rejected.status_code == 422


def _project(client: TestClient) -> str:
    created = client.post(
        "/api/projects",
        files={"file": ("box.obj", b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", "text/plain")},
    )
    assert created.status_code == 200, created.text
    project_id = created.json()["id"]
    saved = client.put(
        f"/api/projects/{project_id}/plan",
        json={"units": "m", "vertices": [{"id": "v1", "x": 0, "y": 0}, {"id": "v2", "x": 1, "y": 0}], "walls": [{"id": "w1", "a": "v1", "b": "v2"}], "annotations": []},
    )
    assert saved.status_code == 200, saved.text
    return project_id
