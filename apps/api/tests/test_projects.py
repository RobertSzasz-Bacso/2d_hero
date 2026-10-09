"""Project folders, atomic plan writes, revision conflicts, and the recent list."""

import json
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[3]


def _headers(token: str) -> dict[str, str]:
    return {"X-Hero-Token": token}


def _no_dialog() -> str | None:
    raise AssertionError("Tests must not open a native file dialog.")


def _make_app(tmp_path: Path, token: str, *, open_file=_no_dialog):
    from hero.app import create_app

    projects = tmp_path / "projects"
    config = tmp_path / "config"
    app = create_app(
        token=token,
        config_dir=config,
        projects_dir=projects,
        session_file=tmp_path / ".session-token",
        open_file=open_file,
    )
    return app, projects, config


def _client(tmp_path: Path, token: str, *, open_file=_no_dialog):
    app, projects, config = _make_app(tmp_path, token, open_file=open_file)
    return TestClient(app, base_url="http://127.0.0.1"), projects, config


@pytest.mark.parametrize("suffix", [".ifc", ".obj", ".ply"])
def test_non_glb_sources_are_rejected_without_creating_a_project(
    tmp_path: Path, token: str, suffix: str
) -> None:
    source = tmp_path / f"model{suffix}"
    source.write_bytes(b"not a GLB")
    client, projects, _config = _client(tmp_path, token)
    with client:
        linked = client.post(
            "/api/projects",
            json={"linkPath": str(source), "name": "Unsupported"},
            headers=_headers(token),
        )
        uploaded = client.post(
            "/api/projects",
            files={"file": (source.name, source.read_bytes(), "application/octet-stream")},
            headers=_headers(token),
        )

    for response in (linked, uploaded):
        assert response.status_code == 400
        assert response.json()["detail"] == "Only GLB files are supported."
    assert not projects.exists() or not list(projects.iterdir())


def test_save_reload_and_revision_conflict(tmp_path: Path, token: str) -> None:
    source = tmp_path / "scan.glb"
    source.write_bytes(b"glb")
    client, projects, _config = _client(tmp_path, token)
    with client:
        created = client.post(
            "/api/projects",
            json={"linkPath": str(source), "name": "House"},
            headers=_headers(token),
        )
        assert created.status_code == 200
        body = created.json()
        project_id = body["id"]
        assert body["linkedPath"]
        assert Path(body["folder"]).is_relative_to(projects)
        assert not any((projects / project_id).glob("source.*"))

        loaded = client.get(f"/api/projects/{project_id}/plan", headers=_headers(token))
        assert loaded.status_code == 200
        plan = loaded.json()
        assert plan["revision"] == 0
        assert plan["project"]["name"] == "House"

        plan["project"]["name"] = "House renamed"
        plan["revision"] = 99
        saved = client.put(
            f"/api/projects/{project_id}/plan",
            json=plan,
            headers={**_headers(token), "If-Match": "0"},
        )
        assert saved.status_code == 200
        assert saved.json()["revision"] == 1
        assert saved.json()["project"]["name"] == "House renamed"

        reloaded = client.get(f"/api/projects/{project_id}/plan", headers=_headers(token))
        assert reloaded.json()["revision"] == 1
        assert reloaded.json()["project"]["name"] == "House renamed"

        conflict = client.put(
            f"/api/projects/{project_id}/plan",
            json=plan,
            headers={**_headers(token), "If-Match": "0"},
        )
        assert conflict.status_code == 409
        assert conflict.json()["plan"]["revision"] == 1
        assert conflict.json()["plan"]["project"]["name"] == "House renamed"
        on_disk = json.loads((projects / project_id / "plan.json").read_text(encoding="utf-8"))
        assert on_disk["revision"] == 1


def test_failed_replace_leaves_the_previous_plan_readable(tmp_path: Path, monkeypatch) -> None:
    from hero.schema import Plan

    source = tmp_path / "scan.glb"
    source.write_bytes(b"glb")
    from hero.projects import ProjectStore

    store = ProjectStore(projects_dir=tmp_path / "projects", config_dir=tmp_path / "config")
    created = store.create_linked(str(source), name="House")
    plan_path = store.project_dir(created.id) / "plan.json"
    original = plan_path.read_text(encoding="utf-8")
    real_replace = os.replace

    def fail_plan_replace(src, dst) -> None:
        if Path(dst).name == "plan.json":
            raise OSError("replace failed")
        real_replace(src, dst)

    monkeypatch.setattr("hero.atomic.os.replace", fail_plan_replace)
    plan = store.read_plan(created.id)
    plan.project.name = "Changed"
    with pytest.raises(OSError):
        store.save_plan(created.id, plan, if_match=0)

    reread = plan_path.read_text(encoding="utf-8")
    assert reread == original
    assert Plan.model_validate_json(reread).project.name == "House"
    assert Plan.model_validate_json(reread).revision == 0


