"""Seeded multi-storey building. Geometry is metres, Z up, before file scaling."""

from dataclasses import dataclass
from typing import Literal

import numpy as np
from shapely.geometry import Polygon

from hero.schema import (
    Column,
    Detection,
    DetectionSource,
    Fixture,
    Level,
    Opening,
    Plan,
    Point,
    ProjectInfo,
    Room,
    Stair,
    Vertex,
    Wall,
)
from hero.testkit.metrics import OpeningMark, WallSeg

_WIDTH = 8.0
_DEPTH = 6.0
_THICK = 0.25
_PARTITION = 0.15
_CEILING = 2.7
_STOREY = 3.0


@dataclass
class Building:
    plan: Plan
    vertices: np.ndarray
    faces: np.ndarray
    walls: list[WallSeg]
    rooms: list[Polygon]
    openings: list[OpeningMark]
    true_up: np.ndarray
    unit_scale_to_meters: float
    storey_elevations: list[float]


def build_building(
    seed: int = 1,
    *,
    noise_m: float = 0.0,
    tilt_deg: float = 0.0,
    millimetres: bool = False,
    missing_face: bool = False,
    open_gap: bool = False,
    blocked_opening: bool = False,
    furniture: Literal["default", "bathroom", "bedroom", "bare", "block"] = "default",
) -> Building:
    """Build the default apartment. The same seed always returns the same mesh."""
    vertices, faces = _mesh(
        missing_face=missing_face,
        open_gap=open_gap,
        blocked_opening=blocked_opening,
        furniture=furniture,
    )
    generator = np.random.default_rng(seed)
    if noise_m > 0:
        vertices = vertices + generator.normal(0.0, noise_m, size=vertices.shape)
    true_up = np.array([0.0, 0.0, 1.0])
    if tilt_deg:
        theta = np.deg2rad(tilt_deg)
        cosine = float(np.cos(theta))
        sine = float(np.sin(theta))
        rotation = np.array([[1.0, 0.0, 0.0], [0.0, cosine, -sine], [0.0, sine, cosine]])
        vertices = vertices @ rotation.T
        true_up = rotation @ true_up
    scale = 0.001 if millimetres else 1.0
    if millimetres:
        vertices = vertices * 1000.0
    return Building(
        plan=_plan(scale, furniture=furniture),
        vertices=np.ascontiguousarray(vertices, dtype=np.float64),
        faces=np.ascontiguousarray(faces, dtype=np.int64),
        walls=_walls(),
        rooms=_rooms(),
        openings=_openings(),
        true_up=true_up,
        unit_scale_to_meters=scale,
        storey_elevations=[0.0, _STOREY],
    )


def _plan(
    unit_scale: float,
    *,
    furniture: Literal["default", "bathroom", "bedroom", "bare", "block"] = "default",
) -> Plan:
    return Plan(
        schemaVersion=2,
        units="m",
        revision=0,
        project=ProjectInfo(name="Synthetic", address=""),
        detection=Detection(
            source=DetectionSource(
                filename="building.glb",
                format="glb",
                unitScaleToMeters=unit_scale,
                upAxis="z",
                manhattanAngleDeg=0,
                linked=False,
            )
        ),
        levels=[
            _level("Lg", "Ground", 0.0, door=True, furniture=furniture),
            _level("Lu", "Upper", _STOREY, door=False, furniture="bare"),
        ],
    )


