"""One heavy import at a time, in a single worker process."""

import json
import logging
import threading
import time
import uuid
from concurrent.futures import Future, ProcessPoolExecutor
from pathlib import Path

from hero.atomic import atomic_write_text
from hero.errors import CANCELLED, IMPORT_FAILED, UNREADABLE, UnreadableFile
from hero.ingest.read import read_source
from hero.ingest.scene import RawScene
from hero.pipeline.cloud import write_cloud
from hero.pipeline.normalize import normalize_scene
from hero.pipeline.planwrite import write_shell_plan
from hero.pipeline.preview import write_preview
from hero.pipeline.underlay import write_underlays
from hero.projects import LinkedFileMissing

logger = logging.getLogger("hero.jobs")

_lock = threading.Lock()
_executor: ProcessPoolExecutor | None = None
_folders: dict[str, Path] = {}
_futures: dict[str, Future[dict[str, str]]] = {}


class JobBusy(Exception):
    """A second heavy job was asked for while one is running."""


def execute_import(project_dir: str, units: str, up_axis: str) -> dict[str, str]:
    """Run ingest through preview. Cancel between stages does not write the plan."""
    folder = Path(project_dir)
    if _cancelled(folder):
        _write_state(folder, "cancelled", "ingest", 0, "")
        return {"state": "cancelled"}
    try:
        source = source_file(folder)
        if _stop(folder, "ingest", 10):
            return {"state": "cancelled"}
        scene = _read_scene(source)
        if _stop(folder, "normalize", 30):
            return {"state": "cancelled"}
        result = normalize_scene(scene, units=units, up_axis=up_axis)
        if _stop(folder, "levels", 50):
            return {"state": "cancelled"}
        write_cloud(folder / "cloud.bin", result)
        if _stop(folder, "underlay", 70):
            return {"state": "cancelled"}
        write_underlays(folder, result)
        if _stop(folder, "preview", 75):
            return {"state": "cancelled"}
        write_preview(source, folder, result)
        if _stop(folder, "plan", 95):
            return {"state": "cancelled"}
        write_shell_plan(folder, result, up_axis=up_axis)
        _write_state(folder, "done", "preview", 100, "")
    except UnreadableFile:
        _write_state(folder, "error", "ingest", 0, UNREADABLE)
        return {"state": "error", "error": UNREADABLE}
    except LinkedFileMissing as exc:
        message = f"The linked file is missing: {exc.path}"
        _write_state(folder, "error", "ingest", 0, message)
        return {"state": "error", "error": message}
    except Exception:
        logger.exception("Import failed")
        _write_state(folder, "error", "ingest", 0, IMPORT_FAILED)
        return {"state": "error", "error": IMPORT_FAILED}
    return {"state": "done"}


def _read_scene(source: Path) -> RawScene:
    """Open a scan. An empty or corrupt file becomes a sentence, not a traceback."""
    try:
        scene = read_source(source)
    except Exception as exc:
        logger.exception("Could not read %s", source.name)
        raise UnreadableFile() from exc
    if not scene.has_geometry():
        raise UnreadableFile()
    return scene


def source_file(folder: Path) -> Path:
    """Copied sources are ``source.<ext>``. A link is used when ``linkedPath`` is set."""
    meta = json.loads((folder / "project.json").read_text(encoding="utf-8"))
    linked = meta.get("linkedPath")
    if isinstance(linked, str) and linked:
        path = Path(linked)
        if not path.is_file():
            raise LinkedFileMissing(linked)
        return path
    name = meta.get("sourceFileName")
    suffix = Path(name).suffix if isinstance(name, str) else ""
    copied = folder / f"source{suffix}"
    if copied.is_file():
        return copied
    if isinstance(name, str) and (folder / name).is_file():
        return folder / name
    raise FileNotFoundError(f"Source file is missing: {name}")


