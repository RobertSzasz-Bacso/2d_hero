"""Plan geometry. Y is up. Float epsilon is noise, not a design tolerance."""

from __future__ import annotations

import math
from typing import Any

FLOAT_EPS = 1e-9


def _xy(value: Any) -> tuple[float, float]:
    if isinstance(value, dict):
        return float(value["x"]), float(value["y"])
    return float(value.x), float(value.y)


def pt(x: float, y: float) -> dict[str, float]:
    return {"x": x, "y": y}


def add(a: Any, b: Any) -> dict[str, float]:
    ax, ay = _xy(a)
    bx, by = _xy(b)
    return pt(ax + bx, ay + by)


def sub(a: Any, b: Any) -> dict[str, float]:
    ax, ay = _xy(a)
    bx, by = _xy(b)
    return pt(ax - bx, ay - by)


def mul(a: Any, scale: float) -> dict[str, float]:
    ax, ay = _xy(a)
    return pt(ax * scale, ay * scale)


def dot(a: Any, b: Any) -> float:
    ax, ay = _xy(a)
    bx, by = _xy(b)
    return ax * bx + ay * by


def cross(a: Any, b: Any) -> float:
    ax, ay = _xy(a)
    bx, by = _xy(b)
    return ax * by - ay * bx


def hypot(a: Any) -> float:
    ax, ay = _xy(a)
    return math.hypot(ax, ay)


def dist(a: Any, b: Any) -> float:
    ax, ay = _xy(a)
    bx, by = _xy(b)
    return math.hypot(ax - bx, ay - by)


def unit(a: Any) -> dict[str, float]:
    length = hypot(a)
    if length == 0:
        return pt(0.0, 0.0)
    ax, ay = _xy(a)
    return pt(ax / length, ay / length)


def left(direction: Any) -> dict[str, float]:
    dx, dy = _xy(direction)
    return pt(-dy, dx)


def right(direction: Any) -> dict[str, float]:
    dx, dy = _xy(direction)
    return pt(dy, -dx)


def same_point(a: Any, b: Any, eps: float = FLOAT_EPS) -> bool:
    ax, ay = _xy(a)
    bx, by = _xy(b)
    return abs(ax - bx) <= eps and abs(ay - by) <= eps


def line_intersect(origin: Any, direction: Any, other_origin: Any,
    other_direction: Any) -> dict[str, float] | None:
    denom = cross(direction, other_direction)
    if abs(denom) < FLOAT_EPS:
        return None
    delta = sub(other_origin, origin)
    t = cross(delta, other_direction) / denom
    return add(origin, mul(direction, t))


def foot_on_line(point: Any, origin: Any, end: Any) -> dict[str, Any] | None:
    delta = sub(end, origin)
    length2 = dot(delta, delta)
    if length2 == 0:
        return None
    t = dot(sub(point, origin), delta) / length2
    return {"point": add(origin, mul(delta, t)), "t": t}


def segment_intersect(a: Any, b: Any, c: Any, d: Any) -> dict[str, Any] | None:
    ab = sub(b, a)
    cd = sub(d, c)
    denom = cross(ab, cd)
    if abs(denom) < FLOAT_EPS:
        return None
    ac = sub(c, a)
    t = cross(ac, cd) / denom
    u = cross(ac, ab) / denom
    if t < -FLOAT_EPS or t > 1 + FLOAT_EPS or u < -FLOAT_EPS or u > 1 + FLOAT_EPS:
        return None
    return {"point": add(a, mul(ab, t)), "t": t, "u": u}


def ring_area(ring: list[Any]) -> float:
    total = 0.0
    count = len(ring)
    for index in range(count):
        a = ring[index]
        b = ring[(index + 1) % count]
        if a is None or b is None:
            continue
        ax, ay = _xy(a)
        bx, by = _xy(b)
        total += ax * by - bx * ay
    return total / 2


def point_in_ring(point: Any, ring: list[Any]) -> bool:
    inside = False
    px, py = _xy(point)
    count = len(ring)
    previous = count - 1
    for index in range(count):
        a = ring[index]
        b = ring[previous]
        previous = index
        if a is None or b is None:
            continue
        ax, ay = _xy(a)
        bx, by = _xy(b)
        if ay == by:
            continue
        crosses = (ay > py) != (by > py)
        x = ((bx - ax) * (py - ay)) / (by - ay) + ax
        if crosses and px < x:
            inside = not inside
    return inside


def distance_to_segment(point: Any, a: Any, b: Any) -> float:
    foot = foot_on_line(point, a, b)
    if foot is None:
        return dist(point, a)
    t = min(1.0, max(0.0, float(foot["t"])))
    projected = add(a, mul(sub(b, a), t))
    return dist(point, projected)


def closest_on_ring(point: Any, ring: list[Any]) -> dict[str, float]:
    best = ring[0] if ring else point
    best_dist = dist(point, best)
    count = len(ring)
    for index in range(count):
        a = ring[index]
        b = ring[(index + 1) % count]
        if a is None or b is None:
            continue
        foot = foot_on_line(point, a, b)
        t = min(1.0, max(0.0, float(foot["t"]))) if foot else 0.0
        projected = add(a, mul(sub(b, a), t))
        gap = dist(point, projected)
        if gap < best_dist:
            best = projected
            best_dist = gap
    bx, by = _xy(best)
    return pt(bx, by)


def ring_centroid(ring: list[Any]) -> dict[str, float]:
    if not ring:
        return pt(0.0, 0.0)
    xs = 0.0
    ys = 0.0
    for item in ring:
        x, y = _xy(item)
        xs += x
        ys += y
    return pt(xs / len(ring), ys / len(ring))


def dedupe_ring(ring: list[Any]) -> list[dict[str, float]]:
    out: list[dict[str, float]] = []
    for item in ring:
        current = pt(*_xy(item))
        if not out or not same_point(out[-1], current):
            out.append(current)
    if len(out) > 1 and same_point(out[0], out[-1]):
        out.pop()
    return out


def rotate(direction: Any, degrees: float) -> dict[str, float]:
    radians = degrees * math.pi / 180
    cosine = math.cos(radians)
    sine = math.sin(radians)
    dx, dy = _xy(direction)
    return pt(dx * cosine - dy * sine, dx * sine + dy * cosine)


def joint_angle_deg(vertex: Any, left_point: Any, right_point: Any) -> float:
    a = unit(sub(left_point, vertex))
    b = unit(sub(right_point, vertex))
    cosine = min(1.0, max(-1.0, dot(a, b)))
    return math.acos(cosine) * 180 / math.pi


def js_round(value: float) -> float:
    """Match JavaScript Math.round (half toward +infinity)."""
    return math.floor(value + 0.5)
