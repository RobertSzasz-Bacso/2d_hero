"""Write a file by replacing it in the same directory."""

import os
from pathlib import Path


def atomic_write_text(path: Path, text: str) -> None:
    """Write text to a temp file, then ``os.replace`` it onto ``path``."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_text(text, encoding="utf-8", newline="\n")
    try:
        os.replace(temporary, path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
