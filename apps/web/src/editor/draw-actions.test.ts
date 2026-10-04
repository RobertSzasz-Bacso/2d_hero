import { describe, expect, it } from "vitest"
import type { Plan } from "@/core/plan-types.ts"
import { extractRooms } from "@/core/rooms.ts"
import { extendWallTo, startWall, type WallChain } from "./draw-actions.ts"

function empty(): Plan {
  return {
    schemaVersion: 2,
    units: "m",
    revision: 0,
    project: { name: "Chain", address: "", northAngleDeg: 0 },
    sheet: {
      paper: "A3",
      orientation: "landscape",
      scale: 50,
      titleBlock: { company: "", project: "", address: "", drawnBy: "", date: "", sheetTitle: "", sheetNumber: "", revisionNote: "" },
    },
    detection: { source: null, issues: [] },
    levels: [],
  }
}

function draw(location: "center" | "left" | "right") {
  const faces = [
    { x: 5, y: 0 },
    { x: 5, y: 4 },
    { x: 0, y: 4 },
    { x: 0, y: 0 },
  ]
  const started = startWall(empty(), { x: 0, y: 0 })
  let plan = started.plan
  let chain: WallChain | null = started.chain
  for (const face of faces) {
    if (!chain) {
      throw new Error("the chain closed early")
    }
    const drawn = extendWallTo(plan, chain, face, 0.2, location)
    plan = drawn.plan
    chain = drawn.chain
  }
  return { plan, chain }
}

describe("wall chain with a location line", () => {
  it("draws the left face counter-clockwise, so the clicked box is the clear room", () => {
    const { plan, chain } = draw("left")
    expect(chain).toBeNull()
    const level = plan.levels[0]
    expect(level?.walls).toHaveLength(4)
    const xs = (level?.vertices ?? []).map((vertex) => vertex.x).sort((a, b) => a - b)
    const ys = (level?.vertices ?? []).map((vertex) => vertex.y).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(-0.1, 9)
    expect(xs[3]).toBeCloseTo(5.1, 9)
    expect(ys[0]).toBeCloseTo(-0.1, 9)
    expect(ys[3]).toBeCloseTo(4.1, 9)
    const rooms = extractRooms(plan, level?.id ?? "")
    expect(rooms.rooms).toHaveLength(1)
    expect(Math.abs((rooms.rooms[0]?.area ?? 0) - 20)).toBeLessThanOrEqual(0.01)
  })

  it("keeps the clicked points on the centerline in centre mode", () => {
    const { plan } = draw("center")
    const level = plan.levels[0]
    expect(level?.vertices.map((vertex) => [vertex.x, vertex.y])).toEqual([
      [0, 0],
      [5, 0],
      [5, 4],
      [0, 4],
    ])
    expect(Math.abs((extractRooms(plan, level?.id ?? "").rooms[0]?.area ?? 0) - 18.24)).toBeLessThanOrEqual(0.01)
  })

  it("draws the right face counter-clockwise, so the clicked box is the outside", () => {
    const { plan } = draw("right")
    expect(plan.levels[0]?.walls.every((wall) => wall.thickness === 0.2)).toBe(true)
    const rooms = extractRooms(plan, plan.levels[0]?.id ?? "")
    expect(Math.abs((rooms.rooms[0]?.area ?? 0) - 4.6 * 3.6)).toBeLessThanOrEqual(0.01)
  })
})
