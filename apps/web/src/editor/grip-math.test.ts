import { describe, expect, it } from "vitest"
import { faceDragThickness, rotationFromGrip } from "./grip-math.ts"

describe("grip math", () => {
  it("fixture rotation from the grip without Shift is a multiple of 15°", () => {
    const center = { x: 1, y: 1 }
    for (const cursor of [
      { x: 1.3, y: 2 },
      { x: -0.4, y: 1.7 },
      { x: 2.2, y: 0.1 },
      { x: 0.93, y: -3 },
    ]) {
      const angle = rotationFromGrip(center, cursor, false)
      expect(Math.abs(angle / 15 - Math.round(angle / 15))).toBeLessThan(1e-9)
    }
  })

  it("Shift rotates freely, and the back points at the cursor", () => {
    const angle = rotationFromGrip({ x: 0, y: 0 }, { x: -1, y: 1 }, true)
    expect(angle).toBeCloseTo(45, 9)
  })

  it("a face grip sets thickness from the kept face to the cursor", () => {
    const frame = { a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, dir: { x: 1, y: 0 }, normal: { x: 0, y: 1 }, length: 5, thickness: 0.2 }
    expect(faceDragThickness(frame, { x: 2, y: -0.25 }, "right", false)).toEqual({ thickness: 0.35, keep: "left" })
    expect(faceDragThickness(frame, { x: 2, y: 0.2 }, "left", false)).toEqual({ thickness: 0.3, keep: "right" })
    expect(faceDragThickness(frame, { x: 2, y: 0.2 }, "left", true)).toEqual({ thickness: 0.4, keep: "center" })
  })
})
