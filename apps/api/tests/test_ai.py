"""AI proposals validate through plan tools and stay unsaved until accept."""

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from hero.ai.agent import PlanAgent
from hero.keystore import set_cursor_key
from hero.testkit.building import build_building
from hero.testkit.writers import glb_bytes

SECRET = "crsr_test_key_do_not_log"
ENV_SECRET = "crsr_env_key_do_not_use"


def _headers(token: str) -> dict[str, str]:
    return {"X-Hero-Token": token}


def _wall_plan() -> dict[str, Any]:
    return {
        "schemaVersion": 2,
        "units": "m",
        "revision": 0,
        "project": {"name": "AI", "address": "", "northAngleDeg": 0},
        "sheet": {
            "paper": "A3",
            "orientation": "landscape",
            "scale": 50,
            "titleBlock": {
                "company": "",
                "project": "",
                "address": "",
                "drawnBy": "",
                "date": "",
                "sheetTitle": "",
                "sheetNumber": "",
                "revisionNote": "",
            },
        },
        "detection": {
            "source": None,
            "issues": [
                {
                    "id": "i1",
                    "severity": "warning",
                    "code": "assumed_thickness",
                    "message": "Thickness was assumed.",
                    "levelId": "L1",
                    "elementId": "w1",
                }
            ],
        },
        "levels": [
            {
                "id": "L1",
                "name": "Ground",
                "elevation": 0,
                "ceilingHeight": 2.7,
                "vertices": [
                    {"id": "v1", "x": 0, "y": 0},
                    {"id": "v2", "x": 5, "y": 0},
                ],
                "walls": [
                    {
                        "id": "w1",
                        "a": "v1",
                        "b": "v2",
                        "thickness": 0.2,
                        "kind": "exterior",
                        "confidence": 1,
                    }
                ],
                "openings": [],
                "columns": [],
                "stairs": [],
                "rooms": [],
                "separators": [],
                "fixtures": [],
                "texts": [],
                "dimensions": [],
                "suppressedAutoDimensions": [],
            }
        ],
    }


class ScriptedAgent:
    """Calls plan tools in-process. It does not import the Cursor SDK."""

    def __init__(self, calls: list[dict[str, Any]]) -> None:
        self.calls = calls
        self.seen_keys: list[str] = []

    def propose(self, project_dir: Path, instruction: str, api_key: str) -> list[dict[str, Any]]:
        from hero.ai.session import ProposalError, ToolSession

        self.seen_keys.append(api_key)
        session = ToolSession.open(project_dir)
        for call in self.calls:
            result = session.call(str(call["name"]), dict(call["arguments"]))
            if not result["ok"]:
                raise ProposalError(str(result["error"]))
        return list(session.ops)


def _app(tmp_path: Path, token: str, agent: PlanAgent | None):
    from hero.app import create_app

    app = create_app(
        token=token,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        session_file=tmp_path / ".session-token",
        open_file=lambda: None,
        agent=agent,
    )
    return app


def _project(client: TestClient, token: str, tmp_path: Path) -> tuple[str, Path]:
    source = tmp_path / "source.glb"
    source.write_bytes(glb_bytes(build_building(1, furniture="bare")))
    created = client.post(
        "/api/projects",
        json={"linkPath": str(source), "name": "AI"},
        headers=_headers(token),
    )
    assert created.status_code == 200
    project_id = created.json()["id"]
    folder = Path(created.json()["folder"])
    plan = _wall_plan()
    saved = client.put(
        f"/api/projects/{project_id}/plan",
        json=plan,
        headers={**_headers(token), "If-Match": "0"},
    )
    assert saved.status_code == 200
    return project_id, folder


def _thickness(folder: Path) -> float:
    plan = json.loads((folder / "plan.json").read_text(encoding="utf-8"))
    return float(plan["levels"][0]["walls"][0]["thickness"])


