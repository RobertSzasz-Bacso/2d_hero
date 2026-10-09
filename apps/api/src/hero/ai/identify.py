"""Ask Cursor to name fixtures in the user's 3D screenshot and write them onto the plan."""

from __future__ import annotations

import base64
import binascii
import json
import math
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, cast

from shapely.geometry import Point, Polygon

from hero.ai.chat import ask_fixture_labels, ask_mask, ask_with_images, review_picture
from hero.ai.mask import MaskFixture, MaskFrame, decode_mask
from hero.ai.room import RoomBounds, measure_cloud, outside_messages
from hero.ai.session import ProposalError
from hero.ai.viewshot import ViewShot, fixture_pose, plan_xy
from hero.atomic import atomic_write_bytes, atomic_write_text
from hero.ingest.read import read_source
from hero.jobs import source_file
from hero.pipeline.cloud import read_cloud
from hero.pipeline.normalize import normalize_scene
from hero.pipeline.planwrite import scan_plan
from hero.projects import ProjectNotFound, ProjectStore, RevisionConflict
from hero.schema import Fixture, Level, Plan

SeeImage = Callable[[str, bytes, str], str]
CheckPlan = Callable[[str, bytes, bytes, str], str]
Correct = Callable[[str], str]
MakeMask = Callable[[str, bytes, bytes, str], bytes]
LabelFixtures = Callable[[str, list[bytes], str], str]
_CORRECTIONS = 3
_GEOMETRY_SUFFIXES = {".glb"}

_SYMBOLS = (
    "toilet",
    "sink",
    "bathtub",
    "shower",
    "kitchen-counter",
    "stove",
    "bed-double",
    "sofa",
    "table",
    "wardrobe",
    "block",
    "chair",
)
_ROLES = {
    "toilet": "fixture",
    "sink": "fixture",
    "bathtub": "fixture",
    "shower": "fixture",
    "kitchen-counter": "fixture",
    "stove": "fixture",
    "bed-double": "furniture",
    "sofa": "furniture",
    "table": "furniture",
    "wardrobe": "furniture",
    "block": "furniture",
    "chair": "furniture",
}
_SIZES = {
    "toilet": (0.4, 0.7),
    "sink": (0.6, 0.6),
    "bathtub": (0.7, 1.7),
    "shower": (0.9, 0.9),
    "kitchen-counter": (2.0, 0.6),
    "stove": (0.6, 0.6),
    "bed-double": (1.6, 2.0),
    "sofa": (2.0, 0.6),
    "table": (1.2, 0.8),
    "wardrobe": (1.2, 0.6),
    "block": (0.6, 0.6),
    "chair": (0.5, 0.5),
}


class IdentifyError(Exception):
    """The picture could not be turned into fixtures."""


class _Talk:
    """One detection's files: every picture, prompt, reply, and correction."""

    def __init__(self, directory: Path, turn: int) -> None:
        self.directory = directory
        self.turn = turn

    @classmethod
    def start(cls, project: Path) -> _Talk:
        root = project / "identification"
        root.mkdir(exist_ok=True)
        index = 1 + sum(1 for path in root.iterdir() if path.is_dir())
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        directory = root / f"{index:03d}-{stamp}"
        directory.mkdir()
        atomic_write_text(project / "identification-latest.txt", directory.name)
        return cls(directory, 0)

    @classmethod
    def resume(cls, project: Path) -> _Talk:
        latest = project / "identification-latest.txt"
        name = latest.read_text(encoding="utf-8").strip() if latest.is_file() else ""
        directory = project / "identification" / name
        if not name or Path(name).name != name or not directory.is_dir():
            return cls.start(project)
        turn = 0
        for path in directory.iterdir():
            part = path.name.split("-", 1)[0]
            if part.isdigit():
                turn = max(turn, int(part))
        return cls(directory, turn)

    def prompt(
        self,
        text: str,
        api_key: str,
        *,
        image: bytes | None = None,
        plan: bytes | None = None,
    ) -> None:
        self._write("prompt", text, api_key, image=image, plan=plan)

    def error(self, text: str, api_key: str) -> None:
        self._write("error", text, api_key)

    def reply(self, text: str, api_key: str) -> None:
        safe = _redact(text, api_key)
        atomic_write_text(self.directory / f"{self.turn:02d}-reply.txt", safe)

    def stopped(self, text: str, api_key: str) -> None:
        safe = _redact(text, api_key)
        atomic_write_text(self.directory / f"{self.turn:02d}-stopped.txt", safe)

    def _write(
        self,
        kind: str,
        text: str,
        api_key: str,
        *,
        image: bytes | None = None,
        plan: bytes | None = None,
    ) -> None:
        self.turn += 1
        number = f"{self.turn:02d}"
        atomic_write_text(self.directory / f"{number}-{kind}.txt", _redact(text, api_key))
        if image is not None:
            atomic_write_bytes(self.directory / f"{number}-image.png", image)
        if plan is not None:
            atomic_write_bytes(self.directory / f"{number}-plan.png", plan)


