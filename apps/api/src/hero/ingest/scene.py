"""A raw file before it is converted to metres."""

from collections.abc import Callable, Iterator
from dataclasses import dataclass

import numpy as np


@dataclass
class RawScene:
    """Points stay in file units. LAS chunks are produced on each call."""

    points: np.ndarray | None
    normals: np.ndarray | None
    chunks: Callable[[], Iterator[np.ndarray]] | None
    unit_scale: float | None
    source_format: str

    def iter_points(self) -> Iterator[np.ndarray]:
        if self.chunks is not None:
            yield from self.chunks()
            return
        if self.points is not None and len(self.points):
            yield self.points
