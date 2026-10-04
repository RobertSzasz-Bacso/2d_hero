"""Cursor key storage stays in the injected keyring and out of JSON and logs."""

import json
import logging
from pathlib import Path

from fastapi.testclient import TestClient

SECRET = "crsr_test_key_do_not_log"


def _headers(token: str) -> dict[str, str]:
    return {"X-Hero-Token": token}


def _app(tmp_path: Path, token: str):
    from hero.app import create_app

    config = tmp_path / "config"
    app = create_app(
        token=token,
        config_dir=config,
        projects_dir=tmp_path / "projects",
        session_file=tmp_path / ".session-token",
        open_file=lambda: None,
    )
    return app, config


def test_saving_the_cursor_key_does_not_log_or_return_it(
    tmp_path: Path, token: str, caplog, memory_keyring
) -> None:
    app, config = _app(tmp_path, token)
    with TestClient(app, base_url="http://127.0.0.1") as client:
        with caplog.at_level(logging.DEBUG):
            saved = client.put(
                "/api/settings/cursor-key",
                json={"key": SECRET},
                headers=_headers(token),
            )
        assert saved.status_code == 200
        assert saved.json() == {"cursorKeySet": True}
        assert SECRET not in saved.text
        assert SECRET not in caplog.text
        fetched = client.get("/api/settings", headers=_headers(token))
        assert fetched.status_code == 200
        body = fetched.json()
        assert body["cursorKeySet"] is True
        assert SECRET not in fetched.text
        assert "crsr_" not in fetched.text
        assert "keyLength" not in body
        assert "prefix" not in body
        assert "key" not in body
        settings_file = config / "settings.json"
        if settings_file.exists():
            assert SECRET not in settings_file.read_text(encoding="utf-8")
    assert memory_keyring.get_password("2D Hero", "cursor_api_key") == SECRET


def test_cursor_key_survives_a_new_app_process(tmp_path: Path, token: str) -> None:
    app, _config = _app(tmp_path, token)
    with TestClient(app, base_url="http://127.0.0.1") as first:
        saved = first.put(
            "/api/settings/cursor-key",
            json={"key": SECRET},
            headers=_headers(token),
        )
        assert saved.status_code == 200
        assert SECRET not in saved.text

    restarted, _config = _app(tmp_path, token)
    with TestClient(restarted, base_url="http://127.0.0.1") as second:
        fetched = second.get("/api/settings", headers=_headers(token))
        assert fetched.status_code == 200
        body = fetched.json()
        assert body["cursorKeySet"] is True
        assert SECRET not in json.dumps(body)


def test_remove_cursor_key(tmp_path: Path, token: str, memory_keyring) -> None:
    app, _config = _app(tmp_path, token)
    with TestClient(app, base_url="http://127.0.0.1") as client:
        client.put(
            "/api/settings/cursor-key",
            json={"key": SECRET},
            headers=_headers(token),
        )
        removed = client.delete("/api/settings/cursor-key", headers=_headers(token))
        assert removed.status_code == 200
        assert removed.json() == {"cursorKeySet": False}
        assert SECRET not in removed.text
        fetched = client.get("/api/settings", headers=_headers(token))
        assert fetched.json()["cursorKeySet"] is False
    assert memory_keyring.get_password("2D Hero", "cursor_api_key") is None


def test_invalid_key_body_does_not_echo_the_secret(tmp_path: Path, token: str, caplog) -> None:
    app, _config = _app(tmp_path, token)
    with TestClient(app, base_url="http://127.0.0.1") as client:
        with caplog.at_level(logging.DEBUG):
            response = client.put(
                "/api/settings/cursor-key",
                json={"key": [SECRET]},
                headers=_headers(token),
            )
        assert response.status_code == 422
        assert SECRET not in response.text
        assert SECRET not in caplog.text


def test_settings_round_trip_without_the_key(tmp_path: Path, token: str) -> None:
    app, config = _app(tmp_path, token)
    payload = {
        "dimensionUnit": "mm",
        "gridSpacingM": 0.25,
        "titleBlock": {
            "company": "North Studio",
            "project": "House",
            "address": "1 Road",
            "drawnBy": "A",
            "date": "2026-10-04",
            "sheetTitle": "Ground floor",
            "sheetNumber": "01",
            "revisionNote": "First",
        },
    }
    with TestClient(app, base_url="http://127.0.0.1") as client:
        saved = client.put("/api/settings", json=payload, headers=_headers(token))
        assert saved.status_code == 200
        body = saved.json()
        assert body["cursorKeySet"] is False
        assert body["dimensionUnit"] == "mm"
        assert body["gridSpacingM"] == 0.25
        assert body["titleBlock"]["company"] == "North Studio"
        assert SECRET not in saved.text

    restarted, _config = _app(tmp_path, token)
    with TestClient(restarted, base_url="http://127.0.0.1") as second:
        fetched = second.get("/api/settings", headers=_headers(token))
        assert fetched.json()["titleBlock"]["sheetTitle"] == "Ground floor"
        assert fetched.json()["dimensionUnit"] == "mm"
        assert fetched.json()["gridSpacingM"] == 0.25
    stored = (config / "settings.json").read_text(encoding="utf-8")
    assert "cursor_api_key" not in stored
    assert "crsr_" not in stored
