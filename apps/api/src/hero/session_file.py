"""Atomic writes for the process session token."""

import os
from pathlib import Path


def write_token(path: Path, token: str) -> None:
    """Write the session token without leaving a partial file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_text(token, encoding="utf-8")
    os.replace(temporary, path)
