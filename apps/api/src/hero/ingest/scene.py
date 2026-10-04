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
    mesh_vertices: np.ndarray | None = None
    mesh_faces: np.ndarray | None = None

    def has_geometry(self) -> bool:
        """True when the file yielded a mesh, points, or a point-cloud stream."""
        if self.chunks is not None:
            return True
        if self.mesh_faces is not None and len(self.mesh_faces) > 0:
            return True
        return self.points is not None and len(self.points) > 0

    def iter_points(self) -> Iterator[np.ndarray]:
        if self.chunks is not None:
            yield from self.chunks()
            return
        if self.points is not None and len(self.points):
            yield self.points
