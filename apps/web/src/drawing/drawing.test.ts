import { inflateSync } from "node:zlib"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib"
import { describe, expect, it } from "vitest"
import type { Plan, Point } from "@/core/plan-types.ts"
import { compilePlan, type DrawCommand } from "./compile.ts"
import { renderSvg } from "./svg.ts"
import { writePdf } from "@/pdf/write.ts"

const goldenDir = path.dirname(fileURLToPath(import.meta.url))

function emptyLevel(length: number): Plan["levels"][number] {
  return {
    id: "L1",
    name: "Ground",
    elevation: 0,
    ceilingHeight: 2.7,
    vertices: [
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: length, y: 0 },
    ],
    walls: [{ id: "w1", a: "v1", b: "v2", thickness: 0.2, kind: "exterior", confidence: 1 }],
    openings: [],
    columns: [],
    stairs: [],
    rooms: [],
    separators: [],
    fixtures: [],
    texts: [],
    dimensions: [],
    suppressedAutoDimensions: [],
  }
}

function plan(level: Plan["levels"][number], scale: 50 | 100 | 200 = 50): Plan {
  return {
    schemaVersion: 2,
    units: "m",
    revision: 0,
    project: { name: "Golden", address: "", northAngleDeg: 0 },
    sheet: {
      paper: "A3",
      orientation: "landscape",
      scale,
      titleBlock: {
        company: "",
        project: "Golden",
        address: "",
        drawnBy: "",
        date: "",
        sheetTitle: "Ground floor",
        sheetNumber: "01",
        revisionNote: "",
      },
    },
    detection: { source: null, issues: [] },
    levels: [level],
  }
}

function edgeLengths(points: readonly Point[], closed: boolean): number[] {
  const lengths: number[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]
    const b = points[index + 1]
    if (!a || !b) {
      continue
    }
    lengths.push(Math.hypot(b.x - a.x, b.y - a.y))
  }
  if (closed && points.length > 1) {
    const first = points[0]
    const last = points[points.length - 1]
    if (first && last) {
      lengths.push(Math.hypot(first.x - last.x, first.y - last.y))
    }
  }
  return lengths
}

function twoRoomPlan(): Plan {
  const level = emptyLevel(10)
  level.vertices = [
    { id: "v1", x: 0, y: 0 },
    { id: "v2", x: 5, y: 0 },
    { id: "v3", x: 10, y: 0 },
    { id: "v4", x: 10, y: 4 },
    { id: "v5", x: 5, y: 4 },
    { id: "v6", x: 0, y: 4 },
  ]
  level.walls = [
    { id: "w1", a: "v1", b: "v2", thickness: 0.2, kind: "exterior", confidence: 1 },
    { id: "w2", a: "v2", b: "v3", thickness: 0.2, kind: "exterior", confidence: 1 },
    { id: "w3", a: "v3", b: "v4", thickness: 0.2, kind: "exterior", confidence: 1 },
    { id: "w4", a: "v4", b: "v5", thickness: 0.2, kind: "exterior", confidence: 1 },
    { id: "w5", a: "v5", b: "v6", thickness: 0.2, kind: "exterior", confidence: 1 },
    { id: "w6", a: "v6", b: "v1", thickness: 0.2, kind: "exterior", confidence: 1 },
    { id: "w7", a: "v2", b: "v5", thickness: 0.2, kind: "partition", confidence: 1 },
  ]
  level.openings = [
    {
      id: "o1",
      wall: "w1",
      kind: "door",
      offset: 0.5,
      width: 0.9,
      sill: 0,
      head: 2.1,
      swing: "left",
      swingSide: "positive",
      confidence: 1,
    },
  ]
  level.rooms = [
    { id: "r1", name: "Living", number: "01", seed: { x: 2.5, y: 2 } },
    { id: "r2", name: "Kitchen", number: "02", seed: { x: 7.5, y: 2 } },
  ]
  level.dimensions = [
    {
      id: "d1",
      auto: false,
      offset: 0.6,
      segments: [{ a: { type: "vertex", id: "v1" }, b: { type: "vertex", id: "v2" } }],
    },
  ]
  return plan(level)
}

