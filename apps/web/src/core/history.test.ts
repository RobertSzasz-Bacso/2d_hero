import { describe, expect, it } from "vitest"
import { PlanHistory } from "./history.ts"
import { moveWall } from "./ops.ts"
import type { Plan } from "./plan-types.ts"
import { editorTolerances } from "./tolerances.ts"

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
        rooms: [],
        separators: [],
        fixtures: [],
        texts: [],
        dimensions: [],
        suppressedAutoDimensions: [],
      },
    ],
  }
}

describe("undo", () => {
  it("restores vertex coordinates bitwise after undo and redo of a pure move", () => {
    const history = new PlanHistory(rectangle())
    history.commitPlan(moveWall(history.plan, "L1", "w1", { x: 0, y: 0.1 }))
    const moved = history.plan.levels[0]?.vertices.map((vertex) => ({ id: vertex.id, x: vertex.x, y: vertex.y })) ?? []
    history.undo()
    expect(history.plan.levels[0]?.vertices.find((vertex) => vertex.id === "v1")?.y).toBe(0)
    history.redo()
    const restored = history.plan.levels[0]?.vertices ?? []
    for (const vertex of moved) {
      const next = restored.find((item) => item.id === vertex.id)
      expect(Object.is(next?.x, vertex.x)).toBe(true)
      expect(Object.is(next?.y, vertex.y)).toBe(true)
    }
  })

  it("keeps one transaction for a pointer drag and caps history at 100", () => {
    const history = new PlanHistory(rectangle())
    history.begin()
    history.commitPlan(moveWall(history.plan, "L1", "w1", { x: 0, y: 0.02 }))
    history.commitPlan(moveWall(history.plan, "L1", "w1", { x: 0, y: 0.03 }))
    history.end()
    history.undo()
    expect(history.plan.levels[0]?.vertices.find((vertex) => vertex.id === "v1")?.y).toBe(0)

    let plan = rectangle()
    const capped = new PlanHistory(plan)
    for (let i = 0; i < editorTolerances.history_limit + 1; i += 1) {
      plan = moveWall(capped.plan, "L1", "w1", { x: 0, y: 0.01 })
      capped.commitPlan(plan)
    }
    for (let i = 0; i < editorTolerances.history_limit; i += 1) {
      capped.undo()
    }
    expect(capped.plan.levels[0]?.vertices.find((vertex) => vertex.id === "v1")?.y).not.toBe(0)
  })
})
