"""Centerlines to a wall graph and room seeds. See docs/algorithms.md, Cell complex."""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field

import networkx as nx
import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize, unary_union

from hero.pipeline.normalize import Normalized
from hero.pipeline.surfaces import WallFace
from hero.pipeline.tolerances import endpoint_snap_m, min_room_m2, min_wall_m

Seg = dict[str, float | str | bool]


@dataclass
class DraftVertex:
    id: str
    x: float
    y: float


@dataclass
class DraftWall:
    id: str
    a: str
    b: str
    thickness: float
    kind: str
    confidence: float


@dataclass
class DraftRoom:
    id: str
    x: float
    y: float
    name: str
    number: str


@dataclass
class DraftLevel:
    level_id: str
    elevation: float
    ceiling_height: float
    vertices: list[DraftVertex] = field(default_factory=list)
    walls: list[DraftWall] = field(default_factory=list)
    rooms: list[DraftRoom] = field(default_factory=list)
    issues: list[dict[str, str]] = field(default_factory=list)


def draft_levels(result: Normalized, faces: list[WallFace]) -> list[DraftLevel]:
    """One editable storey per detected level."""
    levels = list(result.levels)
    if not levels:
        return []
    drafts: list[DraftLevel] = []
    for index, level in enumerate(levels):
        own = [face for face in faces if face.level_index == index]
        mask = _level_mask(result.points, level.elevation, level.ceiling_height)
        drafts.append(
            _draft(
                f"L{index + 1}",
                level.elevation,
                level.ceiling_height,
                own,
                result.points[mask],
                result.normals[mask],
            )
        )
    return drafts


def _draft(
    level_id: str,
    elevation: float,
    ceiling: float,
    faces: list[WallFace],
    points: np.ndarray,
    normals: np.ndarray,
) -> DraftLevel:
    draft = DraftLevel(level_id, elevation, ceiling if ceiling > 1.5 else 2.7)
    kept = _drop_assumed_islands(faces)
    segments = _snap_segments(kept)
    if not segments:
        return draft
    lines = [
        LineString(
            [
                (float(item["x1"]), float(item["y1"])),
                (float(item["x2"]), float(item["y2"])),
            ]
        )
        for item in segments
    ]
    noded = unary_union(lines)
    pieces = _pieces(noded)
    labelled = []
    for piece in pieces:
        parent = _parent(piece, segments)
        if parent is None or piece.length < 0.05:
            continue
        labelled.append((piece, parent))
    cells = [cell for cell in polygonize([piece for piece,
        _parent_face in labelled]) if cell.area > 1e-4]
    inside = _inside_cells(cells, points, normals)
    chosen = _separating(labelled, cells, inside)
    open_ends = _open_ends(chosen)
    floor_outside = _floor_outside(points, normals, cells, inside)
    merged = _merge_collinear(chosen)
    _write_geometry(draft, merged, cells, inside)
    if open_ends or floor_outside:
        draft.issues.append(
            {
                "code": "open_gap",
                "severity": "warning",
                "message": "A room is open where a wall is missing.",
                "elementId": draft.walls[0].id if draft.walls else "",
            }
        )
    return draft