def _level(
    prefix: str,
    name: str,
    elevation: float,
    *,
    door: bool,
    furniture: Literal["default", "bathroom", "bedroom", "bare", "block"] = "default",
) -> Level:
    vertices = [
        Vertex(id=f"{prefix}a", x=0, y=0),
        Vertex(id=f"{prefix}b", x=_WIDTH, y=0),
        Vertex(id=f"{prefix}c", x=_WIDTH, y=_DEPTH),
        Vertex(id=f"{prefix}d", x=0, y=_DEPTH),
        Vertex(id=f"{prefix}e", x=4, y=0),
        Vertex(id=f"{prefix}f", x=4, y=_DEPTH),
    ]
    specs: list[tuple[str, str, str, float, Literal["exterior", "partition"]]] = [
        ("ws", "a", "b", _THICK, "exterior"),
        ("we", "b", "c", _THICK, "exterior"),
        ("wn", "c", "d", _THICK, "exterior"),
        ("ww", "d", "a", _THICK, "exterior"),
        ("wp", "e", "f", _PARTITION, "partition"),
    ]
    walls = [
        Wall(
            id=f"{prefix}{suffix}",
            a=f"{prefix}{a}",
            b=f"{prefix}{b}",
            thickness=thickness,
            kind=kind,
            confidence=1,
        )
        for suffix, a, b, thickness, kind in specs
    ]
    openings = [
        Opening(
            id=f"{prefix}win",
            wall=f"{prefix}wn",
            kind="window",
            offset=0.25,
            width=1.2,
            sill=0.9,
            head=2.1,
            swing="none",
            swingSide="positive",
            confidence=1,
        )
    ]
    if door:
        openings.insert(
            0,
            Opening(
                id=f"{prefix}door",
                wall=f"{prefix}ws",
                kind="door",
                offset=0.25,
                width=0.9,
                sill=0,
                head=2.1,
                swing="left",
                swingSide="positive",
                confidence=1,
            ),
        )
    columns = []
    stairs = []
    fixtures = _fixtures(prefix, furniture) if door else []
    if door:
        columns.append(Column(id=f"{prefix}col", x=2, y=2, width=0.4, depth=0.4, rotationDeg=0))
        stairs.append(
            Stair(
                id=f"{prefix}stair",
                outline=[
                    Point(x=5.2, y=0.4),
                    Point(x=6.4, y=0.4),
                    Point(x=6.4, y=3.2),
                    Point(x=5.2, y=3.2),
                ],
                direction=Point(x=0, y=1),
                riserCount=16,
                fromElevation=0,
                toElevation=_STOREY,
            )
        )
    half = _THICK / 2
    part = _PARTITION / 2
    rooms = [
        Room(id=f"{prefix}r1", name="Living", number="01", seed=Point(x=2, y=3)),
        Room(id=f"{prefix}r2", name="Kitchen", number="02", seed=Point(x=6, y=3)),
    ]
    _ = (half, part)
    return Level(
        id=prefix,
        name=name,
        elevation=elevation,
        ceilingHeight=_CEILING,
        vertices=vertices,
        walls=walls,
        openings=openings,
        columns=columns,
        stairs=stairs,
        rooms=rooms,
        fixtures=fixtures,
    )


def _walls() -> list[WallSeg]:
    segments = [
        (0.0, 0.0, _WIDTH, 0.0, _THICK),
        (_WIDTH, 0.0, _WIDTH, _DEPTH, _THICK),
        (_WIDTH, _DEPTH, 0.0, _DEPTH, _THICK),
        (0.0, _DEPTH, 0.0, 0.0, _THICK),
        (4.0, 0.0, 4.0, _DEPTH, _PARTITION),
    ]
    walls: list[WallSeg] = []
    for _elevation in (0.0, _STOREY):
        for x1, y1, x2, y2, thickness in segments:
            walls.append(WallSeg(x1, y1, x2, y2, thickness))
    return walls


def _rooms() -> list[Polygon]:
    half = _THICK / 2
    part = _PARTITION / 2
    living = Polygon(
        [
            (half, half),
            (4 - part, half),
            (4 - part, _DEPTH - half),
            (half, _DEPTH - half),
        ]
    )
    kitchen = Polygon(
        [
            (4 + part, half),
            (_WIDTH - half, half),
            (_WIDTH - half, _DEPTH - half),
            (4 + part, _DEPTH - half),
        ]
    )
    return [living, kitchen, living, kitchen]


def _openings() -> list[OpeningMark]:
    marks = [
        OpeningMark("door", 0.25 * _WIDTH, 0.0, 0.9),
        OpeningMark("window", _WIDTH - 0.25 * _WIDTH, _DEPTH, 1.2),
        OpeningMark("window", _WIDTH - 0.25 * _WIDTH, _DEPTH, 1.2),
    ]
    return marks