def _redact(text: str, api_key: str) -> str:
    if api_key and api_key in text:
        return text.replace(api_key, "[key]")
    return text


@dataclass(frozen=True)
class ParsedFixture:
    symbol: str
    x: float
    y: float
    rotation_deg: float
    width: float
    depth: float
    confidence: float
    role: str


def identify_project(
    store: ProjectStore,
    project_id: str,
    api_key: str,
    *,
    image: str,
    projection: list[float],
    matrix_world: list[float],
    floor_z: float,
    overhead_image: str | None = None,
    overhead_frame: list[float] | None = None,
    see: SeeImage | None = None,
    correct: Correct | None = None,
    mask: MakeMask | None = None,
    label: LabelFixtures | None = None,
) -> Plan:
    """Detect fixtures from the framed view and replace the first level's fixtures."""
    try:
        folder = store.project_dir(project_id)
    except ProjectNotFound:
        raise
    png = _png_bytes(image)
    if overhead_image is not None or overhead_frame is not None:
        folder = store.project_dir(project_id)
        if has_geometry_source(folder):
            return _identify_from_geometry(
                store,
                project_id,
                api_key,
                screenshot=png,
                overhead_image=overhead_image,
                overhead_frame=overhead_frame,
                make_mask=mask,
                label=label,
            )
        return _identify_from_mask(
            store,
            project_id,
            api_key,
            screenshot=png,
            overhead_image=overhead_image,
            overhead_frame=overhead_frame,
            make_mask=mask,
        )
    try:
        shot = ViewShot(
            projection=tuple(projection),
            matrix_world=tuple(matrix_world),
            floor_z=floor_z,
        )
    except ValueError as exc:
        raise IdentifyError("The 3D view could not be read.") from exc
    atomic_write_bytes(folder / "identification.png", png)
    atomic_write_text(
        folder / "identification-view.json",
        json.dumps({"projection": projection, "matrixWorld": matrix_world, "floorZ": floor_z}),
    )
    measured = _measure(folder)
    bounds = measured[1] if measured is not None else None
    prompt = _prompt(shot, bounds)
    atomic_write_text(folder / "identification-prompt.txt", prompt)
    talk = _Talk.start(folder)
    talk.prompt(prompt, api_key, image=png)
    plan = store.read_plan(project_id)
    plan = _ensure_level(plan, measured[0] if measured is not None else None)

    def judge(reply: str) -> str:
        return placement_report(reply, shot, bounds)

    reply = _accepted_reply(
        prompt, png, api_key, folder, judge, talk, see=see, correct=correct
    )
    try:
        found = parse_fixtures(reply, shot)
    except (ValueError, TypeError) as exc:
        raise IdentifyError("Cursor did not return fixture JSON.") from exc
    updated = _place(plan, cast(list[ParsedFixture], found))
    try:
        return store.save_plan(project_id, updated, if_match=plan.revision)
    except RevisionConflict as exc:
        raise IdentifyError("The plan changed. Try again.") from exc


