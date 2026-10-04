"""Sentences a person can act on. HTTP bodies never include a traceback."""

UNREADABLE = (
    "This file could not be read. Export an OBJ, GLB, USDZ, PLY, E57, LAS, LAZ, "
    "or IFC file and try again."
)
CANCELLED = "Import was cancelled. The plan was not changed."
IMPORT_FAILED = "The import failed. The plan was not changed."


class UnreadableFile(Exception):
    """The path is not a scan or an IFC model this app can open."""

    def __init__(self) -> None:
        super().__init__(UNREADABLE)
