"""One folder per project, with atomic plan writes and a recent list."""

import json
import os
import re
import shutil
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from hero.atomic import atomic_write_text
from hero.errors import UnsupportedSource
from hero.schema import Plan, blank_plan, dump_plan
from hero.settings_store import SettingsStore

MAX_COPY_BYTES = 200 * 1024 * 1024
_PROJECT_ID = re.compile(r"^[0-9a-f]{32}$")
_SNAPSHOTS = 20
SOURCE_SUFFIX = ".glb"


def _is_legacy_empty_import_shell(plan: Plan) -> bool:
    source = plan.detection.source
    if source is None or source.format != "glb" or not plan.levels:
        return False
    return all(
        not any(
            (
                level.vertices,
                level.walls,
                level.openings,
                level.columns,
                level.stairs,
                level.rooms,
                level.separators,
                level.fixtures,
                level.texts,
                level.dimensions,
            )
        )
        for level in plan.levels
    )


class ProjectNotFound(Exception):
    """The project id is not a folder we own."""

    def __init__(self, project_id: str) -> None:
        super().__init__(project_id)
        self.project_id = project_id


class LinkedFileMissing(Exception):
    """The caller asked to link a path that is not a file."""

    def __init__(self, path: str) -> None:
        super().__init__(path)
        self.path = path


class FileTooLarge(Exception):
    """The upload is above the copy limit and must be linked instead."""


class InvalidTrimbleExport(Exception):
    """The export record is incomplete, or a field looks like a URL or a token."""


_EXPORT_FIELDS = ("fileId", "versionId", "folderId", "name", "savedAt")
_EXPORT_MAX = 300
_URL_LIKE = re.compile(r"://|[?&#]|=|\bbearer\b", re.IGNORECASE)
_TOKEN_LIKE = re.compile(r"[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")


def validate_trimble_export(record: dict[str, str]) -> dict[str, str]:
    """Keep only the five fields. A URL or a token-shaped value is refused, never stored."""
    clean: dict[str, str] = {}
    for field in _EXPORT_FIELDS:
        value = record.get(field)
        if not isinstance(value, str) or not value.strip() or len(value) > _EXPORT_MAX:
            raise InvalidTrimbleExport(f"The export record needs a value for {field}.")
        if _URL_LIKE.search(value) or _TOKEN_LIKE.search(value):
            raise InvalidTrimbleExport(f"The export record cannot hold a URL or a token ({field}).")
        clean[field] = value
    try:
        datetime.fromisoformat(clean["savedAt"])
    except ValueError as exc:
        raise InvalidTrimbleExport("savedAt must be an ISO date and time.") from exc
    return clean


class RevisionConflict(Exception):
    """If-Match does not match the plan stored on disk."""

    def __init__(self, plan: Plan) -> None:
        super().__init__("revision conflict")
        self.plan = plan


@dataclass(frozen=True)
class StoredProject:
    id: str


