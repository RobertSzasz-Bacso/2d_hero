"""Deterministic agent for the browser tests. It never calls the network."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import keyring
from keyring.backend import KeyringBackend
from keyring.compat import properties
from keyring.errors import PasswordDeleteError

from hero.ai.session import ProposalError, ToolSession
from hero.keystore import set_cursor_key

_THICKNESS = re.compile(r"^thickness\s+([A-Za-z][A-Za-z0-9_-]{0,31})\s+([0-9]+(?:\.[0-9]+)?)$")
_E2E_KEY = "e2e-assistant"


class _MemoryKeyring(KeyringBackend):
    """Process-local key store so the browser tests never touch Credential Manager."""

    @properties.classproperty
    def priority(cls) -> float:  # noqa: N805
        return 1

    def __init__(self) -> None:
        super().__init__()
        self._passwords: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self._passwords.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self._passwords[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        try:
            del self._passwords[(service, username)]
        except KeyError as exc:
            raise PasswordDeleteError(service, username) from exc


class InstructionAgent:
    """Reads one thickness instruction and calls set_wall_thickness."""

    def propose(self, project_dir: Path, instruction: str, api_key: str) -> list[dict[str, Any]]:
        del api_key
        match = _THICKNESS.fullmatch(instruction.strip())
        if match is None:
            raise ProposalError("Say thickness, a wall id, and a width in metres.")
        session = ToolSession.open(project_dir)
        if not session.plan.levels:
            raise ProposalError("This plan has no level.")
        result = session.call(
            "set_wall_thickness",
            {
                "levelId": session.plan.levels[0].id,
                "wallId": match.group(1),
                "thickness": float(match.group(2)),
            },
        )
        if not result["ok"]:
            raise ProposalError(str(result["error"]))
        return list(session.ops)


def e2e_agent() -> InstructionAgent:
    """Install a memory keyring and a fake agent for the Playwright server."""
    keyring.set_keyring(_MemoryKeyring())
    set_cursor_key(_E2E_KEY)
    return InstructionAgent()