def _identify_from_mask(
    store: ProjectStore,
    project_id: str,
    api_key: str,
    *,
    screenshot: bytes,
    overhead_image: str | None,
    overhead_frame: list[float] | None,
    make_mask: MakeMask | None,
) -> Plan:
    if overhead_image is None or overhead_frame is None:
        raise IdentifyError("The overhead view is missing its metric frame.")
    overhead_png = _png_bytes(overhead_image)
    frame = _mask_frame(overhead_frame)
    folder = store.project_dir(project_id)
    measured = _measure(folder)
    bounds = measured[1] if measured is not None else _bounds_for_frame(frame)
    prompt = _mask_prompt(bounds)
    atomic_write_bytes(folder / "identification-overhead.png", overhead_png)
    atomic_write_text(
        folder / "identification-frame.json",
        json.dumps(
            {
                "origin": frame.origin,
                "xAxis": frame.x_axis,
                "yAxis": frame.y_axis,
            }
        ),
    )
    atomic_write_text(folder / "identification-prompt.txt", prompt)
    talk = _Talk.start(folder)
    talk.prompt(prompt, api_key, image=screenshot, plan=overhead_png)
    generator = make_mask or _default_mask
    mask_png: bytes | None = None
    found: list[MaskFixture] | None = None
    failure = "Cursor did not return a usable mask."
    asked = prompt
    for attempt in range(2):
        try:
            mask_png = _png_bytes_from_result(generator(asked, screenshot, overhead_png, api_key))
            found = decode_mask(mask_png, frame, bounds)
            problems = outside_messages(found, bounds)
            if problems:
                asked = f"{prompt} {_outside_feedback(problems, bounds)}"
                raise IdentifyError(" ".join(problems))
            break
        except ProposalError as exc:
            failure = str(exc)
            talk.stopped(failure, api_key)
            raise
        except (IdentifyError, ValueError, TypeError) as exc:
            failure = str(exc)
            if attempt == 0:
                talk.error(failure, api_key)
                continue
            talk.stopped(failure, api_key)
            raise IdentifyError(failure) from exc
    if mask_png is None or found is None:
        talk.stopped(failure, api_key)
        raise IdentifyError(failure)
    atomic_write_bytes(folder / "identification-mask.png", mask_png)
    atomic_write_text(folder / "identification-reply.txt", "Cursor mask decoded.\n")
    talk.reply("Cursor mask decoded.", api_key)
    plan = store.read_plan(project_id)
    plan = _ensure_level(plan, measured[0] if measured is not None else None)
    updated = _place(plan, cast(list[ParsedFixture], found))
    try:
        return store.save_plan(project_id, updated, if_match=plan.revision)
    except RevisionConflict as exc:
        raise IdentifyError("The plan changed. Try again.") from exc


def _outside_feedback(problems: list[str], bounds: RoomBounds) -> str:
    return (
        f"{' '.join(problems)} The interior runs from x={bounds.min_x:.2f} m to "
        f"x={bounds.max_x:.2f} m and from y={bounds.min_y:.2f} m to y={bounds.max_y:.2f} m. "
        "Repaint the mask so every object's whole footprint stays inside the room. "
        "A few centimetres past the wall is allowed."
    )