describe("drawing compiler", () => {
  it("draws a 10.00 m wall as 200 mm at 1:50 with a 0.50 mm cut stroke", () => {
    const compiled = compilePlan(plan(emptyLevel(10)))
    const sheet = compiled.sheets[0]
    expect(sheet).toBeDefined()
    const cuts = sheet?.commands.filter((command): command is Extract<DrawCommand, { op: "stroke" }> => {
      return command.op === "stroke" && command.role === "cut-wall"
    })
    expect(cuts?.length).toBeGreaterThan(0)
    expect(cuts?.every((command) => command.strokeMm === 0.5)).toBe(true)
    const longest = Math.max(...(cuts ?? []).flatMap((command) => edgeLengths(command.points, command.closed === true)))
    expect(Math.abs(longest - 200)).toBeLessThanOrEqual(0.5)
  })

  it("displays a 4.20 m dimension as 420", () => {
    const level = emptyLevel(4.2)
    level.dimensions = [
      {
        id: "d1",
        auto: false,
        offset: 0.4,
        segments: [{ a: { type: "vertex", id: "v1" }, b: { type: "vertex", id: "v2" } }],
      },
    ]
    const compiled = compilePlan(plan(level))
    const labels = compiled.sheets[0]?.commands.filter((command) => command.op === "text").map((command) => command.text)
    expect(labels).toContain("420")
  })

  it("matches the golden two-room SVG", () => {
    const compiled = compilePlan(twoRoomPlan())
    const sheet = compiled.sheets[0]
    expect(sheet).toBeDefined()
    if (!sheet) {
      return
    }
    const svg = renderSvg(sheet)
    expect(svg).not.toContain("fill-opacity")
    const golden = path.join(goldenDir, "golden", "two-room.svg")
    if (process.env.UPDATE_SVG === "1") {
      mkdirSync(path.dirname(golden), { recursive: true })
      writeFileSync(golden, svg)
    }
    const expected = readFileSync(golden, "utf8")
    expect(svg).toBe(expected)
  })

  it("writes an A3 landscape vector PDF", async () => {
    const bytes = await writePdf(compilePlan(twoRoomPlan()))
    const doc = await PDFDocument.load(bytes)
    const page = doc.getPages()[0]
    expect(page).toBeDefined()
    if (!page) {
      return
    }
    const size = page.getSize()
    const widthMm = (size.width * 25.4) / 72
    const heightMm = (size.height * 25.4) / 72
    expect(Math.abs(widthMm - 420)).toBeLessThanOrEqual(1)
    expect(Math.abs(heightMm - 297)).toBeLessThanOrEqual(1)

    const latin = Buffer.from(bytes).toString("latin1")
    expect(latin.includes("/Subtype /Image") || latin.includes("/Subtype/Image")).toBe(false)
    expect(latin).not.toMatch(/\/ca\s+0?\.35/)

    const content = pageContent(doc)
    expect(content).toMatch(/(^|\s)m(\s|$)/)
    expect(content).toMatch(/(^|\s)l(\s|$)/)
    expect(content).toMatch(/(^|\s)(S|f|B)(\s|$)/)
  })
})

function pageContent(doc: PDFDocument): string {
  const page = doc.getPages()[0]
  if (!page) {
    return ""
  }
  const entry = page.node.get(PDFName.of("Contents"))
  const refs: PDFRef[] = []
  if (entry instanceof PDFRef) {
    refs.push(entry)
  } else if (entry instanceof PDFArray) {
    for (let index = 0; index < entry.size(); index += 1) {
      const item = entry.get(index)
      if (item instanceof PDFRef) {
        refs.push(item)
      }
    }
  }
  const parts: string[] = []
  for (const ref of refs) {
    const stream = doc.context.lookup(ref)
    if (!(stream instanceof PDFRawStream)) {
      continue
    }
    const filter = stream.dict.lookup(PDFName.of("Filter"))
    const filterName = filter ? filter.toString() : ""
    const raw = Buffer.from(stream.contents)
    const decoded = filterName.includes("FlateDecode") ? inflateSync(raw) : raw
    parts.push(Buffer.from(decoded).toString("latin1"))
  }
  return parts.join("\n")
}
