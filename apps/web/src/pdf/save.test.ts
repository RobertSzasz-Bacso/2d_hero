import { describe, expect, it } from "vitest"
import { describePdfError } from "./save.ts"

describe("pdf save errors", () => {
  it("tells a person to close a locked PDF", () => {
    const locked = new DOMException(
      "The process cannot access the file because it is being used by another process.",
      "NoModificationAllowedError",
    )
    const message = describePdfError(locked)
    expect(message).toBe("That PDF is open in another program. Close it, then export again.")
    expect(message).not.toContain("NoModificationAllowedError")
    expect(message).not.toContain("Traceback")
  })

  it("does not treat a cancelled save dialog as a failure", () => {
    expect(describePdfError(new DOMException("The user aborted a request.", "AbortError"))).toBe("")
  })
})
