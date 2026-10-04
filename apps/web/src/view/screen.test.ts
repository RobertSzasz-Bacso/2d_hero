import { describe, expect, it } from "vitest"
import { pxPerPaperMm, screenStrokePx, screenTextPx } from "./screen.ts"

describe("screen view weights", () => {
  it("draws a 0.50 mm cut line at 1:50 and 100 px/m as 2.5 px", () => {
    expect(pxPerPaperMm(100, 50)).toBeCloseTo(5, 9)
    expect(screenStrokePx(0.5, 100, 50)).toBeCloseTo(2.5, 9)
  })

  it("clamps a 0.13 mm line at 1:50 and 20 px/m to 1 px", () => {
    expect(screenStrokePx(0.13, 20, 50)).toBe(1)
  })

  it("draws a 5 mm room name at 1:50 and 100 px/m as 25 px", () => {
    expect(screenTextPx(5, 100, 50)).toBeCloseTo(25, 9)
  })

  it("clamps 2.5 mm dimension text at 1:50 and 20 px/m to 10 px", () => {
    expect(screenTextPx(2.5, 20, 50)).toBe(10)
  })
})
