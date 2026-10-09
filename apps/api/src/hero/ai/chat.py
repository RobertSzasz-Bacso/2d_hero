"""One Cursor reply. No plan tools and no wait for the whole run to finish."""

from __future__ import annotations

import importlib
import io
import json
import logging
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
from collections.abc import Callable
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

from hero.ai.agent import use_pipe_wait
from hero.ai.session import ProposalError

logger = logging.getLogger("hero")

_MODEL = "composer-2.5"
_VISION_MODEL = "gemini-3.7-flash"
_QUIET_S = 1.2
_LIMIT_S = 45.0
_REVIEW_ROUNDS = 4


def ask_cursor(message: str, api_key: str) -> str:
    """Send one message and return the first reply Cursor streams back."""
    text = message.strip()
    if not text:
        raise ProposalError("A message is required.")
    return _ask(text, api_key, limit_s=_LIMIT_S)


def ask_with_image(prompt: str, png: bytes, api_key: str) -> str:
    """Send one picture and return the reply. The key is not written into the prompt."""
    try:
        sdk = importlib.import_module("cursor_sdk")
    except ImportError as exc:
        raise ProposalError("The assistant package is not installed.") from exc
    image = sdk.SDKImage.from_data(png, "image/png")
    message = sdk.UserMessage(text=prompt, images=[image])
    selection = _vision_selection(sdk)
    logger.info("cursor image ask bytes=%s model=%s", len(png), _model_label(selection))
    return _ask(message, api_key, limit_s=120.0, model=selection, complete=True)


def ask_with_images(prompt: str, pictures: list[bytes], api_key: str) -> str:
    """Send several pictures in one message and return the reply."""
    try:
        sdk = importlib.import_module("cursor_sdk")
    except ImportError as exc:
        raise ProposalError("The assistant package is not installed.") from exc
    images = [sdk.SDKImage.from_data(picture, "image/png") for picture in pictures]
    message = sdk.UserMessage(text=prompt, images=images)
    selection = _vision_selection(sdk)
    logger.info("cursor image ask count=%s model=%s", len(pictures), _model_label(selection))
    return _ask(message, api_key, limit_s=120.0, model=selection, complete=True)


def ask_mask(prompt: str, pictures: list[bytes], api_key: str) -> bytes:
    """Ask Cursor for an SVG mask and rasterize its flat shapes locally.

    The installed Cursor SDK accepts image input but does not expose the
    editor's native image-generation tool. SVG is therefore the portable
    image artifact: the model still has to paint a complete mask, while the
    application owns the final pixels and palette.
    """

    reply = ask_with_images(prompt, pictures, api_key)
    return _svg_mask_png(reply)


def _svg_mask_png(reply: str, *, size: int = 768) -> bytes:
    start = reply.find("<svg")
    end = reply.rfind("</svg>")
    if start < 0 or end < start:
        raise ProposalError("Cursor did not return a mask image.")
    try:
        root = ET.fromstring(reply[start : end + len("</svg>")])
    except ET.ParseError as exc:
        raise ProposalError("Cursor returned an invalid mask image.") from exc
    viewbox = root.get("viewBox", "0 0 768 768").split()
    if len(viewbox) != 4:
        raise ProposalError("Cursor returned an invalid mask frame.")
    try:
        min_x, min_y, view_width, view_height = (float(value) for value in viewbox)
    except ValueError as exc:
        raise ProposalError("Cursor returned an invalid mask frame.") from exc
    if view_width <= 0 or view_height <= 0:
        raise ProposalError("Cursor returned an invalid mask frame.")
    canvas = Image.new("RGB", (size, size), (0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    def point(value_x: str, value_y: str) -> tuple[float, float]:
        x = (float(value_x) - min_x) / view_width * size
        y = (float(value_y) - min_y) / view_height * size
        return x, y

    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1]
        fill = element.get("fill")
        if not fill or not fill.startswith("#") or len(fill) not in {4, 7}:
            continue
        if len(fill) == 4:
            fill = "#" + "".join(char * 2 for char in fill[1:])
        colour = tuple(int(fill[index : index + 2], 16) for index in (1, 3, 5))
        try:
            if tag == "rect":
                x, y = point(element.get("x", "0"), element.get("y", "0"))
                right, bottom = point(
                    str(float(element.get("x", "0")) + float(element.get("width", "0"))),
                    str(float(element.get("y", "0")) + float(element.get("height", "0"))),
                )
                draw.rectangle((x, y, right, bottom), fill=colour)
            elif tag == "ellipse":
                cx, cy = point(element.get("cx", "0"), element.get("cy", "0"))
                rx = float(element.get("rx", "0")) / view_width * size
                ry = float(element.get("ry", "0")) / view_height * size
                draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=colour)
            elif tag == "circle":
                cx, cy = point(element.get("cx", "0"), element.get("cy", "0"))
                radius = float(element.get("r", "0")) / view_width * size
                draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=colour)
            elif tag == "polygon":
                values = element.get("points", "").replace(",", " ").split()
                if len(values) < 6 or len(values) % 2:
                    continue
                draw.polygon(
                    [point(values[index], values[index + 1]) for index in range(0, len(values), 2)],
                    fill=colour,
                )
        except (TypeError, ValueError):
            raise ProposalError("Cursor returned an invalid mask shape.") from None
    output = io.BytesIO()
    canvas.save(output, format="PNG")
    return output.getvalue()


