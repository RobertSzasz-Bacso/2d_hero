"""Write a file by replacing it in the same directory."""

import os
import time
from pathlib import Path


def atomic_write_text(path: Path, text: str) -> None:
    """Write text to a temp file, then ``os.replace`` it onto ``path``."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_text(text, encoding="utf-8", newline="\n")
    _replace(temporary, path)


def atomic_write_bytes(path: Path, payload: bytes) -> None:
    """Write bytes to a temp file, then ``os.replace`` it onto ``path``."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_bytes(payload)
    _replace(temporary, path)


def _replace(temporary: Path, path: Path) -> None:
    """Windows can deny the replace while a scanner still has the destination open."""
    try:
        for attempt in range(20):
            try:
                os.replace(temporary, path)
                return
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.05)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
