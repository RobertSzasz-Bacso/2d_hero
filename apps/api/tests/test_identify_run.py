"""Detect furniture runs in the background so no request is long.

A Cloudflare or Dev Tunnel cuts a request that runs about 100 s and answers with an HTML error
page. Cursor takes 50 to 120 s. ``POST /identify/start`` answers at once and the browser polls
``GET /api/identify/{id}``. The result is exactly what ``POST /identify`` would have returned.
"""

import base64
import io
import json
import threading
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from hero.keystore import set_cursor_key

SECRET = "crsr_test_key_do_not_log"
TOILET = json.dumps(
    {
        "fixtures": [
            {
                "symbol": "toilet",
                "nx": 0.5,
                "ny": 0.5,
                "width": 0.4,
                "depth": 0.7,
                "rotationDeg": 0,
                "confidence": 0.85,
            }
        ]
    }
)


def _headers(token: str) -> dict[str, str]:
    return {"X-Hero-Token": token}


def _shot_body() -> dict[str, Any]:
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (180, 140, 90)).save(buffer, format="PNG")
    return {
        "image": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "projection": [
            2.1445069205095586,
            0,
            0,
            0,
            0,
            2.1445069205095586,
            0,
            0,
            0,
            0,
            -1.002002002002002,
            -1,
            0,
            0,
            -0.20020020020020018,
            0,
        ],
        "matrixWorld": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 8, 1],
        "floorZ": 0.0,
    }