def test_fake_agent_proposal_is_not_saved_until_accept(
    tmp_path: Path, token: str, memory_keyring
) -> None:
    agent = ScriptedAgent(
        [
            {
                "name": "set_wall_thickness",
                "arguments": {"levelId": "L1", "wallId": "w1", "thickness": 0.35},
            }
        ]
    )
    app = _app(tmp_path, token, agent)
    set_cursor_key(SECRET)
    with TestClient(app, base_url="http://127.0.0.1") as client:
        project_id, folder = _project(client, token, tmp_path)
        before = (folder / "plan.json").read_bytes()
        proposed = client.post(
            f"/api/projects/{project_id}/ai/propose",
            json={"instruction": "Set wall w1 to 0.35 m"},
            headers=_headers(token),
        )
        assert proposed.status_code == 200
        body = proposed.json()
        assert body["cursorKeySet"] is True
        assert body["ops"] == [
            {"op": "set_wall_thickness", "levelId": "L1", "wallId": "w1", "thickness": 0.35}
        ]
        assert SECRET not in proposed.text
        assert (folder / "plan.json").read_bytes() == before
        assert _thickness(folder) == 0.2
        assert (folder / "review" / "plan.svg").is_file()
        assert (folder / "review" / "underlay.png").is_file()
        assert "review/plan.svg" not in (folder / "plan.json").read_text(encoding="utf-8")

        rejected = client.post(
            f"/api/projects/{project_id}/ai/reject",
            headers=_headers(token),
        )
        assert rejected.status_code == 200
        assert _thickness(folder) == 0.2
        assert (folder / "plan.json").read_bytes() == before

        again = client.post(
            f"/api/projects/{project_id}/ai/propose",
            json={"instruction": "Set wall w1 to 0.35 m"},
            headers=_headers(token),
        )
        assert again.status_code == 200
        accepted = client.post(
            f"/api/projects/{project_id}/ai/accept",
            headers=_headers(token),
        )
        assert accepted.status_code == 200
        saved = accepted.json()
        assert saved["revision"] == 2
        assert saved["levels"][0]["walls"][0]["thickness"] == 0.35
        assert _thickness(folder) == 0.35
        assert SECRET not in accepted.text
    assert memory_keyring.get_password("2D Hero", "cursor_api_key") == SECRET
    assert agent.seen_keys == [SECRET, SECRET]


def test_bad_wall_id_returns_an_error_and_does_not_change_the_proposal(
    tmp_path: Path, token: str
) -> None:
    from hero.ai.session import ToolSession

    app = _app(
        tmp_path,
        token,
        ScriptedAgent(
            [
                {
                    "name": "set_wall_thickness",
                    "arguments": {"levelId": "L1", "wallId": "missing", "thickness": 0.4},
                }
            ]
        ),
    )
    set_cursor_key(SECRET)
    with TestClient(app, base_url="http://127.0.0.1") as client:
        project_id, folder = _project(client, token, tmp_path)
        session = ToolSession.open(folder)
        good = session.call(
            "set_wall_thickness",
            {"levelId": "L1", "wallId": "w1", "thickness": 0.3},
        )
        assert good["ok"] is True
        bad = session.call(
            "set_wall_thickness",
            {"levelId": "L1", "wallId": "missing", "thickness": 0.4},
        )
        assert bad["ok"] is False
        assert bad["error"] == "Unknown wall missing"
        assert session.ops == [
            {"op": "set_wall_thickness", "levelId": "L1", "wallId": "w1", "thickness": 0.3}
        ]
        assert _thickness(folder) == 0.2
        assert not (folder / "plan.json").read_text(encoding="utf-8").count('"thickness": 0.3')

        proposed = client.post(
            f"/api/projects/{project_id}/ai/propose",
            json={"instruction": "missing wall"},
            headers=_headers(token),
        )
        assert proposed.status_code == 200
        body = proposed.json()
        assert body["ops"] == []
        assert body["error"] == "Unknown wall missing"
        assert SECRET not in proposed.text
        accepted = client.post(
            f"/api/projects/{project_id}/ai/accept",
            headers=_headers(token),
        )
        assert accepted.status_code == 400
        assert _thickness(folder) == 0.2