def _drop_assumed_islands(faces: list[WallFace]) -> list[WallFace]:
    if not faces:
        return []
    parent = list(range(len(faces)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    ends = [(index, face.x1, face.y1) for index, face in enumerate(faces)]
    ends.extend((index, face.x2, face.y2) for index, face in enumerate(faces))
    for left in range(len(ends)):
        for right in range(left + 1, len(ends)):
            a = ends[left]
            b = ends[right]
            if a[0] == b[0]:
                continue
            if math.hypot(a[1] - b[1], a[2] - b[2]) <= endpoint_snap_m:
                parent[find(a[0])] = find(b[0])
    groups: dict[int, list[WallFace]] = defaultdict(list)
    for index, face in enumerate(faces):
        groups[find(index)].append(face)
    kept: list[WallFace] = []
    for group in groups.values():
        if any(not face.assumed for face in group) or any(face.kind == "exterior" for face in 
            group):
            kept.extend(group)
    return kept


def _snap_segments(faces: list[WallFace]) -> list[Seg]:
    segments = [
        _axis_align(
            {
                "x1": face.x1,
                "y1": face.y1,
                "x2": face.x2,
                "y2": face.y2,
                "thickness": face.thickness,
                "kind": "assumed" if face.assumed else face.kind,
                "confidence": face.confidence,
                "assumed": face.assumed,
            }
        )
        for face in faces
        if math.hypot(face.x2 - face.x1, face.y2 - face.y1) >= min_wall_m
    ]
    return _join_ends(segments)


def _axis_align(segment: Seg) -> Seg:
    """A wall within 1° of an axis is written on that axis so joins meet exactly."""
    x1, y1 = float(segment["x1"]), float(segment["y1"])
    x2, y2 = float(segment["x2"]), float(segment["y2"])
    angle = abs(math.degrees(math.atan2(y2 - y1, x2 - x1))) % 180.0
    if angle > 90.0:
        angle = 180.0 - angle
    if angle <= 1.0:
        mid = round((y1 + y2) / 2.0, 4)
        segment["y1"] = mid
        segment["y2"] = mid
    elif abs(angle - 90.0) <= 1.0:
        mid = round((x1 + x2) / 2.0, 4)
        segment["x1"] = mid
        segment["x2"] = mid
    return segment


def _join_ends(segments: list[Seg]) -> list[Seg]:
    """Snap each end to a nearby wall intersection, then split the host at that point."""
    cuts: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for index, segment in enumerate(segments):
        for key_x, key_y in (("x1", "y1"), ("x2", "y2")):
            point = (float(segment[key_x]), float(segment[key_y]))
            best: tuple[float, float] | None = None
            best_host = -1
            best_distance = endpoint_snap_m
            interior = False
            for host_index, other in enumerate(segments):
                if host_index == index:
                    continue
                hit = _line_hit(segment, other)
                if hit is None or not _near_segment(hit, other):
                    continue
                distance = math.hypot(point[0] - hit[0], point[1] - hit[1])
                if distance >= best_distance:
                    continue
                best = (round(hit[0], 4), round(hit[1], 4))
                best_host = host_index
                best_distance = distance
                interior = _foot_on_segment(best, other) is not None
            if best is None:
                continue
            segment[key_x] = best[0]
            segment[key_y] = best[1]
            if interior:
                cuts[best_host].append(best)
    rebuilt: list[Seg] = []
    for index, segment in enumerate(segments):
        points = cuts.get(index, [])
        rebuilt.extend(_split_segment(segment, points) if points else [segment])
    return [segment for segment in rebuilt if _length(segment) >= min_wall_m]


def _split_segment(
    segment: Seg, cuts: list[tuple[float, float]]
) -> list[Seg]:
    start = (float(segment["x1"]), float(segment["y1"]))
    end = (float(segment["x2"]), float(segment["y2"]))
    dx, dy = end[0] - start[0], end[1] - start[1]
    length2 = dx * dx + dy * dy
    ordered = sorted(cuts,
        key=lambda point: ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length2)
    chain = [start, *ordered, end]
    pieces: list[Seg] = []
    for left, right in zip(chain, chain[1:], strict=False):
        if math.hypot(right[0] - left[0], right[1] - left[1]) < 1e-4:
            continue
        pieces.append({**segment, "x1": left[0], "y1": left[1], "x2": right[0], "y2": right[1]})
    return pieces or [segment]


def _line_hit(
    left: Seg, right: Seg
) -> tuple[float, float] | None:
    x1, y1 = float(left["x1"]), float(left["y1"])
    x2, y2 = float(left["x2"]), float(left["y2"])
    x3, y3 = float(right["x1"]), float(right["y1"])
    x4, y4 = float(right["x2"]), float(right["y2"])
    denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(denom) < 1e-9:
        return None
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
    return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))


def _near_segment(point: tuple[float, float], segment: Seg) -> bool:
    x1, y1 = float(segment["x1"]), float(segment["y1"])
    x2, y2 = float(segment["x2"]), float(segment["y2"])
    dx, dy = x2 - x1, y2 - y1
    length2 = dx * dx + dy * dy
    if length2 == 0:
        return False
    t = ((point[0] - x1) * dx + (point[1] - y1) * dy) / length2
    length = math.sqrt(length2)
    margin = endpoint_snap_m / length
    return -margin <= t <= 1 + margin


