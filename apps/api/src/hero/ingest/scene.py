"""A GLB before it is converted to metres."""

from dataclasses import dataclass

import numpy as np


@dataclass
class RawScene:
    """Mesh or point-cloud data stays in file units until normalization."""

    points: np.ndarray | None
    normals: np.ndarray | None
    unit_scale: float | None
    source_format: str
    mesh_vertices: np.ndarray | None = None
    mesh_faces: np.ndarray | None = None
    colors: np.ndarray | None = None

    def has_geometry(self) -> bool:
        """True when the GLB yielded a mesh or points."""
        if self.mesh_faces is not None and len(self.mesh_faces) > 0:
            return True
        return self.points is not None and len(self.points) > 0