class _Mesh:
    def __init__(self) -> None:
        self.vertices: list[list[float]] = []
        self.faces: list[list[int]] = []

    def add_quad(self, corners: list[np.ndarray], *, flip: bool = False) -> None:
        base = len(self.vertices)
        for corner in corners:
            self.vertices.append([float(corner[0]), float(corner[1]), float(corner[2])])
        order = [0, 2, 1, 0, 3, 2] if flip else [0, 1, 2, 0, 2, 3]
        self.faces.append([base + order[0], base + order[1], base + order[2]])
        self.faces.append([base + order[3], base + order[4], base + order[5]])

    def add_vertical_wall(
        self,
        start: np.ndarray,
        end: np.ndarray,
        z0: float,
        z1: float,
        thickness: float,
        *,
        missing_face: bool,
        gap: tuple[float, float, float, float] | None = None,
    ) -> None:
        delta = end - start
        length = float(np.linalg.norm(delta))
        if length == 0:
            return
        direction = delta / length
        normal = np.array([-direction[1], direction[0], 0.0])
        spans = [(0.0, length)]
        bands = [(z0, z1)]
        if gap is not None:
            gap_start, gap_end, gap_z0, gap_z1 = gap
            spans = [(0.0, max(0.0, gap_start)), (min(length, gap_end), length)]
            spans = [(a, b) for a, b in spans if b - a > 1e-6]
            self._wall_spans(start, direction, normal, thickness, spans, [(z0, z1)], missing_face)
            if gap_z0 - z0 > 0.02:
                self._wall_spans(
                    start,
                    direction,
                    normal,
                    thickness,
                    [(gap_start, gap_end)],
                    [(z0, gap_z0)],
                    missing_face,
                )
            if z1 - gap_z1 > 0.02:
                self._wall_spans(
                    start,
                    direction,
                    normal,
                    thickness,
                    [(gap_start, gap_end)],
                    [(gap_z1, z1)],
                    missing_face,
                )
            return
        self._wall_spans(start, direction, normal, thickness, spans, bands, missing_face)

    def _wall_spans(
        self,
        start: np.ndarray,
        direction: np.ndarray,
        normal: np.ndarray,
        thickness: float,
        spans: list[tuple[float, float]],
        bands: list[tuple[float, float]],
        missing_face: bool,
    ) -> None:
        half = normal * (thickness / 2)
        for along0, along1 in spans:
            for z0, z1 in bands:
                a = start + direction * along0
                b = start + direction * along1
                p00 = np.array([a[0], a[1], z0])
                p10 = np.array([b[0], b[1], z0])
                p11 = np.array([b[0], b[1], z1])
                p01 = np.array([a[0], a[1], z1])
                outer0 = p00 + half
                outer1 = p10 + half
                outer2 = p11 + half
                outer3 = p01 + half
                inner0 = p00 - half
                inner1 = p10 - half
                inner2 = p11 - half
                inner3 = p01 - half
                self.add_quad([outer0, outer1, outer2, outer3])
                if not missing_face:
                    self.add_quad([inner0, inner3, inner2, inner1])
                self.add_quad([outer0, inner0, inner1, outer1])
                self.add_quad([outer3, outer2, inner2, inner3])


