"""Plan edits the assistant is allowed to propose."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from hero.planops.ops import move_wall, set_opening, set_room_name, set_wall_thickness
from hero.schema import Plan

_OPENING_FIELDS = ("kind", "offset", "width", "sill", "head", "swing", "swingSide", "confidence")


class OpModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SetWallThicknessOp(OpModel):
    op: Literal["set_wall_thickness"]
    levelId: str
    wallId: str
    thickness: float


class MoveWallOp(OpModel):
    op: Literal["move_wall"]
    levelId: str
    wallId: str
    dx: float
    dy: float


class SetOpeningOp(OpModel):
    op: Literal["set_opening"]
    levelId: str
    openingId: str
    kind: Literal["door", "window", "passage"] | None = None
    offset: float | None = None
    width: float | None = None
    sill: float | None = None
    head: float | None = None
    swing: Literal["left", "right", "double", "sliding", "none"] | None = None
    swingSide: Literal["positive", "negative"] | None = None
    confidence: float | None = None


class SetRoomNameOp(OpModel):
    op: Literal["set_room_name"]
    levelId: str
    roomId: str
    name: str
    number: str | None = None


PlanOp = Annotated[
    SetWallThicknessOp | MoveWallOp | SetOpeningOp | SetRoomNameOp,
    Field(discriminator="op"),
]
_OPS = TypeAdapter(PlanOp)


def parse_op(payload: dict[str, Any]) -> PlanOp:
    """Validate one op. Raises ValidationError when the payload is not an op."""
    return _OPS.validate_python(payload)


def dump_op(op: PlanOp) -> dict[str, Any]:
    """JSON-ready op without empty optional fields."""
    return op.model_dump(mode="json", exclude_none=True)


def apply_op(plan: Plan, op: PlanOp) -> Plan:
    """Return a new plan with one op applied. Raises ValueError when it is illegal."""
    if isinstance(op, SetWallThicknessOp):
        updated = set_wall_thickness(plan, op.levelId, op.wallId, op.thickness)
    elif isinstance(op, MoveWallOp):
        updated = move_wall(plan, op.levelId, op.wallId, {"x": op.dx, "y": op.dy})
    elif isinstance(op, SetRoomNameOp):
        updated = set_room_name(plan, op.levelId, op.roomId, op.name, op.number)
    else:
        patch = {key: getattr(op, key) for key in _OPENING_FIELDS if getattr(op, key) is not None}
        updated = set_opening(plan, op.levelId, op.openingId, patch)
    return Plan.model_validate(updated.model_dump())


def error_text(exc: Exception) -> str:
    """A short tool error that does not include request bodies."""
    if isinstance(exc, ValidationError):
        first = exc.errors()[0]
        location = ".".join(str(part) for part in first.get("loc", ()))
        message = str(first.get("msg", "Invalid value"))
        return f"{location}: {message}" if location else message
    if isinstance(exc, ValueError):
        return str(exc)
    return "The change is not valid."
