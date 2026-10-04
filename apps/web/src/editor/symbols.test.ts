import { describe, expect, it } from "vitest"
import type { Fixture } from "@/core/plan-types.ts"
import { SYMBOLS, symbolPolylines } from "./symbols.ts"

const PARTS: Record<Fixture["symbol"], number> = {
  toilet: 3,
  sink: 3,
  bathtub: 3,
  shower: 5,
  "kitchen-counter": 2,
  stove: 9,
  "bed-double": 5,
  sofa: 6,
  table: 2,
  wardrobe: 6,
  block: 1,
  chair: 2,
}

describe("symbols", () => {
  it("lists the twelve ids from the drawing standard", () => {
    expect([...SYMBOLS].sort()).toEqual(Object.keys(PARTS).sort())
  })

  for (const symbol of Object.keys(PARTS) as Fixture["symbol"][]) {
    it(`${symbol} has ${PARTS[symbol]} parts inside the unit square`, () => {
      const parts = symbolPolylines(symbol)
      expect(parts.length).toBe(PARTS[symbol])
      for (const part of parts) {
        expect(part.length).toBeGreaterThanOrEqual(2)
        for (const point of part) {
          expect(Math.abs(point.x)).toBeLessThanOrEqual(0.5 + 1e-9)
          expect(Math.abs(point.y)).toBeLessThanOrEqual(0.5 + 1e-9)
        }
      }
    })
  }
})