def _mesh(
    *,
    missing_face: bool,
    open_gap: bool = False,
    blocked_opening: bool = False,
    furniture: Literal["default", "bathroom", "bedroom", "bare", "block"] = "default",
) -> tuple[np.ndarray, np.ndarray]:
    mesh = _Mesh()
    walls = [
        (np.array([0.0, 0.0]), np.array([_WIDTH, 0.0]), _THICK),
        (np.array([_WIDTH, 0.0]), np.array([_WIDTH, _DEPTH]), _THICK),
        (np.array([_WIDTH, _DEPTH]), np.array([0.0, _DEPTH]), _THICK),
        (np.array([0.0, _DEPTH]), np.array([0.0, 0.0]), _THICK),
        (np.array([4.0, 0.0]), np.array([4.0, _DEPTH]), _PARTITION),
    ]
    for storey, door in ((0.0, True), (_STOREY, False)):
        z1 = storey + _CEILING
        for index, (start, end, thickness) in enumerate(walls):
            gap = None
            if index == 0 and door:
                center = 0.25 * _WIDTH
                gap = (center - 0.45, center + 0.45, storey, storey + 2.1)
            if index == 2:
                center = 0.25 * _WIDTH
                gap = (center - 0.6, center + 0.6, storey + 0.9, storey + 2.1)
            if open_gap and index == 3 and storey == 0.0:
                gap = (2.0, 3.0, storey, z1)
            mesh.add_vertical_wall(
                start,
                end,
                storey,
                z1,
                thickness,
                missing_face=missing_face,
                gap=gap,
            )
        _slab(mesh, storey, flip=False)
        _slab(mesh, z1, flip=True)
    _box(mesh, 1.8, 1.8, 0.0, 0.4, 0.4, _CEILING)
    _box(mesh, 5.2, 0.4, 0.0, 1.2, 2.8, _STOREY)
    _ramp(mesh)
    if blocked_opening:
        _box(mesh, 1.55, -0.08, 0.55, 0.90, 0.16, 0.80)
    if furniture in {"default", "bathroom"}:
        _box(mesh, 0.8, 0.65, 0.0, 0.4, 0.7, 0.4)
        _box(mesh, 0.9, 4.775, 0.0, 0.6, 0.45, 0.18)
    if furniture == "default":
        _box(mesh, 1.5, 3.75, 0.0, 2.0, 0.9, 0.8)
    elif furniture == "bedroom":
        _box(mesh, 1.2, 2.6, 0.0, 1.6, 2.0, 0.5)
    elif furniture == "block":
        _box(mesh, 1.75, 2.75, 0.0, 0.5, 0.5, 0.5)
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    return vertices, faces


def _fixtures(
    prefix: str,
    furniture: Literal["default", "bathroom", "bedroom", "bare", "block"],
) -> list[Fixture]:
    toilet = Fixture(
        id=f"{prefix}wc",
        symbol="toilet",
        x=1.0,
        y=1.0,
        rotationDeg=0,
        width=0.4,
        depth=0.7,
        confidence=1,
        role="fixture",
    )
    sink = Fixture(
        id=f"{prefix}sink",
        symbol="sink",
        x=1.2,
        y=5.0,
        rotationDeg=0,
        width=0.6,
        depth=0.45,
        confidence=1,
        role="fixture",
    )
    if furniture == "bathroom":
        return [toilet, sink]
    if furniture == "default":
        return [
            toilet,
            sink,
            Fixture(
                id=f"{prefix}sofa",
                symbol="sofa",
                x=2.5,
                y=4.2,
                rotationDeg=0,
                width=2.0,
                depth=0.9,
                confidence=1,
                role="furniture",
            ),
        ]
    if furniture == "bedroom":
        return [
            Fixture(
                id=f"{prefix}bed",
                symbol="bed-double",
                x=2.0,
                y=3.6,
                rotationDeg=0,
                width=1.6,
                depth=2.0,
                confidence=1,
                role="furniture",
            )
        ]
    return []


def _ramp(mesh: _Mesh) -> None:
    """38° slope over the stair footprint. A solid box is not step or slope evidence."""
    rise = 2.2
    mesh.add_quad(
        [
            np.array([5.2, 0.4, 0.0]),
            np.array([6.4, 0.4, 0.0]),
            np.array([6.4, 3.2, rise]),
            np.array([5.2, 3.2, rise]),
        ]
    )


def _slab(mesh: _Mesh, z: float, *, flip: bool) -> None:
    half = _THICK / 2
    corners = [
        np.array([-half, -half, z]),
        np.array([_WIDTH + half, -half, z]),
        np.array([_WIDTH + half, _DEPTH + half, z]),
        np.array([-half, _DEPTH + half, z]),
    ]
    mesh.add_quad(corners, flip=flip)


def _box(
    mesh: _Mesh,
    x: float,
    y: float,
    z: float,
    width: float,
    depth: float,
    height: float,
) -> None:
    corners_bottom = [
        np.array([x, y, z]),
        np.array([x + width, y, z]),
        np.array([x + width, y + depth, z]),
        np.array([x, y + depth, z]),
    ]
    top = [corner + np.array([0.0, 0.0, height]) for corner in corners_bottom]
    mesh.add_quad(corners_bottom, flip=True)
    mesh.add_quad(top, flip=False)
    for index in range(4):
        nxt = (index + 1) % 4
        mesh.add_quad([corners_bottom[index], corners_bottom[nxt], top[nxt], top[index]])
