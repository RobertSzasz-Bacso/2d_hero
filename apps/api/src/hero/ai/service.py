"""Propose, accept, and reject. The plan file changes only on accept."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from hero.ai.agent import PlanAgent
from hero.ai.ops import apply_op, parse_op
from hero.ai.review import write_review
from hero.ai.session import ProposalError
from hero.atomic import atomic_write_bytes
from hero.keystore import get_cursor_key
from hero.projects import ProjectNotFound, ProjectStore, RevisionConflict
from hero.schema import Plan

logger = logging.getLogger("hero")

_NO_KEY = (
    "No Cursor key is saved. Open Settings on the project list and save a key."
)
_NO_PROPOSAL = "There is no proposal to accept."

_pending: dict[str, list[dict[str, Any]]] = {}


@dataclass
class AiResponse:
    status: int
    body: dict[str, Any]


def propose_edit(
    store: ProjectStore,
    project_id: str,
    instruction: str,
    agent: PlanAgent,
) -> AiResponse:
    """Ask the agent for ops. Does not write plan.json."""
    text = instruction.strip()
    if not text:
        return AiResponse(400, {"detail": "An instruction is required."})
    try:
        folder = store.project_dir(project_id)
        plan = store.read_plan(project_id)
    except ProjectNotFound:
        return AiResponse(404, {"detail": "Project was not found."})
    key = get_cursor_key()
    if not key:
        logger.info("ai proposal skipped")
        return AiResponse(200, {"cursorKeySet": False, "ops": [], "detail": _NO_KEY})
    write_review(folder, plan)
    plan_path = folder / "plan.json"
    snapshot = plan_path.read_bytes()
    try:
        ops = agent.propose(folder, text, key)
    except ProposalError as exc:
        logger.info("ai proposal was not valid")
        _restore(plan_path, snapshot)
        return AiResponse(200, {"cursorKeySet": True, "ops": [], "error": str(exc)})
    except Exception:
        logger.info("ai proposal failed")
        _restore(plan_path, snapshot)
        return AiResponse(
            200,
            {"cursorKeySet": True, "ops": [], "error": "The assistant could not run."},
        )
    _restore(plan_path, snapshot)
    _pending[project_id] = ops
    logger.info("ai proposal stored")
    return AiResponse(200, {"cursorKeySet": True, "ops": ops})


def accept_proposal(store: ProjectStore, project_id: str) -> AiResponse:
    """Apply the stored ops as one new revision."""
    ops = _pending.get(project_id)
    if not ops:
        return AiResponse(400, {"detail": _NO_PROPOSAL})
    try:
        folder = store.project_dir(project_id)
        current = store.read_plan(project_id)
    except ProjectNotFound:
        return AiResponse(404, {"detail": "Project was not found."})
    try:
        updated = _apply_all(current, ops)
        saved = store.save_plan(project_id, updated, if_match=current.revision)
    except (ProposalError, ValueError) as exc:
        logger.info("ai proposal was not valid")
        return AiResponse(400, {"detail": str(exc)})
    except RevisionConflict:
        return AiResponse(409, {"detail": "This plan was saved somewhere else. Reloaded."})
    _pending.pop(project_id, None)
    _delete_proposal(folder)
    logger.info("ai proposal accepted")
    return AiResponse(200, saved.model_dump(mode="json"))


def reject_proposal(store: ProjectStore, project_id: str) -> AiResponse:
    """Drop the stored ops. The plan file stays as it is."""
    try:
        folder = store.project_dir(project_id)
        store.read_plan(project_id)
    except ProjectNotFound:
        return AiResponse(404, {"detail": "Project was not found."})
    _pending.pop(project_id, None)
    _delete_proposal(folder)
    logger.info("ai proposal rejected")
    return AiResponse(200, {"ok": True})


def _apply_all(plan: Plan, ops: list[dict[str, Any]]) -> Plan:
    updated = plan
    for item in ops:
        updated = apply_op(updated, parse_op(item))
    return updated


def _restore(path: Path, snapshot: bytes) -> None:
    if path.read_bytes() != snapshot:
        atomic_write_bytes(path, snapshot)


def _delete_proposal(folder: Path) -> None:
    path = folder / "review" / "proposal.json"
    if path.is_file():
        path.unlink()
