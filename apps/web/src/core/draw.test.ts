import { describe, expect, it } from "vitest"
import { applyTypedDimension } from "./ops.ts"
import { addFixture, addOpeningOnWall, addRoomSeed, addStair, addColumn, addTypedWall, ensureDrawingLevel, mergeCollinearWall, metresFromDisplay, splitWall } from "./draw.ts"
import type { Plan } from "./plan-types.ts"
import { editorTolerances } from "./tolerances.ts"
import { extractRooms } from "./rooms.ts"

function emptyPlan(): Plan {
  return ensureDrawingLevel({
    schemaVersion: 2,
    units: "m",
    revision: 0,
    project: { name: "Draw", address: "", northAngleDeg: 0 },
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
    levels: [],
  })
}

function rectangle(): Plan {
  let plan = emptyPlan()
  plan = addTypedWall(plan, "L1", { x: 0, y: 0 }, 5, 0)
  plan = addTypedWall(plan, "L1", { x: 5, y: 0 }, 4, 90)
  plan = addTypedWall(plan, "L1", { x: 5, y: 4 }, 5, 180)
  plan = addTypedWall(plan, "L1", { x: 0, y: 4 }, 4, 270)
  return plan
}

function wallEnds(plan: Plan, wallId: string) {
  const level = plan.levels[0]
  const wall = level?.walls.find((item) => item.id === wallId)
  const a = level?.vertices.find((vertex) => vertex.id === wall?.a)
  const b = level?.vertices.find((vertex) => vertex.id === wall?.b)
  if (!level || !wall || !a || !b) {
    throw new Error(`missing wall ${wallId}`)
  }
  return { a, b }
}

describe("drawing tools", () => {
  it("places a typed wall of 3.250 m at 90 degrees within 1 mm", () => {
    const plan = addTypedWall(emptyPlan(), "L1", { x: 1, y: 2 }, 3.25, 90)
    const level = plan.levels[0]
    const wall = level?.walls[0]
    const a = level?.vertices.find((vertex) => vertex.id === wall?.a)
    const b = level?.vertices.find((vertex) => vertex.id === wall?.b)
    expect(a && b).toBeTruthy()
    if (!a || !b) {
      return
    }
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    expect(Math.abs(length - 3.25)).toBeLessThanOrEqual(0.001)
    expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(0.001)
    expect(Math.abs(b.y - a.y - 3.25)).toBeLessThanOrEqual(0.001)
  })

  it("typing 420 cm moves the segment to 4.20 m and keeps the neighbor orthogonal", () => {
    const metres = metresFromDisplay(420, "cm")
    expect(metres).toBe(4.2)
    const plan = rectangle()
    const next = applyTypedDimension(plan, "L1", {
      a: { type: "vertex", id: "v1" },
      b: { type: "vertex", id: "v2" },
      lengthM: metres,
    })
    const south = wallEnds(next, "w1")
    const east = wallEnds(next, "w2")
    expect(Math.abs(Math.hypot(south.b.x - south.a.x, south.b.y - south.a.y) - 4.2)).toBeLessThanOrEqual(0.001)
    const southAngle = (Math.atan2(south.b.y - south.a.y, south.b.x - south.a.x) * 180) / Math.PI
    const eastAngle = (Math.atan2(east.b.y - east.a.y, east.b.x - east.a.x) * 180) / Math.PI
    const delta = Math.abs(eastAngle - southAngle) % 180
    expect(Math.abs(Math.min(delta, 180 - delta) - 90)).toBeLessThanOrEqual(editorTolerances.ortho_deg)
  })

  it("split then merge returns the same wall count", () => {
    const plan = rectangle()
    const before = plan.levels[0]?.walls.length ?? 0
    const split = splitWall(plan, "L1", "w1", 0.5)
    expect(split.levels[0]?.walls).toHaveLength(before + 1)
    const merged = mergeCollinearWall(split, "L1", "w1")
    expect(merged.levels[0]?.walls).toHaveLength(before)
  })

  it("builds a plan of walls, a door, a room, a column, a stair, and a fixture that reloads", () => {
    let plan = rectangle()
    plan = addOpeningOnWall(plan, "L1", "w1", "door", 0.5, 0.9)
    plan = addRoomSeed(plan, "L1", { x: 2.5, y: 2 }, "Kitchen", "01")
    plan = addColumn(plan, "L1", { x: 1, y: 1 })
    plan = addStair(plan, "L1", { x: 3, y: 2 })
    plan = addFixture(plan, "L1", "toilet", { x: 4, y: 1 })
    const reloaded = JSON.parse(JSON.stringify(plan)) as Plan
    expect(reloaded).toEqual(plan)
    const rooms = extractRooms(reloaded, "L1")
    expect(rooms.rooms[0]?.name).toBe("Kitchen")
    expect(Math.abs((rooms.rooms[0]?.area ?? 0) - 18.24)).toBeLessThanOrEqual(0.005)
    expect(reloaded.levels[0]?.openings[0]?.kind).toBe("door")
    expect(reloaded.levels[0]?.columns).toHaveLength(1)
    expect(reloaded.levels[0]?.stairs).toHaveLength(1)
    expect(reloaded.levels[0]?.fixtures[0]?.symbol).toBe("toilet")
  })
})
