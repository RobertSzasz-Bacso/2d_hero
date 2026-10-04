import { describe, expect, it } from "vitest"
import type { Plan } from "@/core/plan-types.ts"
import { dimensionOffset, dimensionRefAt, lengthAngle, openingGhost, orthoLock, rectangleCorner } from "./tool-math.ts"

function rectangle(): Plan {
  const wall = (id: string, a: string, b: string) => ({ id, a, b, thickness: 0.2, kind: "exterior" as const, confidence: 1 })
  return {
    schemaVersion: 2,
    units: "m",
    revision: 0,
    project: { name: "Tools", address: "", northAngleDeg: 0 },
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
        walls: [wall("w1", "v1", "v2"), wall("w2", "v2", "v3"), wall("w3", "v3", "v4"), wall("w4", "v4", "v1")],
        openings: [{ id: "o1", wall: "w1", kind: "door", offset: 0.5, width: 0.9, sill: 0, head: 2.1, swing: "left", swingSide: "positive", confidence: 1 }],
        columns: [],
        stairs: [],
        rooms: [{ id: "r1", name: "Room", number: "", seed: { x: 2.5, y: 2 } }],
        separators: [],
        fixtures: [],
        texts: [],
        dimensions: [],
        suppressedAutoDimensions: [],
      },
    ],
  }
}

function level() {
  const found = rectangle().levels[0]
  if (!found) {
    throw new Error("missing level")
  }
  return found
}

describe("tool math", () => {
  it("locks to the dominant axis with Shift", () => {
    expect(orthoLock({ x: 0, y: 0 }, { x: 3, y: 0.4 })).toEqual({ x: 3, y: 0 })
    expect(orthoLock({ x: 1, y: 1 }, { x: 1.4, y: -2 })).toEqual({ x: 1, y: -2 })
  })

  it("reports length and angle counter-clockwise from +X", () => {
    expect(lengthAngle({ x: 0, y: 0 }, { x: 0, y: -2 })).toEqual({ length: 2, angleDeg: 270 })
    expect(lengthAngle({ x: 1, y: 1 }, { x: 4, y: 5 }).length).toBe(5)
  })

  it("places the typed rectangle corner toward the cursor", () => {
    expect(rectangleCorner({ x: 1, y: 1 }, { x: 0, y: 2 }, 4.8, 3.8)).toEqual({ x: 1 - 4.8, y: 1 + 3.8 })
    expect(rectangleCorner({ x: 1, y: 1 }, { x: 1, y: 1 }, 4.8, 3.8)).toEqual({ x: 1 + 4.8, y: 1 + 3.8 })
  })

  it("follows the wall with live distances to the inner corners", () => {
    const ghost = openingGhost(level(), "w1", { x: 1.6, y: 0.05 }, 0.9)
    expect(ghost?.end).toBe("a")
    expect(ghost?.swingSide).toBe("positive")
    expect(ghost?.distStart).toBeCloseTo(1.05, 9)
    expect(ghost?.distEnd).toBeCloseTo(2.85, 9)
    const clamped = openingGhost(level(), "w1", { x: 0.2, y: -0.05 }, 0.9)
    expect(clamped?.distStart).toBeCloseTo(0, 9)
    expect(clamped?.swingSide).toBe("negative")
    const far = openingGhost(level(), "w1", { x: 4.2, y: 0 }, 0.9)
    expect(far?.end).toBe("b")
  })

  it("finds vertices and opening edges for the dimension tool", () => {
    expect(dimensionRefAt(level(), { x: 2.06, y: 0.01 }, 0.1)?.ref).toEqual({ type: "opening", id: "o1", edge: "start" })
    expect(dimensionRefAt(level(), { x: 0.02, y: 0.03 }, 0.1)?.ref).toEqual({ type: "vertex", id: "v1" })
    expect(dimensionRefAt(level(), { x: 1, y: 2 }, 0.1)).toBeNull()
  })

  it("measures the dimension offset along the left normal", () => {
    expect(dimensionOffset({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 2, y: -0.6 })).toBeCloseTo(-0.6, 12)
  })
})
