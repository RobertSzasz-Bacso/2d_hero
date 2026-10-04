"""Write a file by replacing it in the same directory."""

import os
import time
from pathlib import Path


def atomic_write_text(path: Path, text: str) -> None:
    """Write text to a temp file, then ``os.replace`` it onto ``path``.

    Windows can return access denied while a scanner still has the destination
    open. Retry the replace. Do not delete the destination first.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_text(text, encoding="utf-8", newline="\n")
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
