"""Edits that the shared vectors apply to a plan."""

from __future__ import annotations

import copy
import math
from typing import Any

from hero.planops.geom import add, dist, dot, joint_angle_deg, line_intersect, mul, sub, unit
from hero.planops.tolerances import ortho_deg


def _clone(plan: Any) -> Any:
    return copy.deepcopy(plan)


def _level(plan: Any, level_id: str) -> Any:
    for level in plan.levels:
        if level.id == level_id:
            return level
    raise ValueError(f"Unknown level {level_id}")


def _vertex(level: Any, vertex_id: str) -> Any:
    for vertex in level.vertices:
        if vertex.id == vertex_id:
            return vertex
    raise ValueError(f"Unknown vertex {vertex_id}")


def _wall_length(level: Any, wall_id: str) -> float:
    wall = next((item for item in level.walls if item.id == wall_id), None)
    if wall is None:
        raise ValueError(f"Unknown wall {wall_id}")
    return dist(_vertex(level, wall.a), _vertex(level, wall.b))


def _collinear_run(level: Any, wall_id: str) -> set[str]:
    run = {wall_id}
    queue = [wall_id]
    while queue:
        current_id = queue.pop()
        wall = next((item for item in level.walls if item.id == current_id), None)
        if wall is None:
            continue
        for end in (wall.a, wall.b):
            for other in level.walls:
                if other.id in run or (other.a != end and other.b != end):
                    continue
                here = _vertex(level, end)
                wall_far = _vertex(level, wall.b if wall.a == end else wall.a)
                other_far = _vertex(level, other.b if other.a == end else other.a)
                angle = joint_angle_deg(here, wall_far, other_far)
                if abs(angle - 180) <= ortho_deg:
                    run.add(other.id)
                    queue.append(other.id)
    return run


def move_wall(plan: Any, level_id: str, wall_id: str, delta: Any) -> Any:
    nxt = _clone(plan)
    level = _level(nxt, level_id)
    origin = _level(plan, level_id)
    wall = next((item for item in level.walls if item.id == wall_id), None)
    if wall is None:
        raise ValueError(f"Unknown wall {wall_id}")
    start = _vertex(origin, wall.a)
    end = _vertex(origin, wall.b)
    direction = unit(sub(end, start))
    if direction["x"] == 0 and direction["y"] == 0:
        return nxt
    normal = {"x": -direction["y"], "y": direction["x"]}
    applied = mul(normal, dot(delta, normal))
    run = _collinear_run(origin, wall_id)
    ids: set[str] = set()
    for wall_run_id in run:
        item = next((candidate for candidate in origin.walls if candidate.id == wall_run_id), None)
        if item is None:
            continue
        ids.add(item.a)
        ids.add(item.b)
    for vertex_id in ids:
        original = _vertex(origin, vertex_id)
        updated = _vertex(level, vertex_id)
        neighbors = [
            item for item in origin.walls if item.id not in run and (item.a == vertex_id or 
                item.b == vertex_id)
        ]
        orthogonal = None
        for item in neighbors:
            far_id = item.b if item.a == vertex_id else item.a
            far = _vertex(origin, far_id)
            run_wall = next(
                (
                    candidate
                    for candidate in origin.walls
                    if candidate.id in run and (candidate.a == vertex_id or candidate.b == 
                        vertex_id)
                ),
                None,
            )
            if run_wall is None:
                continue
            other_id = run_wall.b if run_wall.a == vertex_id else run_wall.a
            angle = joint_angle_deg(original, _vertex(origin, other_id), far)
            if abs(angle - 90) <= ortho_deg:
                orthogonal = item
                break
        if orthogonal is None:
            updated.x = original.x + applied["x"]
            updated.y = original.y + applied["y"]
            continue
        far = _vertex(origin, orthogonal.b if orthogonal.a == vertex_id else orthogonal.a)
        run_wall = next(
            (
                candidate
                for candidate in origin.walls
                if candidate.id in run and (candidate.a == vertex_id or candidate.b == vertex_id)
            ),
            None,
        )
        other_id = vertex_id
        if run_wall is not None:
            other_id = run_wall.b if run_wall.a == vertex_id else run_wall.a
        other = _vertex(origin, other_id)
        run_dir = unit(sub(other, original))
        neighbor_dir = sub(original, far)
        hit = line_intersect(add(original, applied), run_dir, far, neighbor_dir)
        updated.x = hit["x"] if hit is not None else original.x + applied["x"]
        updated.y = hit["y"] if hit is not None else original.y + applied["y"]
    return nxt


