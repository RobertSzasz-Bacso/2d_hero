import { afterEach, describe, expect, it, vi } from "vitest"
import { describePdfError, savePdf } from "./save.ts"

afterEach(() => {
  vi.unstubAllGlobals()
})

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

describe("savePdf inside another site's iframe", () => {
  it("falls back to a normal download when the save dialog is blocked", async () => {
    const link = { href: "", download: "", click: vi.fn() }
    vi.stubGlobal("showSaveFilePicker", () => Promise.reject(new DOMException("blocked", "SecurityError")))
    vi.stubGlobal("document", { createElement: () => link })
    vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() })

    await savePdf(new Uint8Array([37, 80, 68, 70, 45]), "Plan.pdf")

    expect(link.download).toBe("Plan.pdf")
    expect(link.click).toHaveBeenCalledOnce()
  })

  it("still lets a cancelled dialog through as an abort", async () => {
    vi.stubGlobal("showSaveFilePicker", () => Promise.reject(new DOMException("cancelled", "AbortError")))

    await expect(savePdf(new Uint8Array([1]), "Plan.pdf")).rejects.toMatchObject({ name: "AbortError" })
  })
})
