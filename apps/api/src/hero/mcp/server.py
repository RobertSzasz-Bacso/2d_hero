"""MCP tools over an in-memory plan. They do not write plan.json."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from mcp.server.mcpserver import MCPServer

from hero.ai.session import ToolSession

server = MCPServer("hero")
_session: ToolSession | None = None
_failed = False


def tool_names() -> set[str]:
    """Names registered on the stdio server."""
    import asyncio

    tools = asyncio.run(server.list_tools())
    return {tool.name for tool in tools}


def _current() -> ToolSession | None:
    global _session, _failed
    if _session is not None or _failed:
        return _session
    raw = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("HERO_PROJECT_DIR", "")
    folder = Path(raw)
    plan = folder / "plan.json"
    if not plan.is_file():
        _failed = True
        return None
    _session = ToolSession.open(folder)
    return _session


def _reply(payload: dict[str, Any]) -> str:
    return json.dumps(payload)


@server.tool()
def get_plan() -> str:
    """Return the working plan JSON. Does not write plan.json."""
    current = _current()
    if current is None:
        return _reply({"ok": False, "error": "The project folder is missing."})
    return _reply(current.call("get_plan", {}))


@server.tool()
def list_issues() -> str:
    """Return detection issues on the working plan."""
    current = _current()
    if current is None:
        return _reply({"ok": False, "error": "The project folder is missing."})
    return _reply(current.call("list_issues", {}))


@server.tool()
def set_wall_thickness(levelId: str, wallId: str, thickness: float) -> str:
    """Set one wall thickness in metres. Returns an error payload when the wall is unknown."""
    current = _current()
    if current is None:
        return _reply({"ok": False, "error": "The project folder is missing."})
    return _reply(
        current.call(
            "set_wall_thickness",
            {"levelId": levelId, "wallId": wallId, "thickness": thickness},
        )
    )


@server.tool()
def move_wall(levelId: str, wallId: str, dx: float, dy: float) -> str:
    """Move one wall by a plan-metre delta. Does not write plan.json."""
    current = _current()
    if current is None:
        return _reply({"ok": False, "error": "The project folder is missing."})
    return _reply(
        current.call(
            "move_wall",
            {"levelId": levelId, "wallId": wallId, "dx": dx, "dy": dy},
        )
    )


@server.tool()
def set_opening(
    levelId: str,
    openingId: str,
    kind: str | None = None,
    offset: float | None = None,
    width: float | None = None,
    sill: float | None = None,
    head: float | None = None,
    swing: str | None = None,
    swingSide: str | None = None,
    confidence: float | None = None,
) -> str:
    """Edit one opening. Omitted fields stay as they are."""
    current = _current()
    if current is None:
        return _reply({"ok": False, "error": "The project folder is missing."})
    arguments: dict[str, Any] = {"levelId": levelId, "openingId": openingId}
    for key, value in (
        ("kind", kind),
        ("offset", offset),
        ("width", width),
        ("sill", sill),
        ("head", head),
        ("swing", swing),
        ("swingSide", swingSide),
        ("confidence", confidence),
    ):
        if value is not None:
            arguments[key] = value
    return _reply(current.call("set_opening", arguments))


@server.tool()
def set_room_name(levelId: str, roomId: str, name: str, number: str | None = None) -> str:
    """Rename one room seed."""
    current = _current()
    if current is None:
        return _reply({"ok": False, "error": "The project folder is missing."})
    arguments: dict[str, Any] = {"levelId": levelId, "roomId": roomId, "name": name}
    if number is not None:
        arguments["number"] = number
    return _reply(current.call("set_room_name", arguments))


@server.tool()
def apply_ops(ops: list[dict[str, Any]]) -> str:
    """Apply a batch of plan ops. A failed batch does not change the proposal."""
    current = _current()
    if current is None:
        return _reply({"ok": False, "error": "The project folder is missing."})
    return _reply(current.call("apply_ops", {"ops": ops}))
