"""Cheap units and up-axis guess shown before an import job starts."""

from pathlib import Path

import numpy as np

from hero.errors import UnreadableFile
from hero.ingest.read import read_source


def guess_source(path: Path) -> dict[str, str]:
    """Return guessed ``units`` (``m``, ``cm``, or ``mm``) and ``upAxis``."""
    try:
        scene = read_source(path)
    except Exception as exc:
        raise UnreadableFile() from exc
    minimum = np.array([np.inf, np.inf, np.inf])
    maximum = np.array([-np.inf, -np.inf, -np.inf])
    seen = False
    for chunk in scene.iter_points():
        if len(chunk) == 0:
            continue
        seen = True
        minimum = np.minimum(minimum, chunk.min(axis=0))
        maximum = np.maximum(maximum, chunk.max(axis=0))
    if not seen:
        raise UnreadableFile()
    span = float(np.max(maximum[:2] - minimum[:2]))
    if scene.unit_scale is not None and scene.unit_scale != 1.0:
        units = _units_from_scale(scene.unit_scale)
    elif span > 200:
        units = "mm"
    elif span > 50:
        units = "cm"
    else:
        units = "m"
    size = maximum - minimum
    axis = "xyz"[int(np.argmin(size))]
    return {"units": units, "upAxis": axis}


def _units_from_scale(scale: float) -> str:
    if abs(scale - 0.001) < 1e-9:
        return "mm"
    if abs(scale - 0.01) < 1e-9:
        return "cm"
    return "m"
