"""Review images for the local agent. They are not a saved plan."""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

from hero.atomic import atomic_write_bytes, atomic_write_text
from hero.planops.polygons import wall_polygons
from hero.schema import Plan


def write_review(project_dir: Path, plan: Plan) -> None:
    """Write review/plan.svg and review/underlay.png beside the project."""
    root = project_dir / "review"
    atomic_write_text(root / "plan.svg", _svg(plan))
    atomic_write_bytes(root / "underlay.png", _underlay_png(project_dir))


def _underlay_png(project_dir: Path) -> bytes:
    folder = project_dir / "underlay"
    if folder.is_dir():
        images = sorted(path for path in folder.glob("*.png") if path.is_file())
        if images:
            return images[0].read_bytes()
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (255, 255, 255)).save(buffer, format="PNG")
    return buffer.getvalue()


def _svg(plan: Plan) -> str:
    polygons: list[dict[str, object]] = []
    for level in plan.levels:
        polygons.extend(wall_polygons(plan, level.id))
    points: list[dict[str, float]] = []
    for polygon in polygons:
        ring = polygon.get("ring")
        if isinstance(ring, list):
            points.extend(point for point in ring if isinstance(point, dict))
    if not points:
        return _empty_svg()
    min_x = min(float(point["x"]) for point in points)
    min_y = min(float(point["y"]) for point in points)
    max_x = max(float(point["x"]) for point in points)
    max_y = max(float(point["y"]) for point in points)
    pad = 0.5
    width = max(max_x - min_x, 0.1) + pad * 2
    height = max(max_y - min_y, 0.1) + pad * 2

    def place(point: dict[str, float]) -> str:
        x = float(point["x"]) - min_x + pad
        y = height - (float(point["y"]) - min_y + pad)
        return f"{x:.4f},{y:.4f}"

    body: list[str] = []
    for polygon in polygons:
        ring = polygon.get("ring")
        wall_id = polygon.get("wallId")
        if not isinstance(ring, list) or not isinstance(wall_id, str):
            continue
        coords = " ".join(place(point) for point in ring if isinstance(point, dict))
        body.append(
            f'<polygon data-wall-id="{_xml(wall_id)}" points="{coords}" '
            'fill="#d6d3d1" stroke="#111827" stroke-width="0.02"/>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.4f} {height:.4f}">\n'
        + "\n".join(body)
        + "\n</svg>\n"
    )


def _empty_svg() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>\n'
    )


def _xml(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
