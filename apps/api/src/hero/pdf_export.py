"""Draw a plan as a single-page PDF."""

import io
import math

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from hero.rooms import detect_rooms, room_name
from hero.schema import Plan


def render_pdf(plan: Plan, title: str = "Floor plan") -> bytes:
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4, pageCompression=0)
    page_width, page_height = A4
    pdf.setTitle(title)
    pdf.setFont("Helvetica", 16)
    pdf.drawString(36, page_height - 40, title)

    if plan.vertices:
        xs = [vertex.x for vertex in plan.vertices]
        ys = [vertex.y for vertex in plan.vertices]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
    else:
        min_x = min_y = 0.0
        max_x = max_y = 1.0
    span_x = max(max_x - min_x, 0.5)
    span_y = max(max_y - min_y, 0.5)
    left, bottom, right, top = 48, 72, page_width - 48, page_height - 72
    scale = min((right - left) / span_x, (top - bottom) / span_y)

    def sx(x: float) -> float:
        return left + (x - min_x) * scale

    def sy(y: float) -> float:
        return bottom + (y - min_y) * scale

    by_id = {vertex.id: vertex for vertex in plan.vertices}
    pdf.setStrokeColorRGB(0.12, 0.16, 0.2)
    pdf.setLineWidth(1.6)
    for wall in plan.walls:
        start, end = by_id[wall.a], by_id[wall.b]
        pdf.line(sx(start.x), sy(start.y), sx(end.x), sy(end.y))

    pdf.setFillColorRGB(0.12, 0.16, 0.2)
    pdf.setFont("Helvetica", 9)
    for opening in plan.openings:
        wall = next((item for item in plan.walls if item.id == opening.wall), None)
        if wall is None:
            continue
        start, end = by_id[wall.a], by_id[wall.b]
        _draw_opening(pdf, sx, sy, start.x, start.y, end.x, end.y, opening.offset, opening.width, opening.kind, scale)

    for dimension in plan.dimensions:
        start, end = by_id[dimension.a], by_id[dimension.b]
        _draw_dimension(pdf, sx, sy, start.x, start.y, end.x, end.y, dimension.offset, scale)

    pdf.setFillColorRGB(0.12, 0.16, 0.2)
    pdf.setFont("Helvetica", 10)
    for note in plan.annotations:
        pdf.drawString(sx(note.x), sy(note.y), note.text)

    for room in detect_rooms(plan):
        name = room_name(plan, room["vertices"])
        label = f"{name} {room['area']:.1f} m2".strip()
        cx, cy = room["centroid"]
        pdf.drawString(sx(cx), sy(cy), label)

    bar = min(scale, 140)
    pdf.setLineWidth(2)
    pdf.line(48, 40, 48 + bar, 40)
    pdf.setFont("Helvetica", 8)
    pdf.drawString(48, 28, "1 m")
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def _draw_opening(pdf, sx, sy, x1, y1, x2, y2, offset: float, width: float, kind: str, scale: float) -> None:
    length = math.hypot(x2 - x1, y2 - y1)
    if length < 1e-6:
        return
    direction = ((x2 - x1) / length, (y2 - y1) / length)
    normal = (-direction[1], direction[0])
    center = (x1 + (x2 - x1) * offset, y1 + (y2 - y1) * offset)
    half = min(width / 2.0, length / 2.0)
    hinge = (center[0] - direction[0] * half, center[1] - direction[1] * half)
    leaf = (center[0] + direction[0] * half, center[1] + direction[1] * half)
    pdf.setStrokeColorRGB(0.05, 0.43, 0.42)
    pdf.setLineWidth(1.2)
    if kind == "window":
        out = 0.08
        for sign in (-1, 1):
            ax = hinge[0] + normal[0] * out * sign
            ay = hinge[1] + normal[1] * out * sign
            bx = leaf[0] + normal[0] * out * sign
            by = leaf[1] + normal[1] * out * sign
            pdf.line(sx(ax), sy(ay), sx(bx), sy(by))
        return
    pdf.line(sx(hinge[0]), sy(hinge[1]), sx(hinge[0] + normal[0] * width), sy(hinge[1] + normal[1] * width))
    radius = max(width * scale, 4)
    hinge_x, hinge_y = sx(hinge[0]), sy(hinge[1])
    pdf.arc(hinge_x - radius, hinge_y - radius, hinge_x + radius, hinge_y + radius, 0, 90)


def _draw_dimension(pdf, sx, sy, x1, y1, x2, y2, offset: float, scale: float) -> None:
    length = math.hypot(x2 - x1, y2 - y1)
    if length < 1e-6:
        return
    direction = ((x2 - x1) / length, (y2 - y1) / length)
    normal = (-direction[1], direction[0])
    shift = offset if abs(offset) > 1e-6 else 0.35
    a = (x1 + normal[0] * shift, y1 + normal[1] * shift)
    b = (x2 + normal[0] * shift, y2 + normal[1] * shift)
    pdf.setStrokeColorRGB(0.45, 0.32, 0.2)
    pdf.setLineWidth(0.8)
    pdf.line(sx(a[0]), sy(a[1]), sx(b[0]), sy(b[1]))
    pdf.line(sx(x1), sy(y1), sx(a[0]), sy(a[1]))
    pdf.line(sx(x2), sy(y2), sx(b[0]), sy(b[1]))
    pdf.setFillColorRGB(0.45, 0.32, 0.2)
    pdf.setFont("Helvetica", 8)
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    pdf.drawString(sx(mid[0]), sy(mid[1]), f"{length:.2f} m")
    del scale
