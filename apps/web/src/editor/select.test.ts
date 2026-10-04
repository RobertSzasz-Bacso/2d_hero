import { describe, expect, it } from "vitest"
import type { Plan } from "@/core/plan-types.ts"
import { itemsInBox, type SelectionItem } from "./select.ts"

function rectanglePlan(): Plan {
  return {
    schemaVersion: 2,
    units: "m",
    revision: 0,
    project: { name: "Box", address: "", northAngleDeg: 0 },
    sheet: {
      paper: "A3",
      orientation: "landscape",
      scale: 50,
      titleBlock: { company: "", project: "", address: "", drawnBy: "", date: "", sheetTitle: "", sheetNumber: "", revisionNote: "" },
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
        openings: [{ id: "o1", wall: "w1", kind: "door", offset: 0.5, width: 0.9, sill: 0, head: 2.1, swing: "left", swingSide: "positive", confidence: 1 }],
        columns: [],
        stairs: [],
        rooms: [{ id: "r1", name: "Room", number: "01", seed: { x: 2.5, y: 2 } }],
        separators: [],
        fixtures: [{ id: "f1", symbol: "toilet", x: 1, y: 0.6, rotationDeg: 0, width: 0.4, depth: 0.7, confidence: 1, role: "fixture" }],
        texts: [],
        dimensions: [],
        suppressedAutoDimensions: [],
      },
    ],
  }
}

function keys(items: SelectionItem[]): string[] {
  return items.map((item) => `${item.kind}:${item.id}`).sort()
}

describe("box selection", () => {
  const plan = rectanglePlan()
  const box = { minX: -1, minY: -1, maxX: 2.6, maxY: 1 }

  it("window selection returns only items fully inside the box", () => {
    expect(keys(itemsInBox(plan, "L1", box, "window"))).toEqual(["fixture:f1", "vertex:v1"])
  })

  it("crossing selection also returns items that touch the box", () => {
    expect(keys(itemsInBox(plan, "L1", box, "crossing"))).toEqual(["fixture:f1", "opening:o1", "room:r1", "vertex:v1", "wall:w1", "wall:w4"])
  })

  it("a window around the whole plan takes everything", () => {
    const all = keys(itemsInBox(plan, "L1", { minX: -1, minY: -1, maxX: 6, maxY: 5 }, "window"))
    expect(all).toEqual(["fixture:f1", "opening:o1", "room:r1", "vertex:v1", "vertex:v2", "vertex:v3", "vertex:v4", "wall:w1", "wall:w2", "wall:w3", "wall:w4"])
  })
})