def _foot_on_segment(point: tuple[float, float], segment: Seg) -> tuple[float, float] | None:
    x1, y1 = float(segment["x1"]), float(segment["y1"])
    x2, y2 = float(segment["x2"]), float(segment["y2"])
    dx, dy = x2 - x1, y2 - y1
    length2 = dx * dx + dy * dy
    if length2 == 0:
        return None
    t = ((point[0] - x1) * dx + (point[1] - y1) * dy) / length2
    if t <= 0.02 or t >= 0.98:
        return None
    return (x1 + t * dx, y1 + t * dy)


def _pieces(noded) -> list[LineString]:
    if noded.is_empty:
        return []
    if noded.geom_type == "LineString":
        return [noded]
    if noded.geom_type == "MultiLineString":
        return list(noded.geoms)
    found: list[LineString] = []
    for geom in getattr(noded, "geoms", []):
        found.extend(_pieces(geom))
    return found


def _parent(piece: LineString, segments: list[Seg]) -> Seg | None:
    mid = piece.interpolate(0.5, normalized=True)
    best: Seg | None = None
    best_distance = 0.03
    for segment in segments:
        line = LineString(
            [
                (float(segment["x1"]), float(segment["y1"])),
                (float(segment["x2"]), float(segment["y2"])),
            ]
        )
        distance = float(line.distance(mid))
        if distance < best_distance:
            best = segment
            best_distance = distance
    return best


def _inside_cells(cells: list[Polygon], points: np.ndarray, normals: np.ndarray) -> set[int]:
    if not cells:
        return set()
    floor = points[normals[:, 2] > 0.7] if len(points) else points
    ceiling = points[normals[:, 2] < -0.7] if len(points) else points
    floor_scores: list[float] = []
    ceiling_scores: list[float] = []
    for cell in cells:
        area = max(float(cell.area), 1e-6)
        floor_scores.append(_count_inside(cell, floor) / area)
        ceiling_scores.append(_count_inside(cell, ceiling) / area)
    nonempty = [
        index
        for index, (floor_score, ceiling_score) in enumerate(zip(floor_scores, ceiling_scores,
            strict=True))
        if floor_score > 0 or ceiling_score > 0
    ]
    if not nonempty:
        return set()
    samples = [max(floor_scores[index], ceiling_scores[index]) for index in nonempty]
    median = float(np.median(np.asarray(samples)))
    sure = {
        index
        for index in nonempty
        if max(floor_scores[index],
            ceiling_scores[index]) >= median and max(floor_scores[index], ceiling_scores[index]) > 0
    }
    return _cut(cells, sure)


def _count_inside(cell: Polygon, points: np.ndarray) -> float:
    if len(points) == 0:
        return 0.0
    from shapely import contains_xy

    return float(np.count_nonzero(contains_xy(cell, points[:, 0], points[:, 1])))


def _cut(cells: list[Polygon], sure: set[int]) -> set[int]:
    if not sure:
        return set()
    graph = nx.Graph()
    graph.add_node("outside")
    for index in range(len(cells)):
        graph.add_node(index)
    for left in range(len(cells)):
        for right in range(left + 1, len(cells)):
            shared = cells[left].boundary.intersection(cells[right].boundary)
            if shared.is_empty or shared.length < 0.05:
                continue
            graph.add_edge(left, right, capacity=1000)
    outer = unary_union(cells).boundary
    for index, cell in enumerate(cells):
        shared = cell.boundary.intersection(outer)
        if not shared.is_empty and shared.length >= 0.05:
            graph.add_edge(index, "outside", capacity=1000)
    graph.add_node("source")
    graph.add_node("sink")
    for index in sure:
        graph.add_edge("source", index, capacity=1_000_000)
    graph.add_edge("sink", "outside", capacity=1_000_000)
    try:
        _value, (source_side, _sink_side) = nx.minimum_cut(graph, "source", "sink",
            capacity="capacity")
    except nx.NetworkXError:
        return set(sure)
    return {node for node in source_side if isinstance(node, int)}


def _separating(
    labelled: list[tuple[LineString, Seg]],
    cells: list[Polygon],
    inside: set[int],
) -> list[dict[str, float | str]]:
    chosen: list[dict[str, float | str]] = []
    for piece, parent in labelled:
        owners = _owners(piece, cells)
        if not _keep(owners, inside):
            continue
        coords = list(piece.coords)
        chosen.append(
            {
                "x1": float(coords[0][0]),
                "y1": float(coords[0][1]),
                "x2": float(coords[-1][0]),
                "y2": float(coords[-1][1]),
                "thickness": float(parent["thickness"]),
                "kind": str(parent["kind"]),
                "confidence": float(parent["confidence"]),
            }
        )
    return chosen