def move_vertex(plan: Any, level_id: str, vertex_id: str, point: Any) -> Any:
    if not math.isfinite(float(point.x)) or not math.isfinite(float(point.y)):
        raise ValueError("Vertex coordinates must be finite")
    nxt = _clone(plan)
    vertex = _vertex(_level(nxt, level_id), vertex_id)
    vertex.x = point.x
    vertex.y = point.y
    return nxt


def set_wall_thickness(plan: Any, level_id: str, wall_id: str, thickness: float) -> Any:
    if not (thickness > 0) or thickness > 1.5:
        raise ValueError("Wall thickness must be greater than 0 and at most 1.5 m")
    nxt = _clone(plan)
    wall = next((item for item in _level(nxt, level_id).walls if item.id == wall_id), None)
    if wall is None:
        raise ValueError(f"Unknown wall {wall_id}")
    wall.thickness = thickness
    return nxt


def set_room_name(plan: Any, level_id: str, room_id: str, name: str,
    number: str | None = None) -> Any:
    nxt = _clone(plan)
    room = next((item for item in _level(nxt, level_id).rooms if item.id == room_id), None)
    if room is None:
        raise ValueError(f"Unknown room {room_id}")
    room.name = name
    if number is not None:
        room.number = number
    return nxt


def set_opening(plan: Any, level_id: str, opening_id: str, patch: dict[str, Any]) -> Any:
    nxt = _clone(plan)
    level = _level(nxt, level_id)
    opening = next((item for item in level.openings if item.id == opening_id), None)
    if opening is None:
        raise ValueError(f"Unknown opening {opening_id}")
    for key, value in patch.items():
        if value is not None:
            setattr(opening, key, value)
    length = _wall_length(level, opening.wall)
    if not (opening.width > 0) or opening.width >= length:
        raise ValueError("Opening width must be shorter than its wall")
    if opening.head <= opening.sill:
        raise ValueError("Opening head must be above the sill")
    return nxt


def _reference_point(level: Any, ref: Any) -> dict[str, float]:
    if ref.type == "vertex":
        vertex = _vertex(level, ref.id)
        return {"x": vertex.x, "y": vertex.y}
    opening = next((item for item in level.openings if item.id == ref.id), None)
    if opening is None:
        raise ValueError(f"Unknown opening {ref.id}")
    wall = next((item for item in level.walls if item.id == opening.wall), None)
    if wall is None:
        raise ValueError(f"Unknown wall {opening.wall}")
    a = _vertex(level, wall.a)
    b = _vertex(level, wall.b)
    span = sub(b, a)
    length = math.hypot(span["x"], span["y"])
    if length == 0:
        return {"x": a.x, "y": a.y}
    along = mul(span, 1 / length)
    center = add(a, mul(span, opening.offset))
    half = opening.width / 2
    return add(center, mul(along, -half if ref.edge == "start" else half))


