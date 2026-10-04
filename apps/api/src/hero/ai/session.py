"""In-memory plan tools. Successful ops are recorded. plan.json is never written."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from hero.ai.ops import apply_op, dump_op, error_text, parse_op
from hero.atomic import atomic_write_text
from hero.schema import Plan


class ProposalError(Exception):
    """The tools rejected the change. The message is safe to show."""


class ToolSession:
    """Working copy of a plan plus the ops that produced it."""

    def __init__(self, plan: Plan, proposal_path: Path | None = None) -> None:
        self.plan = plan
        self.ops: list[dict[str, Any]] = []
        self.proposal_path = proposal_path

    @classmethod
    def open(cls, project_dir: Path) -> ToolSession:
        """Load plan.json. The proposal file is separate and starts empty in memory."""
        plan = Plan.model_validate_json((project_dir / "plan.json").read_text(encoding="utf-8"))
        return cls(plan, project_dir / "review" / "proposal.json")

    def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Run one tool. Failures leave the recorded ops unchanged."""
        try:
            if name == "get_plan":
                return {"ok": True, "plan": self.plan.model_dump(mode="json")}
            if name == "list_issues":
                issues = [issue.model_dump(mode="json") for issue in self.plan.detection.issues]
                return {"ok": True, "issues": issues}
            if name == "apply_ops":
                return self._apply_batch(arguments.get("ops"))
            payload = dict(arguments)
            payload["op"] = name
            op = parse_op(payload)
            return self._commit([op])
        except (ValidationError, ValueError) as exc:
            return {"ok": False, "error": error_text(exc)}

    def _apply_batch(self, raw: Any) -> dict[str, Any]:
        if not isinstance(raw, list):
            return {"ok": False, "error": "ops must be a list"}
        parsed = [parse_op(item) if isinstance(item, dict) else parse_op({}) for item in raw]
        return self._commit(parsed)

    def _commit(self, ops: list[Any]) -> dict[str, Any]:
        trial = self.plan
        dumped: list[dict[str, Any]] = []
        for op in ops:
            trial = apply_op(trial, op)
            dumped.append(dump_op(op))
        self.plan = trial
        self.ops.extend(dumped)
        self._write()
        if len(dumped) == 1:
            return {"ok": True, "op": dumped[0]}
        return {"ok": True, "ops": dumped}

    def _write(self) -> None:
        if self.proposal_path is None:
            return
        text = json.dumps({"ops": self.ops}, indent=2) + "\n"
        atomic_write_text(self.proposal_path, text)
