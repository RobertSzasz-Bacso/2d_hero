"""Layered DXF. Walls, doors, windows, and annotations stay on separate layers."""

from __future__ import annotations

import math

from hero.rooms import detect_rooms, room_name
from hero.schema import Plan

LAYERS = (
    ("WALLS", "7"),
    ("DOORS", "3"),
    ("WINDOWS", "4"),
    ("ANNOTATIONS", "1"),
)


def render_dxf(plan: Plan) -> bytes:
    lines = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "6", "0", "ENDSEC"]
    lines += ["0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", str(len(LAYERS))]
    for name, color in LAYERS:
        lines += ["0", "LAYER", "2", name, "70", "0", "62", color, "6", "CONTINUOUS"]
    lines += ["0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"]
    by_id = {vertex.id: vertex for vertex in plan.vertices}
    for wall in plan.walls:
        start, end = by_id[wall.a], by_id[wall.b]
        _line(lines, "WALLS", start.x, start.y, end.x, end.y)
    for opening in plan.openings:
        wall = next((item for item in plan.walls if item.id == opening.wall), None)
        if wall is None:
            continue
        start, end = by_id[wall.a], by_id[wall.b]
        _opening(lines, start.x, start.y, end.x, end.y, opening.offset, opening.width, opening.kind)
    for dimension in plan.dimensions:
        start, end = by_id[dimension.a], by_id[dimension.b]
        length = math.hypot(end.x - start.x, end.y - start.y)
        _text(lines, "ANNOTATIONS", (start.x + end.x) / 2, (start.y + end.y) / 2, f"{length:.2f} m")
    for note in plan.annotations:
        _text(lines, "ANNOTATIONS", note.x, note.y, note.text)
    for room in detect_rooms(plan):
        name = room_name(plan, room["vertices"])
        label = f"{name} {room['area']:.1f} m2".strip()
        cx, cy = room["centroid"]
        _text(lines, "ANNOTATIONS", cx, cy, label)
    lines += ["0", "ENDSEC", "0", "EOF"]
    return "\n".join(lines).encode()


def _line(lines: list[str], layer: str, x1: float, y1: float, x2: float, y2: float) -> None:
    lines += [
        "0",
        "LINE",
        "8",
        layer,
        "10",
        _num(x1),
        "20",
        _num(y1),
        "11",
        _num(x2),
        "21",
        _num(y2),
    ]


def _text(lines: list[str], layer: str, x: float, y: float, value: str) -> None:
    lines += ["0", "TEXT", "8", layer, "10", _num(x), "20", _num(y), "40", "0.15", "1", value]


def _opening(lines: list[str], x1: float, y1: float, x2: float, y2: float, offset: float, width: float, kind: str) -> None:
    length = math.hypot(x2 - x1, y2 - y1)
    if length < 1e-6:
        return
    direction = ((x2 - x1) / length, (y2 - y1) / length)
    normal = (-direction[1], direction[0])
    center = (x1 + (x2 - x1) * offset, y1 + (y2 - y1) * offset)
    half = min(width / 2, length / 2)
    hinge = (center[0] - direction[0] * half, center[1] - direction[1] * half)
    leaf = (center[0] + direction[0] * half, center[1] + direction[1] * half)
    layer = "DOORS" if kind == "door" else "WINDOWS"
    _line(lines, layer, hinge[0], hinge[1], leaf[0], leaf[1])
    if kind == "door":
        lines += [
            "0",
            "ARC",
            "8",
            "DOORS",
            "10",
            _num(hinge[0]),
            "20",
            _num(hinge[1]),
            "40",
            _num(width),
            "50",
            "0",
            "51",
            "90",
        ]


def _num(value: float) -> str:
    return f"{value:.6f}"