def _identify_from_geometry(
    store: ProjectStore,
    project_id: str,
    api_key: str,
    *,
    screenshot: bytes,
    overhead_image: str | None,
    overhead_frame: list[float] | None,
    make_mask: MakeMask | None,
    label: LabelFixtures | None,
) -> Plan:
    if overhead_image is None or overhead_frame is None:
        raise IdentifyError("The overhead view is missing its metric frame.")
    folder = store.project_dir(project_id)
    overhead_png = _png_bytes(overhead_image)
    frame = _mask_frame(overhead_frame)
    visible = _bounds_for_frame(frame).polygon
    try:
        result = normalize_scene(read_source(source_file(folder)))
    except Exception as exc:
        raise IdentifyError("The source scan could not be read for furniture detection.") from exc
    detected = scan_plan(result)
    plan = store.read_plan(project_id)
    if not detected.levels:
        raise IdentifyError("The scan has no storey for furniture detection.")
    if not any(level.fixtures for level in detected.levels):
        if not api_key:
            raise IdentifyError(
                "The scan geometry did not reveal furniture. "
                "Save a Cursor key to use image detection."
            )
        return _identify_from_mask(
            store,
            project_id,
            api_key,
            screenshot=screenshot,
            overhead_image=overhead_image,
            overhead_frame=overhead_frame,
            make_mask=make_mask,
        )
    current = plan.levels[0] if plan.levels else None
    target_elevation = current.elevation if current is not None else detected.levels[0].elevation
    detected_level = min(
        detected.levels,
        key=lambda level: abs(level.elevation - target_elevation),
    )
    replacement = detected_level.model_copy(
        update={
            "id": current.id if current is not None else detected_level.id,
            "name": current.name if current is not None else detected_level.name,
            "fixtures": [
                fixture
                for fixture in detected_level.fixtures
                if visible.covers(Point(fixture.x, fixture.y))
            ],
        }
    )
    blocks = [fixture for fixture in replacement.fixtures if fixture.symbol == "block"]
    talk = _Talk.start(folder)
    prompt = _label_prompt(blocks)
    atomic_write_bytes(folder / "identification-overhead.png", overhead_png)
    atomic_write_text(folder / "identification-prompt.txt", prompt)
    talk.prompt(prompt, api_key, image=screenshot, plan=overhead_png)
    if blocks and api_key:
        labeler = label or _default_labels
        try:
            reply = labeler(prompt, [screenshot, overhead_png], api_key)
            replacements = _parse_labels(reply, {fixture.id for fixture in blocks})
            if replacements:
                replacement = replacement.model_copy(
                    update={
                        "fixtures": [
                            fixture.model_copy(
                                update={
                                    "symbol": replacements.get(fixture.id, fixture.symbol),
                                    "role": _ROLES.get(
                                        replacements.get(fixture.id, fixture.symbol),
                                        fixture.role,
                                    ),
                                }
                            )
                            for fixture in replacement.fixtures
                        ]
                    }
                )
            talk.reply(reply, api_key)
        except (ProposalError, TypeError, ValueError) as exc:
            talk.error(str(exc), api_key)
    else:
        talk.reply("No ambiguous fixture clusters.", api_key)
    if plan.levels:
        levels = [replacement, *plan.levels[1:]]
    else:
        levels = [
            replacement if level.id == detected_level.id else level
            for level in detected.levels
        ]
    updated = plan.model_copy(
        update={
            "levels": levels,
            "detection": plan.detection.model_copy(update={"issues": detected.detection.issues}),
        },
    )
    try:
        return store.save_plan(project_id, updated, if_match=plan.revision)
    except RevisionConflict as exc:
        raise IdentifyError("The plan changed. Try again.") from exc


def _default_mask(prompt: str, screenshot: bytes, overhead: bytes, api_key: str) -> bytes:
    return ask_mask(prompt, [screenshot, overhead], api_key)


def _default_labels(prompt: str, pictures: list[bytes], api_key: str) -> str:
    return ask_fixture_labels(prompt, pictures, api_key)


def has_geometry_source(folder: Path) -> bool:
    if (folder / "cloud.bin").is_file():
        return True
    try:
        return source_file(folder).suffix.lower() in _GEOMETRY_SUFFIXES
    except (OSError, KeyError, TypeError, ValueError):
        return False


def _label_prompt(blocks: list[Any]) -> str:
    objects = ", ".join(
        f"{fixture.id} ({fixture.width:.2f} m by {fixture.depth:.2f} m)"
        for fixture in blocks
    )
    return (
        "The pictures show a 3D room and its overhead view. The application has already measured "
        "the object boxes and their positions from the scan. Identify only the ambiguous object "
        "IDs listed below. Do not change geometry. Return JSON only in this exact form: "
        '{"labels":[{"id":"f1","symbol":"toilet"}]}. '
        "Use only toilet, sink, bathtub, shower, kitchen-counter, stove, bed-double, sofa, "
        "table, wardrobe, block, or chair. Keep an object as block if uncertain. "
        f"Measured ambiguous objects: {objects or 'none'}."
    )