def start_import(folder: Path, units: str, up_axis: str) -> str:
    """Enqueue an import. Raises ``JobBusy`` when a job is already running."""
    if not _lock.acquire(blocking=False):
        raise JobBusy
    job_id = uuid.uuid4().hex
    _folders[job_id] = folder
    try:
        (folder / "job.cancel").unlink(missing_ok=True)
        (folder / "job.json").unlink(missing_ok=True)
        future = _pool().submit(execute_import, str(folder), units, up_axis)
    except Exception:
        _lock.release()
        raise
    _futures[job_id] = future
    future.add_done_callback(_release)
    return job_id


def import_status(folder: Path) -> dict[str, object]:
    """Import state for a project folder, including a job this process is still running."""
    live = _live_job(folder)
    loaded = _read_job_file(folder)
    state = loaded.get("state")
    error = loaded.get("error") if isinstance(loaded.get("error"), str) else ""
    progress = loaded.get("progress") if isinstance(loaded.get("progress"), int) else 0
    if state == "running" and live is None:
        return {
            "importState": "error",
            "importError": "The import was interrupted.",
            "jobId": None,
            "importProgress": progress,
        }
    if state not in {"running", "done", "error", "cancelled"}:
        state = "running" if live is not None else "none"
        error = ""
    return {
        "importState": state,
        "importError": error,
        "jobId": live if state == "running" else None,
        "importProgress": progress,
    }


def job_snapshot(job_id: str) -> dict[str, object] | None:
    """State mirrored from ``job.json``, or None when this process does not know the id."""
    folder = _folders.get(job_id)
    if folder is None:
        return None
    path = folder / "job.json"
    if path.is_file():
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            return loaded
    future = _futures.get(job_id)
    if future is not None and future.done():
        error = future.exception()
        if error is not None:
            return {"state": "error", "stage": "ingest", "progress": 0, "error": str(error)}
    return {"state": "running", "stage": "ingest", "progress": 0, "error": ""}


def cancel_job(job_id: str) -> bool:
    """Ask the worker to stop at the next stage boundary."""
    folder = _folders.get(job_id)
    if folder is None:
        return False
    (folder / "job.cancel").write_text("1", encoding="utf-8")
    return True


def shutdown_pool() -> None:
    """Drop the worker. Called when the API process exits."""
    global _executor
    if _executor is None:
        return
    _executor.shutdown(wait=False, cancel_futures=True)
    _executor = None


def _live_job(folder: Path) -> str | None:
    target = folder.resolve()
    for job_id, known in _folders.items():
        future = _futures.get(job_id)
        if future is None or future.done():
            continue
        if known.resolve() == target:
            return job_id
    return None


def _read_job_file(folder: Path) -> dict[str, object]:
    path = folder / "job.json"
    if not path.is_file():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if isinstance(loaded, dict):
        return loaded
    return {}


def _pool() -> ProcessPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ProcessPoolExecutor(max_workers=1)
    return _executor


def _release(_future: Future[dict[str, str]]) -> None:
    if _lock.locked():
        _lock.release()


def _stop(folder: Path, stage: str, progress: int) -> bool:
    """Record the stage, then honour a cancel request before the stage runs."""
    _write_state(folder, "running", stage, progress, "")
    _wait_hold(folder)
    if _cancelled(folder):
        _write_state(folder, "cancelled", stage, progress, "")
        return True
    return False


def _cancelled(folder: Path) -> bool:
    return (folder / "job.cancel").is_file()


def _wait_hold(folder: Path) -> None:
    hold = folder / "job.hold"
    while hold.is_file():
        if _cancelled(folder):
            return
        time.sleep(0.05)


def _write_state(folder: Path, state: str, stage: str, progress: int, error: str) -> None:
    if state == "cancelled":
        error = CANCELLED
    payload = {"state": state, "stage": stage, "progress": progress, "error": error}
    atomic_write_text(folder / "job.json", json.dumps(payload) + "\n")