class ProjectStore:
    """Projects under ``projects_dir`` and ``recent.json`` under ``config_dir``."""

    def __init__(self, projects_dir: Path, config_dir: Path) -> None:
        self.projects_dir = projects_dir
        self.config_dir = config_dir

    def project_dir(self, project_id: str) -> Path:
        if _PROJECT_ID.fullmatch(project_id) is None:
            raise ProjectNotFound(project_id)
        folder = self.projects_dir / project_id
        if not folder.is_dir():
            raise ProjectNotFound(project_id)
        return folder

    def create_linked(self, link_path: str, name: str | None = None) -> StoredProject:
        path = Path(link_path)
        if path.suffix.lower() != SOURCE_SUFFIX:
            raise UnsupportedSource(path.name)
        if not path.is_file():
            raise LinkedFileMissing(link_path)
        chosen = _chosen_name(name, path.stem)
        return self._create(
            name=chosen,
            source_file_name=path.name,
            linked_path=str(path.resolve()),
        )

    async def create_from_chunks(
        self,
        filename: str,
        read: Callable[[int], Awaitable[bytes]],
        name: str | None,
        *,
        limit: int | None = None,
        trimble_source: dict[str, str] | None = None,
    ) -> StoredProject:
        """Copy chunks into a new project. ``limit`` is the byte cap; local copies keep 200 MB."""
        cap = MAX_COPY_BYTES if limit is None else limit
        source_name, suffix = _source_names(filename)
        project_id = uuid.uuid4().hex
        folder = self.projects_dir / project_id
        folder.mkdir(parents=True, exist_ok=True)
        destination = folder / f"source{suffix}"
        temporary = destination.with_name(f"{destination.name}.part")
        try:
            size = 0
            with temporary.open("wb") as handle:
                while True:
                    chunk = await read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > cap:
                        raise FileTooLarge
                    handle.write(chunk)
            os.replace(temporary, destination)
            chosen = _chosen_name(name, Path(source_name).stem)
            self._write_meta(
                folder,
                name=chosen,
                source_file_name=source_name,
                linked_path=None,
                trimble_source=trimble_source,
            )
            self.remember(project_id)
        except Exception:
            temporary.unlink(missing_ok=True)
            shutil.rmtree(folder, ignore_errors=True)
            raise
        return StoredProject(id=project_id)

    def find_trimble(self, file_id: str, version_id: str) -> str | None:
        """Project already downloaded from this Trimble file version, if its source is on disk."""
        if not self.projects_dir.is_dir():
            return None
        newest: tuple[str, str] | None = None
        for folder in self.projects_dir.iterdir():
            try:
                meta = json.loads((folder / "project.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            source = meta.get("trimbleSource") if isinstance(meta, dict) else None
            if not isinstance(source, dict):
                continue
            if source.get("fileId") != file_id or source.get("versionId") != version_id:
                continue
            if not (folder / f"source{SOURCE_SUFFIX}").is_file():
                continue
            created = str(meta.get("createdAt", ""))
            if newest is None or created > newest[0]:
                newest = (created, folder.name)
        return newest[1] if newest else None

    def record_trimble_export(self, project_id: str, record: dict[str, str]) -> dict[str, str]:
        """Remember the last PDF saved to Trimble Connect: ids, name, and time. No URL, no token."""
        clean = validate_trimble_export(record)
        folder = self.project_dir(project_id)
        path = folder / "project.json"
        meta = json.loads(path.read_text(encoding="utf-8"))
        meta["trimbleExport"] = clean
        atomic_write_text(path, json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
        return clean

    def read_plan(self, project_id: str) -> Plan:
        path = self.project_dir(project_id) / "plan.json"
        if not path.is_file():
            raise ProjectNotFound(project_id)
        plan = Plan.model_validate_json(path.read_text(encoding="utf-8"))
        if _is_legacy_empty_import_shell(plan):
            return plan.model_copy(
                update={
                    "levels": [],
                    "detection": plan.detection.model_copy(update={"issues": []}),
                }
            )
        return plan

    def save_plan(self, project_id: str, plan: Plan, *, if_match: int) -> Plan:
        folder = self.project_dir(project_id)
        current = self.read_plan(project_id)
        if if_match != current.revision:
            raise RevisionConflict(current)
        updated = plan.model_copy(update={"revision": current.revision + 1})
        self._snapshot(folder, current)
        atomic_write_text(folder / "plan.json", dump_plan(updated))
        return updated

    def describe(self, project_id: str) -> dict[str, Any]:
        folder = self.project_dir(project_id)
        meta = json.loads((folder / "project.json").read_text(encoding="utf-8"))
        plan = self.read_plan(project_id)
        described: dict[str, Any] = {
            "id": project_id,
            "name": meta["name"],
            "createdAt": meta["createdAt"],
            "sourceFileName": meta["sourceFileName"],
            "linkedPath": meta["linkedPath"],
            "folder": str(folder.resolve()),
            "revision": plan.revision,
            "levels": [
                {"id": level.id, "name": level.name, "elevation": level.elevation}
                for level in plan.levels
            ],
        }
        exported = meta.get("trimbleExport")
        if isinstance(exported, dict):
            described["trimbleExport"] = exported
        return described

    def list_recent(self) -> list[dict[str, Any]]:
        entries = self._read_recent()
        kept: list[dict[str, str]] = []
        changed = False
        for item in entries:
            if not Path(item["folder"]).is_dir():
                changed = True
                continue
            kept.append(item)
        if len(kept) > 10:
            kept = kept[:10]
            changed = True
        if changed:
            self._write_recent(kept)
        listed: list[dict[str, Any]] = []
        for item in kept:
            try:
                listed.append(self.describe(item["id"]))
            except ProjectNotFound:
                continue
        return listed

    def delete(self, project_id: str) -> None:
        """Remove the project folder and its recent entry. A linked source file is left in place."""
        folder = self.project_dir(project_id)
        shutil.rmtree(folder)
        entries = [item for item in self._read_recent() if item["id"] != project_id]
        self._write_recent(entries)

    def remember(self, project_id: str) -> None:
        folder = str(self.project_dir(project_id).resolve())
        entries = [item for item in self._read_recent() if item["id"] != project_id]
        entries.insert(0, {"id": project_id, "folder": folder})
        self._write_recent(entries[:10])

    def _create(
        self,
        *,
        name: str,
        source_file_name: str,
        linked_path: str | None,
    ) -> StoredProject:
        project_id = uuid.uuid4().hex
        folder = self.projects_dir / project_id
        folder.mkdir(parents=True, exist_ok=True)
        try:
            self._write_meta(
                folder,
                name=name,
                source_file_name=source_file_name,
                linked_path=linked_path,
            )
            self.remember(project_id)
        except Exception:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        return StoredProject(id=project_id)

    def _write_meta(
        self,
        folder: Path,
        *,
        name: str,
        source_file_name: str,
        linked_path: str | None,
        trimble_source: dict[str, str] | None = None,
    ) -> None:
        meta: dict[str, Any] = {
            "name": name,
            "createdAt": datetime.now(UTC).isoformat(),
            "sourceFileName": source_file_name,
            "linkedPath": linked_path,
        }
        if trimble_source is not None:
            # File id, version id, and name only. Never a URL or a token.
            meta["trimbleSource"] = trimble_source
        atomic_write_text(
            folder / "project.json",
            json.dumps(meta, indent=2, ensure_ascii=False) + "\n",
        )
        settings = SettingsStore(self.config_dir).load()
        atomic_write_text(folder / "plan.json", dump_plan(blank_plan(name, settings.titleBlock)))

    def _snapshot(self, folder: Path, current: Plan) -> None:
        text = dump_plan(current)
        atomic_write_text(folder / "plan.prev.json", text)
        revisions = folder / "revisions"
        revisions.mkdir(parents=True, exist_ok=True)
        atomic_write_text(revisions / f"{current.revision}.json", text)
        archived = sorted(
            (path for path in revisions.glob("*.json") if path.stem.isdigit()),
            key=lambda path: int(path.stem),
        )
        extra = len(archived) - _SNAPSHOTS
        for old in archived[: max(extra, 0)]:
            old.unlink()

    def _read_recent(self) -> list[dict[str, str]]:
        path = self.config_dir / "recent.json"
        if not path.is_file():
            return []
        raw = json.loads(path.read_text(encoding="utf-8"))
        projects = raw.get("projects", []) if isinstance(raw, dict) else []
        entries: list[dict[str, str]] = []
        for item in projects:
            if not isinstance(item, dict):
                continue
            project_id = item.get("id")
            folder = item.get("folder")
            if isinstance(project_id, str) and isinstance(folder, str):
                entries.append({"id": project_id, "folder": folder})
        return entries

    def _write_recent(self, entries: list[dict[str, str]]) -> None:
        payload = {"projects": entries[:10]}
        atomic_write_text(
            self.config_dir / "recent.json",
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        )


def _chosen_name(name: str | None, fallback: str) -> str:
    if name is not None and name.strip():
        return name.strip()
    if fallback.strip():
        return fallback.strip()
    return "Untitled"


def _source_names(filename: str) -> tuple[str, str]:
    safe = Path(filename).name
    if not safe or safe in {".", ".."}:
        safe = "upload.bin"
    suffix = Path(safe).suffix.lower()
    if suffix != SOURCE_SUFFIX:
        raise UnsupportedSource(safe)
    return safe, suffix