def _parse_labels(text: str, allowed_ids: set[str]) -> dict[str, str]:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("Cursor did not return fixture labels.")
    payload = json.loads(text[start : end + 1])
    raw = payload.get("labels")
    if not isinstance(raw, list):
        raise ValueError("Cursor did not return fixture labels.")
    found: dict[str, str] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        identifier = item.get("id")
        symbol = item.get("symbol")
        if identifier in allowed_ids and symbol in _SYMBOLS:
            found[str(identifier)] = str(symbol)
    return found


def _mask_frame(values: list[float]) -> MaskFrame:
    if len(values) != 6:
        raise IdentifyError("The overhead view has no six-number metric frame.")
    try:
        numbers = tuple(float(value) for value in values)
    except (TypeError, ValueError) as exc:
        raise IdentifyError("The overhead view has an invalid metric frame.") from exc
    if not all(math.isfinite(value) for value in numbers):
        raise IdentifyError("The overhead view has an invalid metric frame.")
    origin = (numbers[0], numbers[1])
    return MaskFrame(
        origin=origin,
        x_axis=(numbers[2], numbers[3]),
        y_axis=(numbers[4], numbers[5]),
    )


def _bounds_for_frame(frame: MaskFrame) -> RoomBounds:
    corners = [
        frame.origin,
        (frame.origin[0] + frame.x_axis[0], frame.origin[1] + frame.x_axis[1]),
        (
            frame.origin[0] + frame.x_axis[0] + frame.y_axis[0],
            frame.origin[1] + frame.x_axis[1] + frame.y_axis[1],
        ),
        (frame.origin[0] + frame.y_axis[0], frame.origin[1] + frame.y_axis[1]),
    ]
    polygon = Polygon(corners)
    if not polygon.is_valid or polygon.area <= 0:
        raise IdentifyError("The overhead view has an invalid floor frame.")
    min_x, min_y, max_x, max_y = (float(value) for value in polygon.bounds)
    return RoomBounds(
        polygon=polygon,
        width=max_x - min_x,
        depth=max_y - min_y,
        area=float(polygon.area),
        min_x=min_x,
        min_y=min_y,
        max_x=max_x,
        max_y=max_y,
    )


def _mask_prompt(bounds: RoomBounds) -> str:
    return (
        "The first picture is the user's framed 3D view. The second picture is an overhead "
        "render of exactly the same visible floor patch. Paint a flat-color furniture mask as "
        "an SVG and return SVG only. Use viewBox=\"0 0 768 768\". The background outside the "
        "floor is black and the whole visible floor is #eeeeee. Paint each complete object "
        "footprint, including parts touching walls, as one solid rectangle, polygon, or ellipse. "
        "Do not add labels, outlines, shadows, perspective, dimensions, arrows, or decorative "
        "marks. Use only these exact object colors: toilet #dc3c3c, sink #3cb44b, "
        "bathtub #3264dc, shower #28c8c8, kitchen-counter #dcaa28, stove #f0781e, "
        "bed-double #9646c8, sofa #dc46a0, table #965a28, wardrobe #1ea0a0, "
        "block #646464, chair #c878c8. Use each color at most once per object. "
        f"The measured room is {bounds.width:.2f} m by {bounds.depth:.2f} m. "
        "Do not draw objects that are not visible in the second picture. If no object is "
        "recognizable, return only a black SVG with no object colors."
    )


def _png_bytes_from_result(value: bytes) -> bytes:
    if not isinstance(value, bytes):
        raise ValueError("Cursor did not return a mask image.")
    return _png_bytes(base64.b64encode(value).decode("ascii"))