def _owners(piece: LineString, cells: list[Polygon]) -> list[int]:
    owners: list[int] = []
    for index, cell in enumerate(cells):
        shared = cell.boundary.intersection(piece)
        if not shared.is_empty and shared.length >= piece.length * 0.5:
            owners.append(index)
    return owners


def _keep(owners: list[int], inside: set[int]) -> bool:
    labels = [index in inside for index in owners]
    if not labels:
        return False
    if len(labels) == 1:
        return labels[0]
    if labels[0] and labels[1]:
        return True
    return labels[0] != labels[1]


def _open_ends(walls: list[dict[str, float | str]]) -> list[str]:
    degree: dict[tuple[float, float], int] = defaultdict(int)
    ends: dict[tuple[float, float], str] = {}
    for index, wall in enumerate(walls):
        a = (round(float(wall["x1"]), 3), round(float(wall["y1"]), 3))
        b = (round(float(wall["x2"]), 3), round(float(wall["y2"]), 3))
        degree[a] += 1
        degree[b] += 1
        ends[a] = f"w{index + 1}"
        ends[b] = f"w{index + 1}"
    return [ends[point] for point, count in degree.items() if count == 1]


def _floor_outside(points: np.ndarray, normals: np.ndarray, cells: list[Polygon],
    inside: set[int]) -> bool:
    if len(points) == 0 or not cells:
        return False
    floor = points[normals[:, 2] > 0.7]
    if len(floor) < 50:
        return False
    from shapely import contains_xy

    covered = np.zeros(len(floor), dtype=bool)
    for index in inside:
        covered |= contains_xy(cells[index], floor[:, 0], floor[:, 1])
    return float(np.count_nonzero(~covered)) / len(floor) > 0.15


def _merge_collinear(walls: list[dict[str, float | str]]) -> list[dict[str, float | str]]:
    current = [dict(wall) for wall in walls if _length(wall) >= min_wall_m]
    changed = True
    while changed:
        changed = False
        for left in range(len(current)):
            for right in range(left + 1, len(current)):
                merged = _try_merge(current[left], current[right])
                if merged is None:
                    continue
                current = [item for index, item in enumerate(current) if index not in {left, right}]
                current.append(merged)
                changed = True
                break
            if changed:
                break
    unique: list[dict[str, float | str]] = []
    seen: set[tuple[tuple[float, float], tuple[float, float]]] = set()
    for wall in current:
        a = (round(float(wall["x1"]), 3), round(float(wall["y1"]), 3))
        b = (round(float(wall["x2"]), 3), round(float(wall["y2"]), 3))
        key = (a, b) if a <= b else (b, a)
        if key in seen or a == b:
            continue
        seen.add(key)
        unique.append(wall)
    return unique


def _try_merge(
    left: dict[str, float | str], right: dict[str, float | str]
) -> dict[str, float | str] | None:
    same_kind = left["kind"] == right["kind"]
    close = abs(float(left["thickness"]) - float(right["thickness"])) <= 0.001
    if not same_kind or not close:
        return None
    ends_left = [
        (float(left["x1"]), float(left["y1"])),
        (float(left["x2"]), float(left["y2"])),
    ]
    ends_right = [
        (float(right["x1"]), float(right["y1"])),
        (float(right["x2"]), float(right["y2"])),
    ]
    shared = None
    for a in ends_left:
        for b in ends_right:
            if math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.001:
                shared = a
    if shared is None:
        return None
    far_left = ends_left[0] if math.hypot(ends_left[1][0] - shared[0],
        ends_left[1][1] - shared[1]) <= 0.001 else ends_left[1]
    far_right = ends_right[0] if math.hypot(ends_right[1][0] - shared[0],
        ends_right[1][1] - shared[1]) <= 0.001 else ends_right[1]
    angle = _turn(shared, far_left, far_right)
    if abs(angle - 180) > 1:
        return None
    return {
        "x1": far_left[0],
        "y1": far_left[1],
        "x2": far_right[0],
        "y2": far_right[1],
        "thickness": left["thickness"],
        "kind": left["kind"],
        "confidence": min(float(left["confidence"]), float(right["confidence"])),
    }


