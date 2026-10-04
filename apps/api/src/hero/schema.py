"""Shared floor-plan document."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Vertex(BaseModel):
    id: str
    x: float
    y: float


class Wall(BaseModel):
    id: str
    a: str
    b: str


class Annotation(BaseModel):
    id: str
    x: float
    y: float
    text: str


class Opening(BaseModel):
    id: str
    wall: str
    kind: Literal["door", "window"]
    offset: float = Field(ge=0, le=1)
    width: float = Field(gt=0)


class Dimension(BaseModel):
    id: str
    a: str
    b: str
    offset: float = 0.4


class Room(BaseModel):
    id: str
    name: str = ""
    vertices: list[str] = Field(default_factory=list)


class Plan(BaseModel):
    units: Literal["m"] = "m"
    vertices: list[Vertex] = Field(default_factory=list)
    walls: list[Wall] = Field(default_factory=list)
    annotations: list[Annotation] = Field(default_factory=list)
    openings: list[Opening] = Field(default_factory=list)
    dimensions: list[Dimension] = Field(default_factory=list)
    rooms: list[Room] = Field(default_factory=list)

    @model_validator(mode="after")
    def endpoints_exist(self) -> "Plan":
        ids = {vertex.id for vertex in self.vertices}
        if len(ids) != len(self.vertices):
            raise ValueError("vertex ids must be unique")
        wall_ids = {wall.id for wall in self.walls}
        if len(wall_ids) != len(self.walls):
            raise ValueError("wall ids must be unique")
        for wall in self.walls:
            if wall.a not in ids or wall.b not in ids:
                raise ValueError("a wall references a missing vertex")
            if wall.a == wall.b:
                raise ValueError("a wall needs two different vertices")
        for opening in self.openings:
            if opening.wall not in wall_ids:
                raise ValueError("an opening references a missing wall")
        for dimension in self.dimensions:
            if dimension.a not in ids or dimension.b not in ids or dimension.a == dimension.b:
                raise ValueError("a dimension needs two different vertices")
        for room in self.rooms:
            if any(vertex_id not in ids for vertex_id in room.vertices):
                raise ValueError("a room references a missing vertex")
        return self