def review_placement(
    store: ProjectStore,
    project_id: str,
    api_key: str,
    *,
    image: str,
    check: CheckPlan | None = None,
) -> tuple[Plan, bool]:
    """Send the drawn plan back. Save a correction. Keep the plan when Cursor accepts it."""
    try:
        folder = store.project_dir(project_id)
    except ProjectNotFound:
        raise
    original_path = folder / "identification.png"
    view_path = folder / "identification-view.json"
    reply_path = folder / "identification-reply.txt"
    if not original_path.is_file() or not view_path.is_file() or not reply_path.is_file():
        raise IdentifyError("Detect furniture again so there is a plan picture to check.")
    plan_png = _png_bytes(image)
    atomic_write_bytes(folder / "identification-plan.png", plan_png)
    previous = reply_path.read_text(encoding="utf-8")
    prompt = _review_prompt(previous)
    _note_correction(folder, prompt, api_key)
    talk = _Talk.resume(folder)
    talk.prompt(prompt, api_key, image=original_path.read_bytes(), plan=plan_png)
    try:
        view = json.loads(view_path.read_text(encoding="utf-8"))
        shot = ViewShot(
            projection=tuple(view["projection"]),
            matrix_world=tuple(view["matrixWorld"]),
            floor_z=float(view["floorZ"]),
        )
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise IdentifyError("The 3D view could not be read.") from exc
    look = check if check is not None else _ask_two
    reply = look(prompt, original_path.read_bytes(), plan_png, api_key)
    saved_reply = _redact(reply, api_key)
    atomic_write_text(reply_path, saved_reply)
    talk.reply(reply, api_key)
    if _approved(reply):
        return store.read_plan(project_id), True
    measured = _measure(folder)
    bounds = measured[1] if measured is not None else None
    report = placement_report(reply, shot, bounds)
    if report:
        talk.stopped(report, api_key)
        raise IdentifyError(report)
    try:
        found = parse_fixtures(reply, shot)
    except (ValueError, TypeError) as exc:
        raise IdentifyError("Cursor did not return fixture JSON.") from exc
    plan = store.read_plan(project_id)
    if not plan.levels:
        raise IdentifyError("This project has no storey yet.")
    updated = _place(plan, found)
    try:
        saved = store.save_plan(project_id, updated, if_match=plan.revision)
    except RevisionConflict as exc:
        raise IdentifyError("The plan changed. Try again.") from exc
    return saved, False


def _ask_two(prompt: str, original: bytes, plan_png: bytes, api_key: str) -> str:
    return ask_with_images(prompt, [original, plan_png], api_key)


def _approved(text: str) -> bool:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return False
    try:
        payload = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return False
    fixtures = payload.get("fixtures")
    return payload.get("ok") is True and not fixtures


def _review_prompt(previous: str) -> str:
    return (
        "The first picture is the 3D view. "
        "The second picture is the 2D plan drawn from your last JSON. "
        "Compare them. Each object on the plan must be the whole object from the 3D view, "
        "including the part that touches a wall. "
        "A box around only the basin, bowl, or seat is too small. "
        "If the plan matches the 3D view, reply with {\"ok\":true} and nothing else. "
        "If an object is too small, too big, or too far from a wall, "
        "reply with the full corrected JSON only. "
        "nx, ny, spanX, spanY, and back still refer to the first picture, not the plan. "
        "Your previous JSON was:\n"
        f"{previous}"
    )


def placement_report(text: str, shot: ViewShot, bounds: RoomBounds | None) -> str:
    """Empty when every object lies inside the room. Otherwise report the problem."""
    if bounds is None:
        return ""
    try:
        found = parse_fixtures(text, shot)
    except ValueError as exc:
        return f"{exc} Reply with the full corrected JSON only."
    problems = outside_messages(found, bounds)
    if not problems:
        return ""
    listed = " ".join(problems)
    return (
        f"{listed} The interior runs from x={bounds.min_x:.2f} m to x={bounds.max_x:.2f} m "
        f"and from y={bounds.min_y:.2f} m to y={bounds.max_y:.2f} m. "
        "Move every listed object so its whole footprint stays inside the room. "
        "A few centimetres past the wall is allowed. Do not move objects that are already inside. "
        "Reply with the full corrected JSON only."
    )


