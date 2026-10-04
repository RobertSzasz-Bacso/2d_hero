"""Attribute access over plan JSON, matching the TypeScript objects."""

from __future__ import annotations

from typing import Any


class Obj(dict[str, Any]):
    """Dict whose keys are also attributes. Lists stay lists."""

    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError as exc:
            raise AttributeError(name) from exc

    def __setattr__(self, name: str, value: Any) -> None:
        self[name] = value

    def __delattr__(self, name: str) -> None:
        try:
            del self[name]
        except KeyError as exc:
            raise AttributeError(name) from exc


def wrap(value: Any) -> Any:
    if isinstance(value, dict) and not isinstance(value, Obj):
        return Obj({key: wrap(item) for key, item in value.items()})
    if isinstance(value, list):
        return [wrap(item) for item in value]
    return value


def point(x: float, y: float) -> Obj:
    return Obj({"x": x, "y": y})
