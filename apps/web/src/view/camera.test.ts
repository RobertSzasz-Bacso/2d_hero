import { describe, expect, it } from "vitest"
import { planToScreen, screenToPlan, zoomAtCursor } from "./camera.ts"

describe("camera", () => {
  it("keeps the plan point under the cursor when zooming", () => {
    const camera = { pixelsPerMeter: 50, originX: 100, originY: 80 }
    const cursor = { x: 240, y: 30 }
    const before = screenToPlan(camera, cursor)
    const zoomed = zoomAtCursor(camera, cursor, 2)
    const after = screenToPlan(zoomed, cursor)
    expect(after.x).toBe(before.x)
    expect(after.y).toBe(before.y)
    expect(zoomed.pixelsPerMeter).toBe(100)
    const screen = planToScreen(zoomed, before)
    expect(screen.x).toBe(cursor.x)
    expect(screen.y).toBe(cursor.y)
  })

  it("maps plan north upward on screen", () => {
    const camera = { pixelsPerMeter: 10, originX: 0, originY: 100 }
    const south = planToScreen(camera, { x: 0, y: 0 })
    const north = planToScreen(camera, { x: 0, y: 5 })
    expect(north.y).toBeLessThan(south.y)
  })
})
