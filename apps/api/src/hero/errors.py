"""Sentences a person can act on. HTTP bodies never include a traceback."""

UNSUPPORTED_SOURCE = "Only GLB files are supported."
UNREADABLE = "This file could not be read. Export a GLB file and try again."
CANCELLED = "Import was cancelled. The plan was not changed."
IMPORT_FAILED = "The import failed. The plan was not changed."


class UnreadableFile(Exception):
    """The path is not a GLB this app can open."""

    def __init__(self) -> None:
        super().__init__(UNREADABLE)


class UnsupportedSource(Exception):
    """The project source is not a GLB."""

    def __init__(self, name: str) -> None:
        super().__init__(UNSUPPORTED_SOURCE)
        self.name = name
