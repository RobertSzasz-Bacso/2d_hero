import { describe, expect, it } from "vitest";
import {
  addAnnotation,
  connectVertices,
  deleteAnnotation,
  detectRooms,
  dimensionLength,
  moveVertex,
  openingCenter,
  updateAnnotation,
  type Plan,
} from "./plan";

const room: Plan = {
  units: "m",
  vertices: [
    { id: "v1", x: 0, y: 0 },
    { id: "v2", x: 1, y: 0 },
    { id: "v3", x: 1.2, y: 0.1 },
    { id: "v4", x: 1.2, y: 2 },
  ],
  walls: [
    { id: "w1", a: "v1", b: "v2" },
    { id: "w2", a: "v3", b: "v4" },
  ],
  annotations: [],
};

describe("floor plan edits", () => {
  it("moves only the dragged vertex", () => {
    const moved = moveVertex(room, "v2", 3, 4);
    expect(moved.vertices.find((vertex) => vertex.id === "v1")).toEqual(room.vertices[0]);
    expect(moved.vertices.find((vertex) => vertex.id === "v2")).toEqual({ id: "v2", x: 3, y: 4 });
    expect(moved.walls).toEqual(room.walls);
  });

  it("merges two endpoints and keeps the other wall references valid", () => {
    const connected = connectVertices(room, "v2", "v3");
    expect(connected.vertices.map((vertex) => vertex.id).sort()).toEqual(["v1", "v2", "v4"]);
    const surviving = connected.walls.find((wall) => wall.id === "w2");
    expect(surviving).toBeDefined();
    expect([surviving!.a, surviving!.b].sort()).toEqual(["v2", "v4"]);
    expect(connected.walls.find((wall) => wall.id === "w1")).toMatchObject({ a: "v1", b: "v2" });
  });

  it("adds, edits, and deletes annotations", () => {
    const added = addAnnotation(room, { id: "a1", x: 0.5, y: 0.5, text: "Kitchen" });
    expect(added.annotations).toEqual([{ id: "a1", x: 0.5, y: 0.5, text: "Kitchen" }]);
    const edited = updateAnnotation(added, "a1", "Pantry");
    expect(edited.annotations[0].text).toBe("Pantry");
    const removed = deleteAnnotation(edited, "a1");
    expect(removed.annotations).toEqual([]);
  });

  it("keeps a door on its wall when a corner moves", () => {
    const hosted: Plan = {
      ...room,
      openings: [{ id: "o1", wall: "w1", kind: "door", offset: 0.25, width: 0.9 }],
      dimensions: [{ id: "d1", a: "v1", b: "v2", offset: 0.4 }],
    };
    const moved = moveVertex(hosted, "v2", 4, 3);
    expect(moved.openings?.[0]).toMatchObject({ wall: "w1", offset: 0.25, width: 0.9 });
    expect(openingCenter(moved, moved.openings![0])).toEqual({ x: 1, y: 0.75 });
    expect(dimensionLength(moved, moved.dimensions![0])).toBeCloseTo(5);
  });

  it("reports the live area of a closed room", () => {
    const rectangle: Plan = {
      units: "m",
      vertices: [
        { id: "v1", x: 0, y: 0 },
        { id: "v2", x: 4, y: 0 },
        { id: "v3", x: 4, y: 3 },
        { id: "v4", x: 0, y: 3 },
      ],
      walls: [
        { id: "w1", a: "v1", b: "v2" },
        { id: "w2", a: "v2", b: "v3" },
        { id: "w3", a: "v3", b: "v4" },
        { id: "w4", a: "v4", b: "v1" },
      ],
      annotations: [],
      rooms: [{ id: "r1", name: "Kitchen", vertices: ["v1", "v2", "v3", "v4"] }],
    };
    const found = detectRooms(rectangle);
    expect(found).toHaveLength(1);
    expect(found[0].area).toBeCloseTo(12);
    expect(found[0].name).toBe("Kitchen");
    const stretched = moveVertex(rectangle, "v3", 4, 5);
    const next = moveVertex(stretched, "v4", 0, 5);
    expect(detectRooms(next)[0].area).toBeCloseTo(20);
  });
});