def _turn(vertex: tuple[float, float], left: tuple[float, float], right: tuple[float,
    float]) -> float:
    ax, ay = left[0] - vertex[0], left[1] - vertex[1]
    bx, by = right[0] - vertex[0], right[1] - vertex[1]
    la = math.hypot(ax, ay)
    lb = math.hypot(bx, by)
    if la == 0 or lb == 0:
        return 0.0
    cosine = min(1.0, max(-1.0, (ax * bx + ay * by) / (la * lb)))
    return math.degrees(math.acos(cosine))


def _length(wall: dict[str, float | str]) -> float:
    return math.hypot(float(wall["x2"]) - float(wall["x1"]), float(wall["y2"]) - float(wall["y1"]))


def _write_geometry(draft: DraftLevel, walls: list[dict[str, float | str]],
    cells: list[Polygon], inside: set[int]) -> None:
    index_of: dict[tuple[float, float], str] = {}
    vertices: list[DraftVertex] = []

    def vertex(x: float, y: float) -> str:
        key = (round(x, 3), round(y, 3))
        found = index_of.get(key)
        if found is not None:
            return found
        item_id = f"v{len(vertices) + 1}"
        index_of[key] = item_id
        vertices.append(DraftVertex(item_id, key[0], key[1]))
        return item_id

    draft_walls: list[DraftWall] = []
    for wall in walls:
        a = vertex(float(wall["x1"]), float(wall["y1"]))
        b = vertex(float(wall["x2"]), float(wall["y2"]))
        if a == b:
            continue
        kind = str(wall["kind"])
        if kind not in {"exterior", "interior", "partition", "assumed"}:
            kind = "interior"
        draft_walls.append(
            DraftWall(
                f"w{len(draft_walls) + 1}",
                a,
                b,
                float(wall["thickness"]),
                kind,
                float(wall["confidence"]),
            )
        )
    rooms: list[DraftRoom] = []
    for index in sorted(inside):
        cell = cells[index]
        if float(cell.area) < min_room_m2:
            continue
        seed = cell.representative_point()
        rooms.append(DraftRoom(f"r{len(rooms) + 1}", float(seed.x), float(seed.y), "Room",
            str(len(rooms) + 1)))
    draft.vertices = vertices
    draft.walls = draft_walls
    draft.rooms = _shrink_seeds(draft_walls, vertices, rooms)


def _shrink_seeds(walls: list[DraftWall], vertices: list[DraftVertex],
    rooms: list[DraftRoom]) -> list[DraftRoom]:
    if not rooms or not walls:
        return rooms
    from hero.planops.model import wrap
    from hero.planops.polygons import free_faces, wall_polygons

    plan = wrap(
        {
            "levels": [
                {
                    "id": "L1",
                    "vertices": [{"id": vertex.id, "x": vertex.x,
                        "y": vertex.y} for vertex in vertices],
                    "walls": [
                        {
                            "id": wall.id,
                            "a": wall.a,
                            "b": wall.b,
                            "thickness": wall.thickness,
                            "kind": wall.kind,
                            "confidence": wall.confidence,
                        }
                        for wall in walls
                    ],
                    "separators": [],
                }
            ]
        }
    )
    faces = [Polygon([(point["x"],
        point["y"]) for point in ring]) for ring in free_faces(wall_polygons(plan, "L1"))]
    shrunk: list[DraftRoom] = []
    for room in rooms:
        seed = Point(room.x, room.y)
        host = next((face for face in faces if face.contains(seed) or 
            face.boundary.distance(seed) <= 0.02), None)
        if host is None:
            host = max(faces, key=lambda face: face.intersection(seed.buffer(0.3)).area,
                default=None) if faces else None
        if host is not None and not host.contains(seed):
            point = host.representative_point()
            room = DraftRoom(room.id, float(point.x), float(point.y), room.name, room.number)
        shrunk.append(room)
    return shrunk


def _level_mask(points: np.ndarray, elevation: float, ceiling: float) -> np.ndarray:
    if len(points) == 0:
        return np.zeros(0, dtype=bool)
    return (points[:, 2] >= elevation - 0.3) & (points[:, 2] <= elevation + ceiling + 0.3)
