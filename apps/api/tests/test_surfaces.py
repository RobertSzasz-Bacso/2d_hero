"""Wall faces: thickness, one-sided walls, snap, and clutter."""

from pathlib import Path

import numpy as np
import pytest

from hero.ingest.read import read_source
from hero.pipeline.normalize import Normalized, normalize_scene
from hero.pipeline.surfaces import detect_surfaces
from hero.pipeline.tolerances import assumed_exterior_m, assumed_interior_m
from hero.testkit.building import build_building
from hero.testkit.metrics import WallSeg, thickness_mae, wall_iou
from hero.testkit.writers import glb_bytes


def test_clean_floor_matches_truth_thickness_and_angle(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    building = build_building(1)
    faces = _faces(tmp_path, building)
    predicted = _segments(faces)
    iou = wall_iou(predicted, building.walls)
    mae = thickness_mae(predicted, building.walls)
    angles = _angle_errors(predicted, building.walls)
    print(f"wall IoU {iou:.3f} thickness MAE {mae:.4f} angle {max(angles):.3f}")
    assert _every_truth_wall(building.walls, predicted)
    assert mae <= 0.02
    assert max(angles) <= 1.0
    captured = capsys.readouterr()
    assert "wall IoU" in captured.out


def test_missing_face_is_assumed_with_class_default(tmp_path: Path) -> None:
    building = build_building(1, missing_face=True)
    result = _detect(tmp_path, building)
    assert any(issue["code"] == "assumed_thickness" for issue in result.issues)
    predicted = _segments(result.faces)
    assert _every_truth_wall(building.walls, predicted, gap=0.20)
    for face in result.faces:
        if not _overlaps_truth(face, building.walls, gap=0.20):
            continue
        assert face.assumed is True
        assert face.sides == 1
        expected = assumed_exterior_m if face.kind == "exterior" else assumed_interior_m
        assert face.thickness == pytest.approx(expected)


def test_seven_degrees_snaps_and_twenty_stays() -> None:
    points, normals = _tilted_sheets()
    result = detect_surfaces(
        Normalized(
            points,
            normals,
            1.0,
            0.02,
            np.array([0.0, 0.0, 1.0]),
            [],
            0.0,
        )
    )
    angles = sorted(_direction_deg(face.x1, face.y1, face.x2, face.y2) for face in result.faces)
    assert any(angle <= 1.0 or abs(angle - 90.0) <= 1.0 for angle in angles)
    assert any(abs(angle - 20.0) <= 1.0 for angle in angles)
    assert all(abs(angle - 7.0) > 2.0 for angle in angles)


def test_sofa_does_not_become_a_wall(tmp_path: Path) -> None:
    building = build_building(1)
    faces = _faces(tmp_path, building)
    for face in faces:
        mid_x = (face.x1 + face.x2) / 2.0
        mid_y = (face.y1 + face.y2) / 2.0
        inside = 1.5 <= mid_x <= 3.5 and 3.75 <= mid_y <= 4.65
        assert not inside


def _faces(tmp_path: Path, building):
    return _detect(tmp_path, building).faces


def _detect(tmp_path: Path, building):
    path = tmp_path / "building.glb"
    path.write_bytes(glb_bytes(building))
    return detect_surfaces(normalize_scene(read_source(path)))


def _segments(faces) -> list[WallSeg]:
    return [WallSeg(face.x1, face.y1, face.x2, face.y2, face.thickness) for face in faces]


def _every_truth_wall(truth: list[WallSeg], predicted: list[WallSeg], gap: float = 0.0) -> bool:
    return all(any(_overlap(wall, other, gap) for other in predicted) for wall in truth)


def _overlaps_truth(face, truth: list[WallSeg], gap: float = 0.0) -> bool:
    segment = WallSeg(face.x1, face.y1, face.x2, face.y2, face.thickness)
    return any(_overlap(segment, wall, gap) for wall in truth)


def _overlap(left: WallSeg, right: WallSeg, gap: float = 0.0) -> bool:
    from shapely.geometry import LineString

    a = LineString([(left.x1, left.y1), (left.x2, left.y2)])
    b = LineString([(right.x1, right.y1), (right.x2, right.y2)])
    if gap > 0 and a.distance(b) > gap:
        return False
    shared = a.buffer(max(gap, 1e-6)).intersection(b)
    return not shared.is_empty and shared.length >= 0.2


def _angle_errors(predicted: list[WallSeg], truth: list[WallSeg]) -> list[float]:
    errors: list[float] = []
    for wall in truth:
        matches = [other for other in predicted if _overlap(wall, other)]
        assert matches, wall
        truth_angle = _direction_deg(wall.x1, wall.y1, wall.x2, wall.y2)
        deltas = []
        for item in matches:
            heading = _direction_deg(item.x1, item.y1, item.x2, item.y2)
            deltas.append(_angle_delta(truth_angle, heading))
        best = min(deltas)
        errors.append(best)
    return errors


def _direction_deg(x1: float, y1: float, x2: float, y2: float) -> float:
    angle = float(np.degrees(np.arctan2(y2 - y1, x2 - x1))) % 180.0
    return angle


def _angle_delta(left: float, right: float) -> float:
    delta = abs(left - right) % 180.0
    return min(delta, 180.0 - delta)


def _tilted_sheets() -> tuple[np.ndarray, np.ndarray]:
    sheets = [_sheet(7.0, np.array([0.0, 0.0, 0.0])), _sheet(20.0, np.array([0.0, 5.0, 0.0]))]
    points = np.vstack([item[0] for item in sheets])
    normals = np.vstack([item[1] for item in sheets])
    return points, normals


def _sheet(angle_deg: float, origin: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    radians = np.deg2rad(angle_deg)
    direction = np.array([np.cos(radians), np.sin(radians), 0.0])
    normal = np.array([-np.sin(radians), np.cos(radians), 0.0])
    along = np.arange(0.0, 4.0, 0.05)
    height = np.arange(0.0, 2.5, 0.05)
    grid_u, grid_z = np.meshgrid(along, height, indexing="ij")
    points = (
        origin
        + grid_u.ravel()[:, None] * direction
        + grid_z.ravel()[:, None] * np.array([0.0, 0.0, 1.0])
    )
    normals = np.repeat(normal[None, :], len(points), axis=0)
    return points, normals
