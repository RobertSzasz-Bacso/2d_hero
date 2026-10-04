"""Friendly errors and the desktop shortcut dry-run."""

import json
import subprocess
from pathlib import Path

from hero.jobs import execute_import
from hero.schema import blank_plan, dump_plan
from hero.testkit.building import build_building
from hero.testkit.writers import obj_bytes

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "install-shortcut.ps1"
BAD_FILE = (
    "This file could not be read. Export an OBJ, GLB, USDZ, PLY, E57, LAS, LAZ, "
    "or IFC file and try again."
)
CANCELLED = "Import was cancelled. The plan was not changed."


def test_missing_linked_path_is_a_sentence(client, token: str, tmp_path: Path) -> None:
    missing = tmp_path / "gone.glb"
    created = client.post(
        "/api/projects",
        json={"linkPath": str(missing)},
        headers={"X-Hero-Token": token},
    )
    detail = created.json()["detail"]
    assert created.status_code == 400
    assert detail == f"The linked file is missing: {missing}"
    assert "Traceback" not in created.text
    assert "FileNotFoundError" not in created.text
    assert missing.name in detail


def test_job_missing_link_is_a_sentence(client, token: str, tmp_path: Path) -> None:
    source = tmp_path / "scan.obj"
    source.write_bytes(obj_bytes(build_building(1)))
    created = client.post(
        "/api/projects",
        json={"linkPath": str(source), "name": "Linked"},
        headers={"X-Hero-Token": token},
    )
    assert created.status_code == 200
    source.unlink()
    started = client.post(
        f"/api/projects/{created.json()['id']}/jobs",
        json={"kind": "import", "units": "auto", "upAxis": "auto"},
        headers={"X-Hero-Token": token},
    )
    detail = started.json()["detail"]
    assert started.status_code == 400
    assert detail == f"The linked file is missing: {source.resolve()}"
    assert "Traceback" not in started.text
    assert "\n" not in detail


def test_bad_file_guess_is_a_sentence(client, token: str) -> None:
    created = client.post(
        "/api/projects",
        files={"file": ("notes.obj", b"this is not a model\n", "application/octet-stream")},
        headers={"X-Hero-Token": token},
    )
    assert created.status_code == 200
    guessed = client.get(
        f"/api/projects/{created.json()['id']}/guess",
        headers={"X-Hero-Token": token},
    )
    detail = guessed.json()["detail"]
    assert guessed.status_code == 400
    assert detail == BAD_FILE
    assert "Traceback" not in guessed.text


def test_bad_file_job_error_is_a_sentence(tmp_path: Path) -> None:
    folder = tmp_path / "project"
    folder.mkdir()
    (folder / "source.obj").write_text("this is not a model\n", encoding="utf-8")
    (folder / "project.json").write_text(
        json.dumps(
            {
                "name": "Bad",
                "createdAt": "2026-01-01T00:00:00+00:00",
                "sourceFileName": "source.obj",
                "linkedPath": None,
            }
        ),
        encoding="utf-8",
    )
    (folder / "plan.json").write_text(dump_plan(blank_plan("Bad")), encoding="utf-8")
    outcome = execute_import(str(folder), "auto", "auto")
    assert outcome["state"] == "error"
    assert outcome["error"] == BAD_FILE
    saved = json.loads((folder / "job.json").read_text(encoding="utf-8"))
    assert saved["error"] == BAD_FILE
    assert "Traceback" not in saved["error"]


def test_cancelled_job_explains_itself(tmp_path: Path) -> None:
    folder = tmp_path / "project"
    folder.mkdir()
    (folder / "source.obj").write_bytes(obj_bytes(build_building(1)))
    (folder / "project.json").write_text(
        json.dumps(
            {
                "name": "Cancel",
                "createdAt": "2026-01-01T00:00:00+00:00",
                "sourceFileName": "source.obj",
                "linkedPath": None,
            }
        ),
        encoding="utf-8",
    )
    (folder / "plan.json").write_text(dump_plan(blank_plan("Cancel")), encoding="utf-8")
    (folder / "job.cancel").write_text("1", encoding="utf-8")
    outcome = execute_import(str(folder), "auto", "auto")
    assert outcome["state"] == "cancelled"
    saved = json.loads((folder / "job.json").read_text(encoding="utf-8"))
    assert saved["error"] == CANCELLED
    assert "Traceback" not in saved["error"]


def test_shortcut_dry_run_targets_hero(tmp_path: Path) -> None:
    destination = tmp_path / "Desktop"
    destination.mkdir()
    completed = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(SCRIPT),
            "-Destination",
            str(destination),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr
    link = destination / "2D Hero.lnk"
    assert link.is_file()
    target, arguments, workdir = _read_shortcut(link)
    command = f"{target} {arguments}"
    assert "hero" in command.lower()
    assert "--no-browser" not in command
    assert Path(workdir).parts[-2:] == ("apps", "api")


def _read_shortcut(path: Path) -> tuple[str, str, str]:
    completed = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            (
                "$shell = New-Object -ComObject WScript.Shell; "
                f"$link = $shell.CreateShortcut('{path}'); "
                "Write-Output $link.TargetPath; "
                "Write-Output $link.Arguments; "
                "Write-Output $link.WorkingDirectory"
            ),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr
    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    assert len(lines) >= 3
    return lines[0], lines[1], lines[2]
