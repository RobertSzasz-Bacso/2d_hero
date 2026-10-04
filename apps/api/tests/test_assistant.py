"""AI cleanup accepts only a schema-valid plan and never calls Cursor in tests."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from hero.assistant import CursorSdkAssistant, ScriptedAssistant
from hero.main import create_app
from hero.schema import Plan


def test_scripted_patch_must_match_the_schema():
    valid = {
        "units": "m",
        "vertices": [{"id": "v1", "x": 0, "y": 0}, {"id": "v2", "x": 2, "y": 0}],
        "walls": [{"id": "w1", "a": "v1", "b": "v2"}],
        "annotations": [{"id": "a1", "x": 1, "y": 0.5, "text": "Hall"}],
    }
    plan = ScriptedAssistant(valid).revise(Plan(), "label the hall")
    assert plan.annotations[0].text == "Hall"

    with pytest.raises(ValidationError):
        ScriptedAssistant(
            {"units": "m", "vertices": [], "walls": [{"id": "w1", "a": "missing", "b": "no"}]}
        ).revise(Plan(), "break it")


def test_ai_route_uses_the_injected_assistant_and_rejects_a_bad_patch(tmp_path):
    good = create_app(
        data_dir=tmp_path / "good",
        assistant=ScriptedAssistant(
            {
                "units": "m",
                "vertices": [{"id": "v1", "x": 0, "y": 0}, {"id": "v2", "x": 1, "y": 0}],
                "walls": [{"id": "w1", "a": "v1", "b": "v2"}],
                "annotations": [{"id": "a1", "x": 0.2, "y": 0.2, "text": "Hall"}],
            }
        ),
    )
    client = TestClient(good)
    project_id = _project_with_plan(client)
    revised = client.post(f"/api/projects/{project_id}/ai", json={"instruction": "label the hall"})
    assert revised.status_code == 200, revised.text
    assert revised.json()["annotations"][0]["text"] == "Hall"

    bad = create_app(
        data_dir=tmp_path / "bad",
        assistant=ScriptedAssistant({"units": "ft", "vertices": []}),
    )
    bad_client = TestClient(bad)
    project_id = _project_with_plan(bad_client)
    rejected = bad_client.post(f"/api/projects/{project_id}/ai", json={"instruction": "use feet"})
    assert rejected.status_code == 422


def test_live_assistant_does_not_run_without_a_key(monkeypatch):
    monkeypatch.delenv("CURSOR_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="CURSOR_API_KEY"):
        CursorSdkAssistant().revise(Plan(), "straighten the walls")


def _project_with_plan(client: TestClient) -> str:
    created = client.post(
        "/api/projects",
        files={"file": ("box.obj", b"v 0 0 0\nv 1 0 0\nv 1 0 1\nv 0 0 1\nf 1 2 3 4\n", "text/plain")},
    )
    # A real mesh is unnecessary: save a plan directly after upload.
    assert created.status_code == 200, created.text
    project_id = created.json()["id"]
    saved = client.put(
        f"/api/projects/{project_id}/plan",
        json={
            "units": "m",
            "vertices": [{"id": "v1", "x": 0, "y": 0}, {"id": "v2", "x": 1, "y": 0}],
            "walls": [{"id": "w1", "a": "v1", "b": "v2"}],
            "annotations": [],
        },
    )
    assert saved.status_code == 200, saved.text
    return project_id
