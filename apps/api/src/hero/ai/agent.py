"""Local Cursor agent. Tests use a fake with the same propose method."""

from __future__ import annotations

import importlib
import json
import os
import sys
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Protocol

from hero.ai.ops import dump_op, parse_op
from hero.ai.session import ProposalError, ToolSession

_MODEL = "composer-2.5"
_RUN_TIMEOUT_S = 90.0
_PROMPT = """You edit one 2D Hero floor plan. Change it only through the hero MCP tools \
(get_plan, list_issues, set_wall_thickness, move_wall, set_opening, set_room_name, apply_ops). \
Do not write plan.json or any other file.

Read the review images in this project folder:
- review/underlay.png
- review/plan.svg

Instruction:
{instruction}
"""


class _PipeWaitSelector:
    """Wait without ``select``. Windows ``select`` accepts sockets, not pipes."""

    def register(self, fileobj: object, events: int, data: object = None) -> None:
        del fileobj, events, data

    def select(self, timeout: float | None = None) -> list[object]:
        if timeout:
            time.sleep(timeout)
        return []

    def close(self) -> None:
        return None

    def __enter__(self) -> _PipeWaitSelector:
        return self

    def __exit__(self, *_args: object) -> None:
        return None


@contextmanager
def use_pipe_wait() -> Iterator[None]:
    """Read the bridge startup line, then keep draining its log pipe.

    Windows ``select`` cannot wait on the startup pipe. Leaving stderr unread
    after that line also fills the pipe and stalls the bridge.
    """
    bridge = importlib.import_module("cursor_sdk._bridge")
    original_read = bridge._read_discovery

    def read_discovery(process: Any, timeout: float) -> Any:
        if os.name == "nt":
            selectors = bridge.selectors
            saved = selectors.DefaultSelector
            selectors.DefaultSelector = _PipeWaitSelector
            try:
                discovery = original_read(process, timeout)
            finally:
                selectors.DefaultSelector = saved
        else:
            discovery = original_read(process, timeout)
        _drain_stderr(process)
        return discovery

    setattr(bridge, "_read_discovery", read_discovery)
    try:
        yield
    finally:
        setattr(bridge, "_read_discovery", original_read)


def _reply_text(reply: str) -> str:
    text = reply.strip()
    if not text:
        return "The assistant did not change the plan."
    if len(text) > 500:
        return text[:500].rstrip() + "..."
    return text


def _wait_for_run(run: Any) -> Any:
    """Stop a run that never finishes so the request can return."""
    outcome: dict[str, Any] = {}

    def target() -> None:
        try:
            outcome["result"] = run.wait()
        except Exception as exc:
            outcome["error"] = exc

    thread = threading.Thread(target=target, name="cursor-run-wait", daemon=True)
    thread.start()
    thread.join(_RUN_TIMEOUT_S)
    if thread.is_alive():
        if run.supports("cancel"):
            try:
                run.cancel()
            except Exception:
                pass
        raise ProposalError("The assistant took too long.")
    if "error" in outcome:
        raise outcome["error"]
    return outcome.get("result")


def _drain_stderr(process: Any) -> None:
    stderr = process.stderr
    if stderr is None:
        return

    def drain() -> None:
        try:
            while True:
                chunk = stderr.read(4096)
                if not chunk:
                    break
        except Exception:
            return

    threading.Thread(target=drain, name="cursor-bridge-stderr", daemon=True).start()


class PlanAgent(Protocol):
    """Produces ops. It must not write plan.json or log the API key."""

    def propose(self, project_dir: Path, instruction: str, api_key: str) -> list[dict[str, Any]]:
        """Return validated ops for this instruction."""
        ...


class CursorPlanAgent:
    """Local SDK agent. The key argument is the keyring value, never the environment."""

    def propose(self, project_dir: Path, instruction: str, api_key: str) -> list[dict[str, Any]]:
        """Run one local agent turn and return the ops its tools recorded."""
        proposal_path = project_dir / "review" / "proposal.json"
        if proposal_path.is_file():
            proposal_path.unlink()
        original = ToolSession.open(project_dir)
        reply = self._run(project_dir, instruction, api_key)
        if not proposal_path.is_file():
            raise ProposalError(_reply_text(reply))
        loaded = json.loads(proposal_path.read_text(encoding="utf-8"))
        raw_ops = loaded.get("ops") if isinstance(loaded, dict) else None
        if not isinstance(raw_ops, list):
            raise ProposalError("The assistant did not return plan operations.")
        if not raw_ops:
            raise ProposalError(_reply_text(reply))
        check = ToolSession(original.plan)
        for item in raw_ops:
            if not isinstance(item, dict):
                raise ProposalError("The assistant did not return plan operations.")
            arguments = {key: value for key, value in item.items() if key != "op"}
            result = check.call(str(item.get("op", "")), arguments)
            if not result["ok"]:
                raise ProposalError(str(result["error"]))
        return [dump_op(parse_op(op)) for op in check.ops]

    def _run(self, project_dir: Path, instruction: str, api_key: str) -> str:
        try:
            sdk = importlib.import_module("cursor_sdk")
        except ImportError as exc:
            raise ProposalError("The assistant package is not installed.") from exc
        agent_options = sdk.AgentOptions(
            model=_MODEL,
            api_key=api_key,
            local=sdk.LocalAgentOptions(cwd=project_dir),
            mcp_servers={
                "hero": sdk.StdioMcpServerConfig(
                    command=sys.executable,
                    args=["-m", "hero.mcp", str(project_dir)],
                    cwd=project_dir,
                )
            },
            tools=["read", "mcp"],
        )
        with use_pipe_wait():
            with sdk.Agent.create(agent_options) as agent:
                run = agent.send(_PROMPT.format(instruction=instruction))
                result = _wait_for_run(run)
        if getattr(result, "status", "") == "error":
            raise ProposalError("The assistant could not run.")
        text = getattr(result, "result", "")
        return text.strip() if isinstance(text, str) else ""