def review_picture(
    prompt: str,
    png: bytes,
    api_key: str,
    judge: Callable[[str], str],
    *,
    remember: Callable[[str], None] | None = None,
    on_retry: Callable[[str], None] | None = None,
) -> str:
    """Send the picture, then send each rejection back on the same Cursor agent."""
    try:
        sdk = importlib.import_module("cursor_sdk")
    except ImportError as exc:
        raise ProposalError("The assistant package is not installed.") from exc
    image = sdk.SDKImage.from_data(png, "image/png")
    first = sdk.UserMessage(text=prompt, images=[image])
    selection = _vision_selection(sdk)
    logger.info("cursor image ask bytes=%s model=%s", len(png), _model_label(selection))
    reply = _review(sdk, first, api_key, selection, judge, remember, on_retry)
    return reply


def _vision_selection(sdk: Any) -> Any:
    """Gemini 3.7 Flash. High effort thinks past the detection limit without answering."""
    return sdk.ModelSelection(
        id=_VISION_MODEL,
        params=(sdk.ModelParameterValue(id="effort", value="medium"),),
    )


def _review(
    sdk: Any,
    first: Any,
    api_key: str,
    model: Any,
    judge: Callable[[str], str],
    remember: Callable[[str], None] | None,
    on_retry: Callable[[str], None] | None,
) -> str:
    cwd = Path(tempfile.gettempdir()) / "hero-cursor-demo"
    cwd.mkdir(exist_ok=True)
    state: dict[str, Any] = {
        "chunks": [],
        "notes": [],
        "stop": False,
        "message": first,
        "ready": threading.Event(),
        "idle": threading.Event(),
    }
    failure: list[BaseException] = []

    def consume() -> None:
        try:
            with use_pipe_wait():
                options = sdk.AgentOptions(
                    model=model,
                    api_key=api_key,
                    local=sdk.LocalAgentOptions(cwd=cwd),
                    tools=[],
                )
                with sdk.Agent.create(options) as agent:
                    state["idle"].set()
                    while True:
                        state["ready"].wait()
                        state["ready"].clear()
                        message = state["message"]
                        if message is None:
                            return
                        run = agent.send(message)
                        try:
                            for event in run.events():
                                _observe(event, state["chunks"], state["notes"])
                                if state["stop"]:
                                    break
                        finally:
                            _cancel(run)
                        state["idle"].set()
        except Exception as exc:
            failure.append(exc)
            state["idle"].set()

    thread = threading.Thread(target=consume, name="cursor-review", daemon=True)
    thread.start()
    if not state["idle"].wait(60):
        state["message"] = None
        state["ready"].set()
        raise ProposalError("Cursor could not answer.")
    message: Any = first
    error = ""
    reply = ""
    for index in range(_REVIEW_ROUNDS):
        state["chunks"].clear()
        state["notes"].clear()
        state["stop"] = False
        state["idle"].clear()
        state["message"] = message
        state["ready"].set()
        reply = _wait_round(state, 120.0)
        if failure and not reply:
            detail = _exception_text(failure[0]).replace(api_key, "")
            _finish_review(state, thread)
            raise ProposalError(detail or "Cursor could not answer.") from failure[0]
        if not reply:
            _finish_review(state, thread)
            raise ProposalError("Cursor did not answer.")
        if remember is not None:
            remember(reply)
        error = judge(reply)
        if not error:
            _finish_review(state, thread)
            return reply
        if index + 1 == _REVIEW_ROUNDS:
            break
        logger.info("cursor identify correction: %s", error[:500])
        if on_retry is not None:
            on_retry(error)
        message = error
    _finish_review(state, thread)
    raise ProposalError(error or "Cursor did not correct the furniture.")


