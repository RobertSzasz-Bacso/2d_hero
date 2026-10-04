"""Detection metrics from docs/algorithms.md. They stay outside the detector."""

from dataclasses import dataclass

import numpy as np
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union


@dataclass(frozen=True)
class WallSeg:
    x1: float
    y1: float
    x2: float
    y2: float
    thickness: float


@dataclass(frozen=True)
class OpeningMark:
    kind: str
    x: float
    y: float
    width: float


def wall_iou(predicted: list[WallSeg], truth: list[WallSeg]) -> float:
    """Intersection over union of centerlines buffered by half the thickness."""
    return _iou(_wall_union(predicted), _wall_union(truth))


def room_iou(predicted: list[Polygon], truth: list[Polygon]) -> float:
    """Mean IoU over truth rooms after a one-to-one greedy match."""
    if not truth:
        return 1.0
    used: set[int] = set()
    scores: list[float] = []
    for truth_room in truth:
        best = 0.0
        best_index: int | None = None
        for index, room in enumerate(predicted):
            if index in used:
                continue
            score = _iou(room, truth_room)
            if score > best:
                best = score
                best_index = index
        if best_index is not None:
            used.add(best_index)
        scores.append(best)
    return float(np.mean(scores))


def opening_scores(
    predicted: list[OpeningMark],
    truth: list[OpeningMark],
) -> tuple[float, float]:
    """Precision and recall. A match shares kind, center, and width."""
    used: set[int] = set()
    matches = 0
    for item in truth:
        for index, other in enumerate(predicted):
            if index in used or other.kind != item.kind:
                continue
            distance = float(np.hypot(other.x - item.x, other.y - item.y))
            if distance <= 0.25 and abs(other.width - item.width) <= 0.15:
                used.add(index)
                matches += 1
                break
    precision = 1.0 if not predicted else matches / len(predicted)
    recall = 1.0 if not truth else matches / len(truth)
    return precision, recall


def thickness_mae(predicted: list[WallSeg], truth: list[WallSeg]) -> float:
    """Mean absolute thickness error of walls whose centerlines overlap."""
    errors: list[float] = []
    for wall in predicted:
        for other in truth:
            if _centerlines_overlap(wall, other):
                errors.append(abs(wall.thickness - other.thickness))
                break
    if not errors:
        return 0.0
    return float(np.mean(errors))


def frame_angle_error(predicted_deg: float, truth_deg: float) -> float:
    """Smallest difference of Manhattan angles modulo 90 degrees."""
    delta = abs(predicted_deg - truth_deg) % 90.0
    return float(min(delta, 90.0 - delta))


def stair_iou(predicted: Polygon, truth: Polygon) -> float:
    return _iou(predicted, truth)


def _wall_union(walls: list[WallSeg]):
    if not walls:
        return Polygon()
    parts = []
    for wall in walls:
        line = LineString([(wall.x1, wall.y1), (wall.x2, wall.y2)])
        parts.append(line.buffer(wall.thickness / 2.0, cap_style="round"))
    return unary_union(parts)


def _iou(left, right) -> float:
    if left.is_empty and right.is_empty:
        return 1.0
    union = left.union(right).area
    if union == 0:
        return 1.0
    return float(left.intersection(right).area / union)


def _centerlines_overlap(left: WallSeg, right: WallSeg) -> bool:
    a = LineString([(left.x1, left.y1), (left.x2, left.y2)])
    b = LineString([(right.x1, right.y1), (right.x2, right.y2)])
    shared = a.intersection(b)
    return not shared.is_empty and shared.length >= 0.2