def parse_fixtures(text: str, shot: ViewShot) -> list[ParsedFixture]:
    """Read fixture JSON. nx is left to right. ny is top to bottom in the screenshot."""
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("Cursor did not return fixture JSON.")
    payload = json.loads(text[start : end + 1])
    raw = payload.get("fixtures")
    if not isinstance(raw, list):
        raise ValueError("Cursor did not return fixture JSON.")
    found: list[ParsedFixture] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        symbol = item.get("symbol")
        if symbol not in _SYMBOLS:
            continue
        nx = _unit(item.get("nx"))
        ny = _unit(item.get("ny"))
        if nx is None or ny is None:
            raise ValueError(f"The {symbol} has no position in the picture.")
        span_x = _unit(item.get("spanX"))
        span_y = _unit(item.get("spanY"))
        back = str(item.get("back", "")).lower()
        pose = None
        if span_x and span_y and back:
            pose = fixture_pose(nx, ny, span_x, span_y, back, shot)
        if pose is None:
            point = plan_xy(nx, ny, shot)
            if point is None:
                raise ValueError(f"The {symbol} could not be placed on the floor.")
            width, depth = _SIZES[str(symbol)]
            rotation = 0.0
            placed_x, placed_y = point
        else:
            placed_x, placed_y, rotation, width, depth = pose
            if width > 4 or depth > 4 or width < 0.15 or depth < 0.15:
                width, depth = _SIZES[str(symbol)]
        found.append(
            ParsedFixture(
                symbol=str(symbol),
                x=placed_x,
                y=placed_y,
                rotation_deg=rotation,
                width=width,
                depth=depth,
                confidence=_confidence(item.get("confidence")),
                role=_ROLES[str(symbol)],
            )
        )
    return found


def _accepted_reply(
    prompt: str,
    png: bytes,
    api_key: str,
    folder: Any,
    judge: Callable[[str], str],
    talk: _Talk,
    *,
    see: SeeImage | None,
    correct: Correct | None,
) -> str:
    """Ask, and send each placement error back, until the reply fits or the retries run out."""

    def remember(reply: str) -> None:
        atomic_write_text(folder / "identification-reply.txt", _redact(reply, api_key))
        talk.reply(reply, api_key)

    try:
        if see is None:
            return review_picture(
                prompt,
                png,
                api_key,
                judge,
                remember=remember,
                on_retry=lambda note: talk.error(note, api_key),
            )
        reply = see(prompt, png, api_key)
        remember(reply)
        for _ in range(_CORRECTIONS):
            error = judge(reply)
            if not error:
                return reply
            if correct is None:
                break
            _note_correction(folder, error, api_key)
            talk.error(error, api_key)
            reply = correct(error)
            remember(reply)
        error = judge(reply)
        if error:
            talk.stopped(error, api_key)
            raise IdentifyError(error)
        return reply
    except ProposalError as exc:
        talk.stopped(str(exc), api_key)
        raise


def _note_correction(folder: Any, error: str, api_key: str) -> None:
    path = folder / "identification-prompt.txt"
    previous = path.read_text(encoding="utf-8") if path.is_file() else ""
    note = error.replace(api_key, "[key]") if api_key else error
    atomic_write_text(path, f"{previous}\n\nCorrection sent back to Cursor:\n{note}\n")


def _measure(folder: Any) -> tuple[Any, RoomBounds] | None:
    path = folder / "cloud.bin"
    if not path.is_file():
        return None
    try:
        return measure_cloud(read_cloud(path))
    except ValueError as exc:
        raise IdentifyError("The room outline could not be measured.") from exc


def _apply_level(plan: Plan, level: Any) -> Plan:
    if not plan.levels:
        return plan.model_copy(update={"levels": [level]})
    current = plan.levels[0]
    replacement = level.model_copy(
        update={"id": current.id, "name": current.name, "fixtures": []}
    )
    return plan.model_copy(update={"levels": [replacement, *plan.levels[1:]]})


