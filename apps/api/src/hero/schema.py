"""Plan schema v2. This module is the source of truth for the plan document."""

import json
import math
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

Finite = Annotated[float, Field(allow_inf_nan=False)]
Id = Annotated[str, Field(pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,31}$")]

IssueCode = Literal[
    "gravity_uncertain",
    "units_guessed",
    "non_manhattan",
    "assumed_thickness",
    "open_gap",
    "uncertain_room",
    "room_seed_lost",
    "room_not_split",
    "low_confidence_opening",
    "ifc_wall_from_solid",
    "missing_source",
]

SymbolId = Literal[
    "toilet",
    "sink",
    "bathtub",
    "shower",
    "kitchen-counter",
    "stove",
    "bed-double",
    "sofa",
    "table",
    "wardrobe",
    "block",
    "chair",
]


class PlanModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProjectInfo(PlanModel):
    name: str = ""
    address: str = ""
    northAngleDeg: Finite = 0


class TitleBlock(PlanModel):
    company: str = ""
    project: str = ""
    address: str = ""
    drawnBy: str = ""
    date: str = ""
    sheetTitle: str = ""
    sheetNumber: str = ""
    revisionNote: str = ""


class Sheet(PlanModel):
    paper: Literal["A4", "A3", "A2", "A1"] = "A3"
    orientation: Literal["landscape", "portrait"] = "landscape"
    scale: Literal[50, 100, 200] = 50
    titleBlock: TitleBlock = Field(default_factory=TitleBlock)


class DetectionSource(PlanModel):
    filename: str
    format: Literal["obj", "glb", "gltf", "usdz", "ply", "e57", "las", "laz", "ifc", "hand"]
    unitScaleToMeters: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    upAxis: Literal["x", "y", "z"]
    manhattanAngleDeg: Finite
    linked: bool


class Issue(PlanModel):
    id: str
    severity: Literal["info", "warning", "error"]
    code: IssueCode
    message: str
    levelId: str | None = None
    elementId: str | None = None


class Detection(PlanModel):
    source: DetectionSource | None = None
    issues: list[Issue] = Field(default_factory=list)


class Vertex(PlanModel):
    id: Id
    x: Finite
    y: Finite


class Wall(PlanModel):
    id: Id
    a: Id
    b: Id
    thickness: Annotated[float, Field(gt=0, le=1.5, allow_inf_nan=False)]
    kind: Literal["exterior", "interior", "partition", "assumed"]
    confidence: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class Opening(PlanModel):
    id: Id
    wall: Id
    kind: Literal["door", "window", "passage"]
    offset: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
    width: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    sill: Annotated[float, Field(ge=0, allow_inf_nan=False)]
    head: Finite
    swing: Literal["left", "right", "double", "sliding", "none"]
    swingSide: Literal["positive", "negative"]
    confidence: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class Column(PlanModel):
    id: Id
    x: Finite
    y: Finite
    width: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    depth: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    rotationDeg: Finite


class Point(PlanModel):
    x: Finite
    y: Finite


class Stair(PlanModel):
    id: Id
    outline: list[Point] = Field(min_length=3)
    direction: Point
    riserCount: int = Field(ge=1)
    fromElevation: Finite
    toElevation: Finite


class Room(PlanModel):
    id: Id
    name: str
    number: str
    seed: Point


class Separator(PlanModel):
    id: Id
    a: Id
    b: Id


class Fixture(PlanModel):
    id: Id
    symbol: SymbolId
    x: Finite
    y: Finite
    rotationDeg: Finite
    width: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    depth: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    confidence: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
    role: Literal["fixture", "furniture"]


class PlanText(PlanModel):
    id: Id
    x: Finite
    y: Finite
    text: str
    heightM: Annotated[float, Field(gt=0, allow_inf_nan=False)]


class VertexRef(PlanModel):
    type: Literal["vertex"]
    id: Id


class OpeningRef(PlanModel):
    type: Literal["opening"]
    id: Id
    edge: Literal["start", "end"]


class DimensionSegment(PlanModel):
    a: VertexRef | OpeningRef
    b: VertexRef | OpeningRef


class Dimension(PlanModel):
    id: Id
    auto: bool
    offset: Finite
    segments: list[DimensionSegment] = Field(min_length=1)


class Level(PlanModel):
    id: Id
    name: str
    elevation: Finite
    ceilingHeight: Annotated[float, Field(gt=1.5, allow_inf_nan=False)]
    vertices: list[Vertex] = Field(default_factory=list)
    walls: list[Wall] = Field(default_factory=list)
    openings: list[Opening] = Field(default_factory=list)
    columns: list[Column] = Field(default_factory=list)
    stairs: list[Stair] = Field(default_factory=list)
    rooms: list[Room] = Field(default_factory=list)
    separators: list[Separator] = Field(default_factory=list)
    fixtures: list[Fixture] = Field(default_factory=list)
    texts: list[PlanText] = Field(default_factory=list)
    dimensions: list[Dimension] = Field(default_factory=list)
    suppressedAutoDimensions: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def check_references(self) -> Self:
        ids = [
            item.id
            for group in (
                self.vertices,
                self.walls,
                self.openings,
                self.columns,
                self.stairs,
                self.rooms,
                self.separators,
                self.fixtures,
                self.texts,
                self.dimensions,
            )
            for item in group
        ]
        if len(ids) != len(set(ids)):
            raise ValueError("Two ids in the same level collide.")

        vertices = {vertex.id: vertex for vertex in self.vertices}
        walls = {wall.id: wall for wall in self.walls}
        openings = {opening.id: opening for opening in self.openings}

        for wall in self.walls:
            if wall.a == wall.b:
                raise ValueError("A wall cannot use the same vertex twice.")
            if wall.a not in vertices or wall.b not in vertices:
                raise ValueError("A wall references a missing vertex.")

        for opening in self.openings:
            wall = walls.get(opening.wall)
            if wall is None:
                raise ValueError("An opening references a missing wall.")
            if opening.head <= opening.sill:
                raise ValueError("Opening head must be above the sill.")
            if opening.head > self.ceilingHeight + 0.05:
                raise ValueError("Opening head is above the ceiling.")
            start = vertices[wall.a]
            end = vertices[wall.b]
            length = math.hypot(end.x - start.x, end.y - start.y)
            if opening.width >= length:
                raise ValueError("An opening is longer than its wall.")

        for separator in self.separators:
            if separator.a not in vertices or separator.b not in vertices:
                raise ValueError("A separator references a missing vertex.")

        for dimension in self.dimensions:
            for segment in dimension.segments:
                for endpoint in (segment.a, segment.b):
                    if isinstance(endpoint, VertexRef) and endpoint.id not in vertices:
                        raise ValueError("A dimension references a missing vertex.")
                    if isinstance(endpoint, OpeningRef) and endpoint.id not in openings:
                        raise ValueError("A dimension references a missing opening.")

        for stair in self.stairs:
            length = math.hypot(stair.direction.x, stair.direction.y)
            if abs(length - 1.0) > 1e-6:
                raise ValueError("Stair direction must be a unit vector.")
            if stair.toElevation <= stair.fromElevation:
                raise ValueError("Stair toElevation must be above fromElevation.")
        return self


class Plan(PlanModel):
    schemaVersion: Literal[2]
    units: Literal["m"]
    revision: int = Field(ge=0)
    project: ProjectInfo = Field(default_factory=ProjectInfo)
    levels: list[Level] = Field(default_factory=list)
    sheet: Sheet = Field(default_factory=Sheet)
    detection: Detection = Field(default_factory=Detection)

    @model_validator(mode="after")
    def check_level_ids(self) -> Self:
        ids = [level.id for level in self.levels]
        if len(ids) != len(set(ids)):
            raise ValueError("Level ids must be unique.")
        return self


def dump_plan(plan: Plan) -> str:
    """Serialize a plan with stable UTF-8 JSON."""
    payload = plan.model_dump(mode="json")
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def blank_plan(name: str, title_block: TitleBlock | None = None) -> Plan:
    """A new project with no levels."""
    block = title_block.model_copy() if title_block is not None else TitleBlock()
    if name and not block.project:
        block = block.model_copy(update={"project": name})
    return Plan(
        schemaVersion=2,
        units="m",
        revision=0,
        project=ProjectInfo(name=name),
        sheet=Sheet(titleBlock=block),
    )


def render_plan_types_ts() -> str:
    """TypeScript types for the exported JSON Schema."""
    from hero.plan_types import render_plan_types

    return render_plan_types(Plan.model_json_schema())
