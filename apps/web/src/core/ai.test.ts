import { describe, expect, it } from "vitest"
import { applyAiOps } from "./ai.ts"
import { PlanHistory } from "./history.ts"
import type { Plan } from "./plan-types.ts"

function rectangle(): Plan {
  return {
    schemaVersion: 2,
    units: "m",
    revision: 0,
    project: { name: "Undo", address: "", northAngleDeg: 0 },
    sheet: {
      paper: "A3",
      orientation: "landscape",
      scale: 50,
      titleBlock: {
        company: "",
        project: "",
        address: "",
        drawnBy: "",
        date: "",
        sheetTitle: "",
        sheetNumber: "",
        revisionNote: "",
      },
    },
    detection: { source: null, issues: [] },
    levels: [
      {
        id: "L1",
        name: "Ground floor",
        elevation: 0,
        ceilingHeight: 2.7,
        vertices: [
          { id: "v1", x: 0, y: 0 },
          { id: "v2", x: 5, y: 0 },
          { id: "v3", x: 5, y: 4 },
          { id: "v4", x: 0, y: 4 },
        ],
        walls: [
          { id: "w1", a: "v1", b: "v2", thickness: 0.2, kind: "exterior", confidence: 1 },
          { id: "w2", a: "v2", b: "v3", thickness: 0.2, kind: "exterior", confidence: 1 },
          { id: "w3", a: "v3", b: "v4", thickness: 0.2, kind: "exterior", confidence: 1 },
          { id: "w4", a: "v4", b: "v1", thickness: 0.2, kind: "exterior", confidence: 1 },
        ],
        openings: [],
        columns: [],
        stairs: [],
        rooms: [{ id: "r1", name: "Room", number: "01", seed: { x: 2, y: 2 } }],
        separators: [],
        fixtures: [],
        texts: [],
        dimensions: [],
        suppressedAutoDimensions: [],
      },
    ],
  }
}

describe("AI proposal undo", () => {
  it("accepts a thickness change as one undo step", () => {
    const history = new PlanHistory(rectangle())
    const next = applyAiOps(history.plan, [
      { op: "set_wall_thickness", levelId: "L1", wallId: "w1", thickness: 0.35 },
      { op: "set_room_name", levelId: "L1", roomId: "r1", name: "Living" },
    ])
    history.commitPlan(next)
    expect(history.plan.levels[0]?.walls.find((wall) => wall.id === "w1")?.thickness).toBe(0.35)
    expect(history.plan.levels[0]?.rooms.find((room) => room.id === "r1")?.name).toBe("Living")
    history.undo()
    expect(history.plan.levels[0]?.walls.find((wall) => wall.id === "w1")?.thickness).toBe(0.2)
    expect(history.plan.levels[0]?.rooms.find((room) => room.id === "r1")?.name).toBe("Room")
    history.redo()
    expect(history.plan.levels[0]?.walls.find((wall) => wall.id === "w1")?.thickness).toBe(0.35)
  })
})