def test_cursor_key_never_appears_in_logs_or_http(
    tmp_path: Path, token: str, caplog, monkeypatch
) -> None:
    monkeypatch.setenv("CURSOR_API_KEY", ENV_SECRET)
    agent = ScriptedAgent(
        [
            {
                "name": "set_wall_thickness",
                "arguments": {"levelId": "L1", "wallId": "w1", "thickness": 0.25},
            }
        ]
    )
    app = _app(tmp_path, token, agent)
    set_cursor_key(SECRET)
    with TestClient(app, base_url="http://127.0.0.1") as client:
        project_id, _folder = _project(client, token, tmp_path)
        with caplog.at_level(logging.DEBUG):
            proposed = client.post(
                f"/api/projects/{project_id}/ai/propose",
                json={"instruction": SECRET},
                headers=_headers(token),
            )
            accepted = client.post(
                f"/api/projects/{project_id}/ai/accept",
                headers=_headers(token),
            )
            settings = client.get("/api/settings", headers=_headers(token))
        assert proposed.status_code == 200
        assert accepted.status_code == 200
        assert settings.status_code == 200
        for response in (proposed, accepted, settings):
            assert SECRET not in response.text
            assert ENV_SECRET not in response.text
            assert "crsr_" not in response.text
        assert SECRET not in caplog.text
        assert ENV_SECRET not in caplog.text
        assert agent.seen_keys == [SECRET]
    assert "cursor_sdk" not in sys.modules


def test_mcp_exposes_the_plan_tools() -> None:
    from hero.mcp.server import tool_names

    assert tool_names() == {
        "apply_ops",
        "get_plan",
        "list_issues",
        "move_wall",
        "set_opening",
        "set_room_name",
        "set_wall_thickness",
    }


def test_missing_key_ignores_the_environment_and_stays_off(
    tmp_path: Path, token: str, caplog, monkeypatch
) -> None:
    monkeypatch.setenv("CURSOR_API_KEY", ENV_SECRET)

    class Boom:
        def propose(
            self, project_dir: Path, instruction: str, api_key: str
        ) -> list[dict[str, Any]]:
            del project_dir, instruction, api_key
            raise AssertionError("agent must not run without a keyring key")

    app = _app(tmp_path, token, Boom())
    with TestClient(app, base_url="http://127.0.0.1") as client:
        project_id, folder = _project(client, token, tmp_path)
        before = (folder / "plan.json").read_bytes()
        with caplog.at_level(logging.DEBUG):
            proposed = client.post(
                f"/api/projects/{project_id}/ai/propose",
                json={"instruction": "thicken the wall"},
                headers=_headers(token),
            )
        assert proposed.status_code == 200
        body = proposed.json()
        assert body["cursorKeySet"] is False
        assert body["ops"] == []
        assert "Settings" in body["detail"]
        assert ENV_SECRET not in proposed.text
        assert ENV_SECRET not in caplog.text
        assert "CURSOR_API_KEY" not in caplog.text
        assert (folder / "plan.json").read_bytes() == before
        assert os.environ["CURSOR_API_KEY"] == ENV_SECRET


def test_bridge_discovery_can_be_read_from_a_pipe() -> None:
    import json
    import subprocess

    import pytest

    pytest.importorskip("cursor_sdk")
    import cursor_sdk._bridge as bridge

    from hero.ai.agent import use_pipe_wait

    payload = json.dumps({"url": "http://127.0.0.1:9", "authToken": "token"})
    prefix = bridge.READY_LINE_PREFIX
    script = (
        "import sys\n"
        f"sys.stderr.write({prefix + payload + chr(10)!r})\n"
        "sys.stderr.flush()\n"
    )
    process = subprocess.Popen(
        [sys.executable, "-c", script],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        with use_pipe_wait():
            discovery = bridge._read_discovery(process, timeout=2)
    finally:
        process.wait(timeout=2)
    assert discovery["url"] == "http://127.0.0.1:9"


def test_cursor_ask_returns_the_reply_and_hides_the_key(tmp_path: Path, token: str) -> None:
    from hero.app import create_app
    from hero.keystore import set_cursor_key

    set_cursor_key(SECRET)
    app = create_app(
        token=token,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        session_file=tmp_path / ".session-token",
        open_file=lambda: None,
        ask=lambda message, api_key: f"heard {message}",
    )
    with TestClient(app, base_url="http://127.0.0.1") as client:
        response = client.post(
            "/api/cursor/ask",
            json={"message": "hello"},
            headers=_headers(token),
        )
    assert response.status_code == 200
    assert response.json() == {"cursorKeySet": True, "reply": "heard hello"}
    assert SECRET not in response.text