def test_legacy_empty_import_shell_is_not_shown_as_a_floor_plan(tmp_path: Path) -> None:
    from hero.projects import ProjectStore
    from hero.schema import DetectionSource, Issue, Level, blank_plan, dump_plan

    source = tmp_path / "scan.glb"
    source.write_bytes(b"glb")
    store = ProjectStore(projects_dir=tmp_path / "projects", config_dir=tmp_path / "config")
    created = store.create_linked(str(source), name="House")
    folder = store.project_dir(created.id)
    plan = blank_plan("House")
    plan.levels = [Level(id="L1", name="Level 1", elevation=0, ceilingHeight=2.7)]
    plan.detection = plan.detection.model_copy(
        update={
            "source": DetectionSource(
                filename="scan.glb",
                format="glb",
                unitScaleToMeters=1,
                upAxis="z",
                manhattanAngleDeg=0,
                linked=True,
            ),
            "issues": [
                Issue(
                    id="issue-1",
                    severity="warning",
                    code="ceiling_missing",
                    message="No ceiling was found.",
                )
            ],
        }
    )
    (folder / "plan.json").write_text(dump_plan(plan), encoding="utf-8")

    cleaned = store.read_plan(created.id)

    assert cleaned.levels == []
    assert cleaned.detection.issues == []


def test_previous_plan_and_twenty_snapshots(tmp_path: Path, token: str) -> None:
    source = tmp_path / "scan.glb"
    source.write_bytes(b"glb")
    client, projects, _config = _client(tmp_path, token)
    with client:
        created = client.post(
            "/api/projects",
            json={"linkPath": str(source), "name": "House"},
            headers=_headers(token),
        )
        project_id = created.json()["id"]
        folder = projects / project_id
        plan = client.get(f"/api/projects/{project_id}/plan", headers=_headers(token)).json()
        for revision in range(21):
            plan["project"]["name"] = f"Save {revision}"
            response = client.put(
                f"/api/projects/{project_id}/plan",
                json=plan,
                headers={**_headers(token), "If-Match": str(revision)},
            )
            assert response.status_code == 200
            plan = response.json()
        previous = json.loads((folder / "plan.prev.json").read_text(encoding="utf-8"))
        assert previous["revision"] == 20
        current = json.loads((folder / "plan.json").read_text(encoding="utf-8"))
        assert current["revision"] == 21
        archived = sorted(int(path.stem) for path in (folder / "revisions").glob("*.json"))
        assert archived == list(range(1, 21))


def test_recent_list_drops_a_missing_folder(tmp_path: Path, token: str) -> None:
    client, projects, config = _client(tmp_path, token)
    ids: list[str] = []
    with client:
        for name in ("One", "Two", "Three"):
            source = tmp_path / f"{name}.glb"
            source.write_bytes(b"glb")
            created = client.post(
                "/api/projects",
                json={"linkPath": str(source), "name": name},
                headers=_headers(token),
            )
            assert created.status_code == 200
            ids.append(created.json()["id"])
        listed = client.get("/api/projects", headers=_headers(token))
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()] == [ids[2], ids[1], ids[0]]

        import shutil

        shutil.rmtree(projects / ids[1])
        remaining = client.get("/api/projects", headers=_headers(token))
        assert [item["id"] for item in remaining.json()] == [ids[2], ids[0]]
        saved = (config / "recent.json").read_text(encoding="utf-8")
        assert ids[1] not in saved


def test_small_upload_is_copied_into_the_project(tmp_path: Path, token: str) -> None:
    client, projects, _config = _client(tmp_path, token)
    with client:
        created = client.post(
            "/api/projects",
            files={"file": ("room.glb", b"glb-bytes", "model/gltf-binary")},
            data={"name": "Uploaded"},
            headers=_headers(token),
        )
        assert created.status_code == 200
        body = created.json()
        assert body["linkedPath"] is None
        assert body["sourceFileName"] == "room.glb"
        folder = projects / body["id"]
        assert (folder / "source.glb").read_bytes() == b"glb-bytes"
        assert folder.is_relative_to(projects)


def test_upload_over_200_mb_is_rejected_without_a_copy(
    tmp_path: Path, token: str, monkeypatch
) -> None:
    monkeypatch.setattr("hero.projects.MAX_COPY_BYTES", 4)
    client, projects, _config = _client(tmp_path, token)
    with client:
        created = client.post(
            "/api/projects",
                files={"file": ("big.glb", b"12345", "application/octet-stream")},
            headers=_headers(token),
        )
        assert created.status_code == 400
        assert "Link" in created.json()["detail"]
        assert list(projects.glob("*")) == []


def test_copy_limit_is_200_megabytes() -> None:
    from hero.projects import MAX_COPY_BYTES

    assert MAX_COPY_BYTES == 200 * 1024 * 1024


def test_missing_link_is_400(tmp_path: Path, token: str) -> None:
    missing = tmp_path / "gone.glb"
    client, projects, _config = _client(tmp_path, token)
    with client:
        created = client.post(
            "/api/projects",
            json={"linkPath": str(missing)},
            headers=_headers(token),
        )
        assert created.status_code == 400
        assert created.json()["detail"] == f"The linked file is missing: {missing}"
        assert list(projects.glob("*")) == []


