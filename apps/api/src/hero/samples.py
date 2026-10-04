"""Regression checks for manifests under samples/. Missing files skip."""

import json
import math
import shutil
import tempfile
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from hero.ingest.read import read_source
from hero.jobs import execute_import
from hero.schema import Plan, blank_plan, dump_plan


class SampleSkipped(Exception):
    """The manifest or every listed file is absent. The message is the path."""

    def __init__(self, path: str) -> None:
        super().__init__(path)
        self.path = path


class TapeReference(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    lengthM: float
    toleranceM: float = 0.05


class SampleEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    file: str
    source: str
    kind: str
    notes: str = ""
    levels: int | None = None
    references: list[TapeReference] = []


class SampleManifest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    samples: list[SampleEntry]


def check_samples(
    directory: Path,
    *,
    manifest: Path | None = None,
    source: str | None = None,
) -> None:
    """Open each present entry. Assert storeys and tape lengths when the manifest names them."""
    manifest_path = directory / "manifest.json" if manifest is None else manifest
    if not manifest_path.is_file():
        raise SampleSkipped(str(directory / "manifest.json"))
    entries = SampleManifest.model_validate(
        json.loads(manifest_path.read_text(encoding="utf-8"))
    ).samples
    if source is not None:
        entries = [entry for entry in entries if entry.source == source]
    present: list[tuple[Path, SampleEntry]] = []
    missing: list[Path] = []
    for entry in entries:
        path = directory / entry.file
        if path.is_file():
            present.append((path, entry))
        else:
            missing.append(path)
    if not present:
        location = ", ".join(str(path) for path in missing) or str(manifest_path)
        raise SampleSkipped(location)
    for path, entry in present:
        _check_entry(path, entry)


def _check_entry(path: Path, entry: SampleEntry) -> None:
    if entry.levels is None and not entry.references:
        _assert_opens(path)
        return
    plan = _import_plan(path)
    if entry.levels is not None and len(plan.levels) != entry.levels:
        raise AssertionError(
            f"{path.name}: {len(plan.levels)} storeys, expected {entry.levels}"
        )
    runs = _run_lengths(plan)
    for reference in entry.references:
        if not runs:
            raise AssertionError(f"{reference.name}: no walls were found in {path.name}")
        closest = min(runs, key=lambda length: abs(length - reference.lengthM))
        error = abs(closest - reference.lengthM)
        if error > reference.toleranceM:
            shown = ", ".join(f"{length:.3f}" for length in sorted(runs))
            raise AssertionError(
                f"{reference.name}: closest wall {closest:.3f} m, "
                f"expected {reference.lengthM:.3f} m ± {reference.toleranceM:.3f} m. "
                f"Runs: {shown}"
            )


def _assert_opens(path: Path) -> None:
    try:
        scene = read_source(path)
    except Exception as exc:
        raise AssertionError(f"{path} did not open: {exc}") from exc
    if scene.chunks is not None:
        return
    faces = scene.mesh_faces
    points = scene.points
    if faces is not None and len(faces) > 0:
        return
    if points is not None and len(points) > 0:
        return
    raise AssertionError(f"{path} opened with no geometry")


def _import_plan(source: Path) -> Plan:
    with tempfile.TemporaryDirectory(prefix="hero-sample-") as raw:
        folder = Path(raw) / "project"
        folder.mkdir()
        target = folder / f"source{source.suffix.lower()}"
        shutil.copyfile(source, target)
        meta = {
            "name": source.stem,
            "createdAt": "2026-01-01T00:00:00+00:00",
            "sourceFileName": source.name,
            "linkedPath": None,
        }
        (folder / "project.json").write_text(json.dumps(meta), encoding="utf-8")
        (folder / "plan.json").write_text(dump_plan(blank_plan(source.stem)), encoding="utf-8")
        outcome = execute_import(str(folder), "auto", "auto")
        if outcome.get("state") != "done":
            detail = outcome.get("error") or outcome.get("state")
            raise AssertionError(f"{source.name} did not import: {detail}")
        return Plan.model_validate_json((folder / "plan.json").read_text(encoding="utf-8"))


def _run_lengths(plan: Plan) -> list[float]:
    lengths: list[float] = []
    for level in plan.levels:
        points = {vertex.id: (vertex.x, vertex.y) for vertex in level.vertices}
        segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
        for wall in level.walls:
            segments.append((points[wall.a], points[wall.b]))
        lengths.extend(_collinear_runs(segments))
    return lengths


def _collinear_runs(
    segments: list[tuple[tuple[float, float], tuple[float, float]]],
) -> list[float]:
    """Length of each collinear chain. A tape measure spans a wall split at a junction."""
    usable: list[tuple[tuple[float, float], tuple[float, float], float]] = []
    for start, end in segments:
        length = math.hypot(end[0] - start[0], end[1] - start[1])
        if length >= 1e-4:
            usable.append((start, end, length))
    parent = list(range(len(usable)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        lead = find(left)
        follow = find(right)
        if lead != follow:
            parent[follow] = lead

    for left in range(len(usable)):
        for right in range(left + 1, len(usable)):
            if _same_run(usable[left], usable[right]):
                union(left, right)
    groups: dict[int, list[int]] = {}
    for index in range(len(usable)):
        groups.setdefault(find(index), []).append(index)
    return [_extent(usable, indexes) for indexes in groups.values()]


def _same_run(
    left: tuple[tuple[float, float], tuple[float, float], float],
    right: tuple[tuple[float, float], tuple[float, float], float],
) -> bool:
    start, end, length = left
    other_start, other_end, other_length = right
    ux = (end[0] - start[0]) / length
    uy = (end[1] - start[1]) / length
    vx = (other_end[0] - other_start[0]) / other_length
    vy = (other_end[1] - other_start[1]) / other_length
    if abs(ux * vx + uy * vy) < math.cos(math.radians(8)):
        return False

    def perp(point: tuple[float, float]) -> float:
        return (point[0] - start[0]) * -uy + (point[1] - start[1]) * ux

    if abs(perp(other_start)) > 0.12 or abs(perp(other_end)) > 0.12:
        return False

    def along(point: tuple[float, float]) -> float:
        return (point[0] - start[0]) * ux + (point[1] - start[1]) * uy

    a_min, a_max = sorted((0.0, length))
    b_min, b_max = sorted((along(other_start), along(other_end)))
    gap = max(a_min, b_min) - min(a_max, b_max)
    return gap <= 0.20


def _extent(
    usable: list[tuple[tuple[float, float], tuple[float, float], float]],
    indexes: list[int],
) -> float:
    best = max(indexes, key=lambda index: usable[index][2])
    start, end, length = usable[best]
    ux = (end[0] - start[0]) / length
    uy = (end[1] - start[1]) / length
    coords = [
        (point[0] - start[0]) * ux + (point[1] - start[1]) * uy
        for index in indexes
        for point in (usable[index][0], usable[index][1])
    ]
    return max(coords) - min(coords)
