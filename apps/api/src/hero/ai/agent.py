"""Local Cursor agent. Tests use a fake with the same propose method."""

from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path
from typing import Any, Protocol

from hero.ai.ops import dump_op, parse_op
from hero.ai.session import ProposalError, ToolSession

_MODEL = "composer-2.5"
_PROMPT = """You edit one 2D Hero floor plan. Change it only through the hero MCP tools \
(get_plan, list_issues, set_wall_thickness, move_wall, set_opening, set_room_name, apply_ops). \
Do not write plan.json or any other file.

Read the review images in this project folder:
- review/underlay.png
- review/plan.svg

Instruction:
{instruction}
"""


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
        self._run(project_dir, instruction, api_key)
        if not proposal_path.is_file():
            return []
        loaded = json.loads(proposal_path.read_text(encoding="utf-8"))
        raw_ops = loaded.get("ops") if isinstance(loaded, dict) else None
        if not isinstance(raw_ops, list):
            raise ProposalError("The assistant did not return plan operations.")
        check = ToolSession(original.plan)
        for item in raw_ops:
            if not isinstance(item, dict):
                raise ProposalError("The assistant did not return plan operations.")
            arguments = {key: value for key, value in item.items() if key != "op"}
            result = check.call(str(item.get("op", "")), arguments)
            if not result["ok"]:
                raise ProposalError(str(result["error"]))
        return [dump_op(parse_op(op)) for op in check.ops]

    def _run(self, project_dir: Path, instruction: str, api_key: str) -> None:
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
        with sdk.Agent.create(agent_options) as agent:
            run = agent.send(_PROMPT.format(instruction=instruction))
            run.wait()