def apply_typed_dimension(plan: Any, level_id: str, segment: dict[str, Any]) -> Any:
    length_m = float(segment["lengthM"])
    if not (length_m > 0) or not math.isfinite(length_m):
        raise ValueError("Typed length must be a positive finite length")
    source = _level(plan, level_id)
    anchor = _reference_point(source, segment["a"])
    moving = _reference_point(source, segment["b"])
    axis = unit(sub(moving, anchor))
    if axis["x"] == 0 and axis["y"] == 0:
        return _clone(plan)
    target = add(anchor, mul(axis, length_m))
    delta = sub(target, moving)
    limit = dot(moving, axis)
    nxt = _clone(plan)
    level = _level(nxt, level_id)
    before = {vertex.id: {"x": vertex.x, "y": vertex.y} for vertex in source.vertices}
    ref_b = segment["b"]
    for vertex in level.vertices:
        on_b = ref_b.type == "vertex" and ref_b.id == vertex.id
        if on_b or dot(vertex, axis) >= limit:
            vertex.x += delta["x"]
            vertex.y += delta["y"]
    for opening in level.openings:
        wall = next((item for item in level.walls if item.id == opening.wall), None)
        if wall is None:
            continue
        old_a = before.get(wall.a)
        old_b = before.get(wall.b)
        if old_a is None or old_b is None:
            continue
        new_a = _vertex(level, wall.a)
        new_b = _vertex(level, wall.b)
        old_span = sub(old_b, old_a)
        center = add(old_a, mul(old_span, opening.offset))
        moved = add(center, delta) if dot(center, axis) >= limit else center
        new_span = sub(new_b, new_a)
        length = math.hypot(new_span["x"], new_span["y"])
        if length == 0:
            continue
        offset = dot(sub(moved, new_a), unit(new_span)) / length
        opening.offset = min(1.0, max(0.0, offset))
    if ref_b.type == "opening":
        opening = next((item for item in level.openings if item.id == ref_b.id), None)
        wall = next((item for item in level.walls if opening is not None and item.id == 
            opening.wall), None)
        if opening is not None and wall is not None:
            a = _vertex(level, wall.a)
            b = _vertex(level, wall.b)
            span = sub(b, a)
            length = math.hypot(span["x"], span["y"])
            if length > 0:
                along = unit(span)
                half = opening.width / 2
                center = add(target, mul(along, half if ref_b.edge == "start" else -half))
                opening.offset = min(1.0, max(0.0, dot(sub(center, a), along) / length))
    return nxt


def set_fixture_rotation(plan: Any, level_id: str, fixture_id: str, rotation_deg: float) -> Any:
    if not math.isfinite(rotation_deg):
        raise ValueError("Rotation must be finite")
    nxt = _clone(plan)
    fixture = next((item for item in _level(nxt, level_id).fixtures if item.id == fixture_id), None)
    if fixture is None:
        raise ValueError(f"Unknown fixture {fixture_id}")
    fixture.rotationDeg = rotation_deg
    return nxt


def set_text_content(plan: Any, level_id: str, text_id: str, text: str) -> Any:
    nxt = _clone(plan)
    item = next((entry for entry in _level(nxt, level_id).texts if entry.id == text_id), None)
    if item is None:
        raise ValueError(f"Unknown text {text_id}")
    item.text = text
    return nxt


def _reference_exists(level: Any, ref: Any) -> bool:
    if ref.type == "vertex":
        return any(vertex.id == ref.id for vertex in level.vertices)
    return any(opening.id == ref.id for opening in level.openings)


def remove_selection(plan: Any, level_id: str, ids: list[str]) -> Any:
    drop = set(ids)
    nxt = _clone(plan)
    level = _level(nxt, level_id)
    removed = {wall.id for wall in level.walls if wall.id in drop or wall.a in drop or wall.b 
        in drop}
    level.walls = [wall for wall in level.walls if wall.id not in removed]
    level.openings = [opening for opening in level.openings if opening.id not in drop and 
        opening.wall not in removed]
    level.columns = [column for column in level.columns if column.id not in drop]
    level.stairs = [stair for stair in level.stairs if stair.id not in drop]
    level.fixtures = [fixture for fixture in level.fixtures if fixture.id not in drop]
    level.texts = [text for text in level.texts if text.id not in drop]
    level.rooms = [room for room in level.rooms if room.id not in drop]
    level.separators = [
        separator
        for separator in level.separators
        if separator.id not in drop and separator.a not in drop and separator.b not in drop
    ]
    used: set[str] = set()
    for wall in level.walls:
        used.add(wall.a)
        used.add(wall.b)
    for separator in level.separators:
        used.add(separator.a)
        used.add(separator.b)
    level.vertices = [vertex for vertex in level.vertices if vertex.id not in drop and 
        vertex.id in used]
    level.dimensions = [
        dimension
        for dimension in level.dimensions
        if all(_reference_exists(level, segment.a) and _reference_exists(level,
            segment.b) for segment in dimension.segments)
    ]
    return nxt