def _wait_round(state: dict[str, Any], limit_s: float) -> str:
    quiet = 0.0
    previous = 0
    started = time.monotonic()
    while time.monotonic() - started < limit_s:
        if state["idle"].is_set():
            break
        time.sleep(0.2)
        current = len("".join(state["chunks"]))
        if current and current == previous:
            quiet += 0.2
            if _stop_for_quiet(complete=True, quiet=quiet, text="".join(state["chunks"])):
                break
        else:
            quiet = 0.0
            previous = current
    state["stop"] = True
    state["idle"].wait(10)
    return _bounded_reply("".join(state["chunks"]).strip(), complete=True)


def _finish_review(state: dict[str, Any], thread: threading.Thread) -> None:
    state["message"] = None
    state["stop"] = True
    state["ready"].set()
    thread.join(5)


def _ask(
    message: Any,
    api_key: str,
    *,
    limit_s: float,
    model: Any = _MODEL,
    complete: bool = False,
) -> str:
    try:
        sdk = importlib.import_module("cursor_sdk")
    except ImportError as exc:
        raise ProposalError("The assistant package is not installed.") from exc

    cwd = Path(tempfile.gettempdir()) / "hero-cursor-demo"
    cwd.mkdir(exist_ok=True)
    chunks: list[str] = []
    notes: list[str] = []
    holder: dict[str, Any] = {}
    failure: list[BaseException] = []
    label = _model_label(model)

    def consume() -> None:
        try:
            with use_pipe_wait():
                options = sdk.AgentOptions(
                    model=model,
                    api_key=api_key,
                    local=sdk.LocalAgentOptions(cwd=cwd),
                    tools=[],
                )
                with sdk.Agent.create(options) as agent:
                    run = agent.send(message)
                    holder["run"] = run
                    for event in run.events():
                        _observe(event, chunks, notes)
                        if holder.get("stop"):
                            break
                    holder["status"] = str(getattr(run, "status", "") or "")
                    holder["result"] = str(getattr(run, "result", "") or "")
                    _cancel(run)
        except Exception as exc:
            failure.append(exc)

    thread = threading.Thread(target=consume, name="cursor-ask", daemon=True)
    thread.start()
    quiet = 0.0
    previous = 0
    started = time.monotonic()
    while thread.is_alive() and time.monotonic() - started < limit_s:
        time.sleep(0.2)
        current = len("".join(chunks))
        if current and current == previous:
            quiet += 0.2
            if _stop_for_quiet(complete=complete, quiet=quiet, text="".join(chunks)):
                break
        else:
            quiet = 0.0
            previous = current
    holder["stop"] = True
    _cancel(holder.get("run"))
    thread.join(5)
    elapsed = time.monotonic() - started
    reply = "".join(chunks).strip()
    if reply:
        logger.info(
            "cursor ask answered model=%s elapsed=%.1fs chars=%s",
            label,
            elapsed,
            len(reply),
        )
        return _bounded_reply(reply, complete=complete)
    error = ""
    if failure:
        error = _exception_text(failure[0])
    report = cursor_failure_report(
        model_label=label,
        elapsed_s=elapsed,
        alive=thread.is_alive(),
        run_status=str(holder.get("status") or ""),
        result=str(holder.get("result") or ""),
        notes=notes,
        error=error,
        api_key=api_key,
    )
    logger.info("cursor ask %s", report)
    cause = failure[0] if failure else None
    raise ProposalError(report) from cause


