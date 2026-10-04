"""One heavy import at a time, in a single worker process."""

import json
import threading
import time
import uuid
from concurrent.futures import Future, ProcessPoolExecutor
from pathlib import Path

from hero.atomic import atomic_write_text
from hero.ingest.read import read_source
from hero.pipeline.cloud import write_cloud
from hero.pipeline.normalize import normalize_scene
from hero.projects import LinkedFileMissing

_lock = threading.Lock()
_executor: ProcessPoolExecutor | None = None
_folders: dict[str, Path] = {}
_futures: dict[str, Future[dict[str, str]]] = {}


class JobBusy(Exception):
    """A second heavy job was asked for while one is running."""


def execute_import(project_dir: str, units: str, up_axis: str) -> dict[str, str]:
    """Run ingest, normalize, and levels. Cancel is checked between stages."""
    folder = Path(project_dir)
    if _cancelled(folder):
        _write_state(folder, "cancelled", "ingest", 0, "")
        return {"state": "cancelled"}
    try:
        source = source_file(folder)
        _write_state(folder, "running", "ingest", 15, "")
        _wait_hold(folder)
        if _cancelled(folder):
            _write_state(folder, "cancelled", "ingest", 15, "")
            return {"state": "cancelled"}
        scene = read_source(source)
        _write_state(folder, "running", "normalize", 45, "")
        _wait_hold(folder)
        if _cancelled(folder):
            _write_state(folder, "cancelled", "normalize", 45, "")
            return {"state": "cancelled"}
        result = normalize_scene(scene, units=units, up_axis=up_axis)
        _write_state(folder, "running", "levels", 80, "")
        _wait_hold(folder)
        if _cancelled(folder):
            _write_state(folder, "cancelled", "levels", 80, "")
            return {"state": "cancelled"}
        write_cloud(folder / "cloud.bin", result)
        _write_state(folder, "done", "levels", 100, "")
    except Exception as exc:
        _write_state(folder, "error", "ingest", 0, str(exc))
        return {"state": "error", "error": str(exc)}
    return {"state": "done"}


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
        future = _pool().submit(execute_import, str(folder), units, up_axis)
    except Exception:
        _lock.release()
        raise
    _futures[job_id] = future
    future.add_done_callback(_release)
    return job_id


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


def _pool() -> ProcessPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ProcessPoolExecutor(max_workers=1)
    return _executor


def _release(_future: Future[dict[str, str]]) -> None:
    if _lock.locked():
        _lock.release()


def _cancelled(folder: Path) -> bool:
    return (folder / "job.cancel").is_file()


def _wait_hold(folder: Path) -> None:
    hold = folder / "job.hold"
    while hold.is_file():
        if _cancelled(folder):
            return
        time.sleep(0.05)


def _write_state(folder: Path, state: str, stage: str, progress: int, error: str) -> None:
    payload = {"state": state, "stage": stage, "progress": progress, "error": error}
    atomic_write_text(folder / "job.json", json.dumps(payload) + "\n")