def _wall_plan() -> dict[str, Any]:
    return {
        "schemaVersion": 2,
        "units": "m",
        "revision": 0,
        "project": {"name": "Scan", "address": "", "northAngleDeg": 0},
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
        "detection": {"source": None, "issues": []},
        "levels": [
            {
                "id": "L1",
                "name": "Ground",
                "elevation": 0,
                "ceilingHeight": 2.7,
                "vertices": [{"id": "v1", "x": 0, "y": 0}, {"id": "v2", "x": 5, "y": 0}],
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


def _project(client: TestClient, token: str, tmp_path: Path) -> str:
    from hero.testkit.building import build_building
    from hero.testkit.writers import glb_bytes

    source = tmp_path / "source.glb"
    source.write_bytes(glb_bytes(build_building(1, furniture="bare")))
    created = client.post(
        "/api/projects",
        json={"linkPath": str(source), "name": "Scan"},
        headers=_headers(token),
    )
    assert created.status_code == 200
    project_id = created.json()["id"]
    saved = client.put(
        f"/api/projects/{project_id}/plan",
        json=_wall_plan(),
        headers={**_headers(token), "If-Match": "0"},
    )
    assert saved.status_code == 200
    return project_id


def _client(tmp_path: Path, token: str, see) -> TestClient:
    from hero.app import create_app

    app = create_app(
        token=token,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        session_file=tmp_path / ".session-token",
        open_file=lambda: None,
        see=see,
    )
    return TestClient(app, base_url="http://127.0.0.1")


def _wait_done(
    client: TestClient, token: str, run_id: str, seconds: float = 10.0
) -> dict[str, Any]:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        polled = client.get(f"/api/identify/{run_id}", headers=_headers(token))
        assert polled.status_code == 200
        body = polled.json()
        if body["state"] != "running":
            return body
        time.sleep(0.05)
    raise AssertionError("The run did not finish.")


def test_start_answers_at_once_and_the_result_arrives_by_polling(
    tmp_path: Path, token: str, memory_keyring
) -> None:
    del memory_keyring
    release = threading.Event()
    entered = threading.Event()

    def see(prompt: str, png: bytes, api_key: str) -> str:
        del prompt, png, api_key
        entered.set()
        release.wait(timeout=10)
        return TOILET

    set_cursor_key(SECRET)
    with _client(tmp_path, token, see) as client:
        project_id = _project(client, token, tmp_path)

        started_at = time.monotonic()
        started = client.post(
            f"/api/projects/{project_id}/identify/start",
            headers=_headers(token),
            json=_shot_body(),
        )
        elapsed = time.monotonic() - started_at

        assert started.status_code == 200
        assert started.json()["state"] == "running"
        assert elapsed < 2.0
        run_id = started.json()["id"]
        assert entered.wait(timeout=5)
        still = client.get(f"/api/identify/{run_id}", headers=_headers(token))
        assert still.status_code == 200
        assert still.json() == {"state": "running"}

        release.set()
        done = _wait_done(client, token, run_id)

    assert done["state"] == "done"
    assert done["status"] == 200
    assert done["body"]["cursorKeySet"] is True
    assert done["body"]["plan"]["levels"][0]["fixtures"][0]["symbol"] == "toilet"
    assert SECRET not in json.dumps(done)


def test_background_result_matches_the_direct_route(
    tmp_path: Path, token: str, memory_keyring
) -> None:
    del memory_keyring

    def see(prompt: str, png: bytes, api_key: str) -> str:
        del prompt, png, api_key
        return TOILET

    set_cursor_key(SECRET)
    with _client(tmp_path, token, see) as client:
        project_id = _project(client, token, tmp_path)
        direct = client.post(
            f"/api/projects/{project_id}/identify",
            headers=_headers(token),
            json=_shot_body(),
        )
        started = client.post(
            f"/api/projects/{project_id}/identify/start",
            headers=_headers(token),
            json=_shot_body(),
        )
        done = _wait_done(client, token, started.json()["id"])

    assert direct.status_code == 200
    assert done["status"] == direct.status_code
    direct_fixture = direct.json()["plan"]["levels"][0]["fixtures"]
    done_fixture = done["body"]["plan"]["levels"][0]["fixtures"]
    assert [item["symbol"] for item in done_fixture] == [item["symbol"] for item in direct_fixture]


def test_second_start_for_the_same_project_while_running_is_409(
    tmp_path: Path, token: str, memory_keyring
) -> None:
    del memory_keyring
    release = threading.Event()
    entered = threading.Event()

    def see(prompt: str, png: bytes, api_key: str) -> str:
        del prompt, png, api_key
        entered.set()
        release.wait(timeout=10)
        return TOILET

    set_cursor_key(SECRET)
    with _client(tmp_path, token, see) as client:
        project_id = _project(client, token, tmp_path)
        first = client.post(
            f"/api/projects/{project_id}/identify/start",
            headers=_headers(token),
            json=_shot_body(),
        )
        assert entered.wait(timeout=5)

        second = client.post(
            f"/api/projects/{project_id}/identify/start",
            headers=_headers(token),
            json=_shot_body(),
        )
        release.set()
        _wait_done(client, token, first.json()["id"])

    assert second.status_code == 409
    assert "already" in second.json()["detail"].lower()


def test_cursor_that_does_not_answer_is_reported_as_504_in_the_result(
    tmp_path: Path, token: str, memory_keyring
) -> None:
    del memory_keyring
    from hero.ai.session import ProposalError

    def see(prompt: str, png: bytes, api_key: str) -> str:
        del prompt, png, api_key
        raise ProposalError("Cursor did not answer.")

    set_cursor_key(SECRET)
    with _client(tmp_path, token, see) as client:
        project_id = _project(client, token, tmp_path)
        started = client.post(
            f"/api/projects/{project_id}/identify/start",
            headers=_headers(token),
            json=_shot_body(),
        )
        done = _wait_done(client, token, started.json()["id"])

    assert done["state"] == "done"
    assert done["status"] == 504
    assert done["body"]["detail"] == "Cursor did not answer."
    assert SECRET not in json.dumps(done)


def test_without_a_key_the_result_says_so_and_cursor_is_not_called(
    tmp_path: Path, token: str, memory_keyring
) -> None:
    del memory_keyring

    def see(prompt: str, png: bytes, api_key: str) -> str:
        del prompt, png, api_key
        raise AssertionError("Cursor must not run without a saved key")

    with _client(tmp_path, token, see) as client:
        project_id = _project(client, token, tmp_path)
        started = client.post(
            f"/api/projects/{project_id}/identify/start",
            headers=_headers(token),
            json=_shot_body(),
        )
        done = _wait_done(client, token, started.json()["id"])

    assert done["status"] == 200
    assert done["body"]["cursorKeySet"] is False


def test_an_unexpected_failure_is_a_clean_message_and_never_a_stack_trace(
    tmp_path: Path, token: str, memory_keyring
) -> None:
    del memory_keyring

    def see(prompt: str, png: bytes, api_key: str) -> str:
        del prompt, png
        raise RuntimeError(f"boom {api_key}")

    set_cursor_key(SECRET)
    with _client(tmp_path, token, see) as client:
        project_id = _project(client, token, tmp_path)
        started = client.post(
            f"/api/projects/{project_id}/identify/start",
            headers=_headers(token),
            json=_shot_body(),
        )
        done = _wait_done(client, token, started.json()["id"])

    assert done["state"] == "done"
    assert done["body"]["detail"] == "Cursor could not identify the furniture."
    assert SECRET not in json.dumps(done)
    assert "Traceback" not in json.dumps(done)


def test_unknown_run_is_404(tmp_path: Path, token: str, memory_keyring) -> None:
    del memory_keyring
    with _client(tmp_path, token, lambda prompt, png, key: TOILET) as client:
        polled = client.get(f"/api/identify/{'0' * 32}", headers=_headers(token))

    assert polled.status_code == 404


def test_unknown_project_is_404_and_starts_nothing(
    tmp_path: Path, token: str, memory_keyring
) -> None:
    del memory_keyring
    set_cursor_key(SECRET)
    with _client(tmp_path, token, lambda prompt, png, key: TOILET) as client:
        started = client.post(
            f"/api/projects/{'0' * 32}/identify/start",
            headers=_headers(token),
            json=_shot_body(),
        )

    assert started.status_code == 404


def test_polling_needs_the_session_token(tmp_path: Path, token: str, memory_keyring) -> None:
    del memory_keyring
    with _client(tmp_path, token, lambda prompt, png, key: TOILET) as client:
        polled = client.get(f"/api/identify/{'0' * 32}")

    assert polled.status_code in {401, 403}


@pytest.mark.parametrize("run_id", ["../x", "a" * 5, "Z" * 32, "0" * 33])
def test_a_malformed_run_id_is_404(tmp_path: Path, token: str, memory_keyring, run_id: str) -> None:
    del memory_keyring
    with _client(tmp_path, token, lambda prompt, png, key: TOILET) as client:
        polled = client.get(f"/api/identify/{run_id}", headers=_headers(token))

    assert polled.status_code == 404