def _ensure_level(plan: Plan, measured: Level | None) -> Plan:
    if measured is not None:
        return _apply_level(plan, measured)
    if plan.levels:
        return plan
    return _apply_level(
        plan,
        Level(id="L1", name="Level 1", elevation=0.0, ceilingHeight=2.7),
    )


def _prompt(shot: ViewShot, bounds: RoomBounds | None = None) -> str:
    symbols = ", ".join(_SYMBOLS[:-1])
    corners = (
        ("top-left", 0.0, 0.0),
        ("top-right", 1.0, 0.0),
        ("bottom-left", 0.0, 1.0),
        ("bottom-right", 1.0, 1.0),
    )
    placed = []
    for name, nx, ny in corners:
        point = plan_xy(nx, ny, shot)
        if point is not None:
            placed.append(
                f"the {name} corner meets the floor at x={point[0]:.2f} m, y={point[1]:.2f} m"
            )
    where = " ".join(placed)
    return (
        "This picture is the 3D view exactly as shown, including its zoom and point size. "
        f"{where} "
        f"{_room_sentence(bounds)}"
        "Identify toilets, bathtubs, sinks, showers, counters, stoves, beds, sofas, tables, "
        "and wardrobes that are visible. Reply with JSON only. Do not ask questions. "
        '{"fixtures":[{"symbol":"bathtub","nx":0.30,"ny":0.62,"spanX":0.28,"spanY":0.10,'
        '"back":"left","confidence":0.8}]} '
        "nx and ny are the center. 0 is the left or top edge, 1 is the right or bottom edge. "
        "spanX is the full width of the object as a fraction of the picture width. "
        "spanY is its full height as a fraction of the picture height. "
        "A bathtub that stretches across a large part of the room must use that large span, "
        "not a small guess. Do not report metres or degrees. "
        "back is the picture edge the back points toward: up, down, left, or right. "
        "The back of a toilet is the rectangular tank, not the oval bowl. "
        "If the tank is above the bowl, back is up. If the tank is below the bowl, back is down. "
        "If the tank is right of the bowl, back is right. "
        "If the tank is left of the bowl, back is left. "
        "The back of a sink is the tap. The back of a bed is the pillows. "
        "The back of a sofa is the backrest. "
        "A sideways bathtub has back left or right. An upright bathtub has back up or down. "
        f"symbol must be one of: {symbols}. "
        'If nothing is recognizable, return {"fixtures":[]}.'
    )


def _room_sentence(bounds: RoomBounds | None) -> str:
    if bounds is None:
        return ""
    return (
        f"The interior area is {bounds.area:.2f} m². "
        f"It lies between x={bounds.min_x:.2f} m and x={bounds.max_x:.2f} m, "
        f"and between y={bounds.min_y:.2f} m and y={bounds.max_y:.2f} m. "
        "Keep every object inside that interior. "
        "A few centimetres past the wall is allowed. "
        "Do not place anything outside the room. "
    )


def _png_bytes(image: str) -> bytes:
    payload = image.split(",", 1)[1] if image.startswith("data:") else image
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise IdentifyError("The screenshot could not be read.") from exc
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise IdentifyError("The screenshot could not be read.")
    if len(raw) > 12_000_000:
        raise IdentifyError("The screenshot is too large.")
    return raw


def _place(plan: Plan, found: list[ParsedFixture]) -> Plan:
    level = plan.levels[0]
    fixtures = [
        Fixture.model_validate(
            {
                "id": f"f{index}",
                "symbol": item.symbol,
                "x": item.x,
                "y": item.y,
                "rotationDeg": item.rotation_deg,
                "width": item.width,
                "depth": item.depth,
                "confidence": item.confidence,
                "role": item.role,
            }
        )
        for index, item in enumerate(found, start=1)
    ]
    levels = [level.model_copy(update={"fixtures": fixtures}), *plan.levels[1:]]
    return plan.model_copy(update={"levels": levels})


def _unit(value: object) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if number < 0 or number > 1:
        return None
    return number


def _confidence(value: object) -> float:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.6
    return min(1.0, max(0.0, number))