def _stop_for_quiet(*, complete: bool, quiet: float, text: str) -> bool:
    """Chat may end after a short pause. A fixture list must be closed JSON first."""
    if quiet < _QUIET_S:
        return False
    if not complete:
        return True
    return _json_closed(text)


def _json_closed(text: str) -> bool:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return False
    try:
        json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return False
    return True


def _bounded_reply(reply: str, *, complete: bool) -> str:
    if complete or len(reply) <= 4000:
        return reply
    return reply[:4000].rstrip() + "..."


def _model_label(model: Any) -> str:
    if isinstance(model, str):
        return model
    params = getattr(model, "params", ()) or ()
    bits = [f"{getattr(item, 'id', '')}={getattr(item, 'value', '')}" for item in params]
    name = str(getattr(model, "id", "") or model)
    return f"{name} {' '.join(bits)}".strip()


def _observe(event: Any, chunks: list[str], notes: list[str]) -> None:
    message = getattr(event, "sdk_message", None)
    if message is not None:
        kind = str(getattr(message, "type", "") or "message")
        if kind == "assistant":
            content = getattr(getattr(message, "message", None), "content", ())
            wrote = False
            for block in content or ():
                text = getattr(block, "text", "")
                if text:
                    chunks.append(text)
                    wrote = True
            if wrote and len(notes) < 12:
                notes.append("assistant")
        elif len(notes) < 12 and kind == "status":
            status = getattr(message, "status", "")
            detail = str(getattr(message, "message", "") or "")
            notes.append(f"status {status}: {detail[:180]}".strip())
        elif kind == "thinking":
            if "thinking" not in notes and len(notes) < 12:
                size = len(str(getattr(message, "text", "") or ""))
                notes.append(f"thinking {size} chars")
        elif len(notes) < 12:
            notes.append(kind)
    update = getattr(event, "interaction_update", None)
    if update is not None:
        kind = str(getattr(update, "type", "") or "update")
        if kind == "text-delta":
            text = getattr(update, "text", "")
            if text:
                chunks.append(text)
            if "text" not in notes and len(notes) < 12:
                notes.append("text")
        elif kind == "thinking-delta":
            if "thinking-delta" not in notes and len(notes) < 12:
                notes.append("thinking-delta")
        elif len(notes) < 12 and kind not in notes:
            notes.append(kind)
    result = getattr(event, "result", None)
    if result is not None and len(notes) < 12:
        notes.append(f"result {getattr(result, 'status', '')}".strip())


def cursor_failure_report(
    *,
    model_label: str,
    elapsed_s: float,
    alive: bool,
    run_status: str,
    result: str,
    notes: list[str],
    error: str,
    api_key: str,
) -> str:
    """One line a person can read. The API key is never included."""
    parts = [
        "Cursor did not answer.",
        f"model={model_label}",
        f"elapsed={elapsed_s:.1f}s",
        f"thread={'running' if alive else 'finished'}",
        f"run={run_status or 'unknown'}",
    ]
    if result:
        parts.append(f"result={result[:180]}")
    if notes:
        parts.append("events=" + " | ".join(notes[:8]))
    if error:
        parts.append(f"error={error}")
    return _redact(" ".join(parts), api_key)


def _exception_text(exc: BaseException) -> str:
    code = getattr(exc, "code", None)
    status = getattr(exc, "status", None)
    bits = [type(exc).__name__, str(exc)]
    if code:
        bits.append(f"code={code}")
    if status:
        bits.append(f"status={status}")
    return " ".join(bits)[:300]


def _redact(text: str, api_key: str) -> str:
    cleaned = " ".join(text.split())
    if api_key:
        cleaned = cleaned.replace(api_key, "[key]")
    return cleaned[:500]


def _cancel(run: Any) -> None:
    if run is None or not run.supports("cancel"):
        return
    try:
        run.cancel()
    except Exception:
        return
