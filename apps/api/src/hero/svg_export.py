"""SVG export with one group per drawing layer."""

from __future__ import annotations

import math
from xml.sax.saxutils import escape

from hero.rooms import detect_rooms, room_name
from hero.schema import Plan


def render_svg(plan: Plan) -> bytes:
    if plan.vertices:
        xs = [vertex.x for vertex in plan.vertices]
        ys = [vertex.y for vertex in plan.vertices]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
    else:
        min_x = min_y = 0.0
        max_x = max_y = 1.0
    pad = 0.6
    width = max(max_x - min_x, 0.5) + pad * 2
    height = max(max_y - min_y, 0.5) + pad * 2

    def px(x: float) -> float:
        return x - min_x + pad

    def py(y: float) -> float:
        return max_y + pad - y

    walls: list[str] = []
    doors: list[str] = []
    windows: list[str] = []
    notes: list[str] = []
    by_id = {vertex.id: vertex for vertex in plan.vertices}
    for wall in plan.walls:
        start, end = by_id[wall.a], by_id[wall.b]
        walls.append(
            f'<line x1="{px(start.x):.4f}" y1="{py(start.y):.4f}" x2="{px(end.x):.4f}" y2="{py(end.y):.4f}" />'
        )
    for opening in plan.openings:
        wall = next((item for item in plan.walls if item.id == opening.wall), None)
        if wall is None:
            continue
        start, end = by_id[wall.a], by_id[wall.b]
        mark = _opening(px, py, start.x, start.y, end.x, end.y, opening.offset, opening.width, opening.kind)
        if opening.kind == "door":
            doors.append(mark)
        else:
            windows.append(mark)
    for dimension in plan.dimensions:
        start, end = by_id[dimension.a], by_id[dimension.b]
        length = math.hypot(end.x - start.x, end.y - start.y)
        notes.append(_text(px, py, (start.x + end.x) / 2, (start.y + end.y) / 2, f"{length:.2f} m"))
    for note in plan.annotations:
        notes.append(_text(px, py, note.x, note.y, note.text))
    for room in detect_rooms(plan):
        name = room_name(plan, room["vertices"])
        label = f"{name} {room['area']:.1f} m2".strip()
        cx, cy = room["centroid"]
        notes.append(_text(px, py, cx, cy, label))
    document = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.4f} {height:.4f}">
  <g id="walls" class="walls">{"".join(walls)}</g>
  <g id="doors" class="doors">{"".join(doors)}</g>
  <g id="windows" class="windows">{"".join(windows)}</g>
  <g id="annotations" class="annotations">{"".join(notes)}</g>
</svg>
'''
    return document.encode()


def _text(px, py, x: float, y: float, value: str) -> str:
    return f'<text x="{px(x):.4f}" y="{py(y):.4f}">{escape(value)}</text>'


def _opening(px, py, x1, y1, x2, y2, offset: float, width: float, kind: str) -> str:
    length = math.hypot(x2 - x1, y2 - y1)
    if length < 1e-6:
        return ""
    direction = ((x2 - x1) / length, (y2 - y1) / length)
    center = (x1 + (x2 - x1) * offset, y1 + (y2 - y1) * offset)
    half = min(width / 2, length / 2)
    hinge = (center[0] - direction[0] * half, center[1] - direction[1] * half)
    leaf = (center[0] + direction[0] * half, center[1] + direction[1] * half)
    line = f'<line x1="{px(hinge[0]):.4f}" y1="{py(hinge[1]):.4f}" x2="{px(leaf[0]):.4f}" y2="{py(leaf[1]):.4f}" />'
    if kind != "door":
        return line
    return (
        line
        + f'<path d="M {px(hinge[0]):.4f} {py(hinge[1]):.4f} a {width:.4f} {width:.4f} 0 0 1 {px(leaf[0]) - px(hinge[0]):.4f} {py(leaf[1]) - py(hinge[1]):.4f}" />'
    )