def test_open_file_dialog_returns_the_stubbed_path(tmp_path: Path, token: str) -> None:
    chosen = tmp_path / "scan.glb"
    chosen.write_bytes(b"glb")
    client, _projects, _config = _client(tmp_path, token, open_file=lambda: str(chosen))
    with client:
        opened = client.post("/api/dialogs/open-file", headers=_headers(token))
        assert opened.status_code == 200
        assert opened.json() == {"path": str(chosen)}


def test_delete_removes_the_folder_and_keeps_the_linked_file(tmp_path: Path, token: str) -> None:
    source = tmp_path / "scan.glb"
    source.write_bytes(b"glb")
    client, projects, _config = _client(tmp_path, token)
    with client:
        created = client.post(
            "/api/projects",
            json={"linkPath": str(source), "name": "House"},
            headers=_headers(token),
        )
        project_id = created.json()["id"]
        deleted = client.delete(f"/api/projects/{project_id}", headers=_headers(token))
        assert deleted.status_code == 200
        assert deleted.json() == {"deleted": True}
        assert not (projects / project_id).exists()
        assert source.is_file()
        listed = client.get("/api/projects", headers=_headers(token))
        assert listed.json() == []


def test_delete_unknown_project_is_404(tmp_path: Path, token: str) -> None:
    client, _projects, _config = _client(tmp_path, token)
    with client:
        deleted = client.delete("/api/projects/" + "ab" * 16, headers=_headers(token))
        assert deleted.status_code == 404
        assert deleted.json()["detail"] == "Project was not found."


def test_delete_is_refused_while_an_import_is_running(tmp_path: Path, token: str) -> None:
    source = ROOT / "fixtures" / "synthetic" / "building.glb"
    client, projects, _config = _client(tmp_path, token)
    with client:
        created = client.post(
            "/api/projects",
            json={"linkPath": str(source), "name": "Held"},
            headers=_headers(token),
        )
        project_id = created.json()["id"]
        folder = projects / project_id
        (folder / "job.hold").write_text("1", encoding="utf-8")
        (folder / "job.cancel").write_text("1", encoding="utf-8")
        started = client.post(
            f"/api/projects/{project_id}/jobs",
            json={"kind": "import", "units": "auto", "upAxis": "auto"},
            headers=_headers(token),
        )
        assert started.status_code == 200
        assert not (folder / "job.cancel").exists()
        refused = client.delete(f"/api/projects/{project_id}", headers=_headers(token))
        assert refused.status_code == 409
        assert refused.json()["detail"] == "An import is running for this project."
        assert folder.is_dir()
        (folder / "job.cancel").write_text("1", encoding="utf-8")
        (folder / "job.hold").unlink(missing_ok=True)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            job_path = folder / "job.json"
            text = job_path.read_text(encoding="utf-8") if job_path.is_file() else ""
            if any(state in text for state in ('"cancelled"', '"done"', '"error"')):
                break
            time.sleep(0.05)


def test_project_reports_import_state(tmp_path: Path, token: str) -> None:
    source = tmp_path / "scan.glb"
    source.write_bytes(b"glb")
    client, projects, _config = _client(tmp_path, token)
    with client:
        created = client.post(
            "/api/projects",
            json={"linkPath": str(source), "name": "House"},
            headers=_headers(token),
        )
        project_id = created.json()["id"]
        assert created.json()["importState"] == "none"
        folder = projects / project_id
        (folder / "job.json").write_text(
            json.dumps({"state": "done", "stage": "preview", "progress": 100, "error": ""}),
            encoding="utf-8",
        )
        done = client.get(f"/api/projects/{project_id}", headers=_headers(token))
        assert done.json()["importState"] == "done"
        (folder / "job.json").write_text(
            json.dumps(
                {
                    "state": "error",
                    "stage": "ingest",
                    "progress": 0,
                    "error": "The import failed. The plan was not changed.",
                }
            ),
            encoding="utf-8",
        )
        failed = client.get("/api/projects", headers=_headers(token))
        assert failed.json()[0]["importState"] == "error"
        assert failed.json()[0]["importError"]
        (folder / "job.json").write_text(
            json.dumps({"state": "running", "stage": "ingest", "progress": 10, "error": ""}),
            encoding="utf-8",
        )
        interrupted = client.get(f"/api/projects/{project_id}", headers=_headers(token))
        assert interrupted.json()["importState"] == "error"
        assert interrupted.json()["importError"] == "The import was interrupted."


def test_cancelled_dialog_is_400(tmp_path: Path, token: str) -> None:
    client, _projects, _config = _client(tmp_path, token, open_file=lambda: None)
    with client:
        opened = client.post("/api/dialogs/open-file", headers=_headers(token))
        assert opened.status_code == 400
        assert opened.json()["detail"]
