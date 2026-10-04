import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { intersection } from "polygon-clipping"
import { describe, expect, it } from "vitest"
import type { Plan, Point } from "./plan-types.ts"
import { addTypedWall, mergeCollinearWall, splitWall } from "./draw.ts"
import {
  applyTypedDimension,
  moveVertex,
  moveWall,
  removeSelection,
  setFixtureRotation,
  setOpening,
  setRoomName,
  setTextContent,
  setWallThickness,
} from "./ops.ts"
import {
  moveSelection,
  rehostOpening,
  setClearDistance,
  setOpeningEdge,
  setWallThicknessFromFace,
  snapFixtureToWall,
  snapRotation,
  type SelectionKind,
} from "./grips.ts"
import { pickAt } from "./pick.ts"
import { extractRooms } from "./rooms.ts"
import { snapPoint } from "./snap.ts"
import { editorTolerances } from "./tolerances.ts"
import { maxJoinSpikeM, wallPolygons, type WallPolygon } from "./wall-polygons.ts"

type VectorCase = {
  name: string
  op: string
  input: {
    plan: Plan
    levelId: string
    wallId?: string
    delta?: Point
    lengthM?: number
    a?: { type: "vertex"; id: string }
    b?: { type: "vertex"; id: string }
    thickness?: number
    roomId?: string
    name?: string
    number?: string
    openingId?: string
    opening?: { width?: number; swing?: "left" | "right" | "double" | "sliding" | "none" }
    vertexId?: string
    point?: Point
    cursor?: Point
    pixelsPerMeter?: number
    gridM?: number
    previous?: { x: number; y: number; dirX: number; dirY: number }
    toleranceM?: number
    ids?: string[]
    fixtureId?: string
    rotationDeg?: number
    textId?: string
    text?: string
    angleDeg?: number
    t?: number
    keep?: "left" | "right" | "center"
    otherId?: string
    distance?: number
    edge?: "start" | "end"
    amountM?: number
    items?: { kind: SelectionKind; id: string }[]
    free?: boolean
  }
  expect: {
    areas?: { id: string; area: number }[]
    areaTolerance?: number
    grossCenterlineArea?: number
    issueCodes?: string[]
    enclosedRoom?: boolean
    seedInside?: string[]
    closed?: boolean
    maxSpikeFactor?: number
    outerCorner?: Point
    buttId?: string
    hostId?: string
    vertices?: Record<string, Point>
    orthogonalWalls?: string[]
    kind?: string
    id?: string
    point?: Point
    wallId?: string
    thickness?: number
    roomId?: string
    name?: string
    number?: string
    openingId?: string
    width?: number
    swing?: string
    vertexId?: string
    firstKind?: string
    firstId?: string
    wallCount?: number
    rotationDeg?: number
    text?: string
    error?: boolean
    unchanged?: boolean
    wallThickness?: { wallId: string; thickness: number }
    clear?: { wallId: string; otherId: string; distance: number; tolerance: number }
    opening?: { id: string; wall: string; width: number; tolerance: number; startEdge?: Point; center?: Point }
    fixture?: { id: string; x: number; y: number; rotationDeg: number; tolerance: number }
  }
}

const gripOps: Record<string, (vector: VectorCase) => Plan> = {
  setWallThicknessFromFace: (v) => setWallThicknessFromFace(v.input.plan, v.input.levelId, v.input.wallId ?? "", v.input.thickness ?? 0, v.input.keep ?? "center"),
  setClearDistance: (v) => setClearDistance(v.input.plan, v.input.levelId, v.input.wallId ?? "", v.input.otherId ?? "", v.input.distance ?? 0),
  setOpeningEdge: (v) => setOpeningEdge(v.input.plan, v.input.levelId, v.input.openingId ?? "", v.input.edge ?? "end", v.input.amountM ?? 0),
  rehostOpening: (v) => rehostOpening(v.input.plan, v.input.levelId, v.input.openingId ?? "", v.input.wallId ?? "", v.input.point ?? { x: 0, y: 0 }),
  moveSelection: (v) => moveSelection(v.input.plan, v.input.levelId, v.input.items ?? [], v.input.delta ?? { x: 0, y: 0 }),
  snapFixtureToWall: (v) => snapFixtureToWall(v.input.plan, v.input.levelId, v.input.fixtureId ?? "", v.input.toleranceM ?? 0),
}

function assertGrip(vector: VectorCase) {
  const before = JSON.stringify(vector.input.plan)
  const run = gripOps[vector.op]
  if (!run) {
    throw new Error(`unknown grip op ${vector.op}`)
  }
  if (vector.expect.error) {
    expect(() => run(vector)).toThrow()
    if (vector.expect.unchanged) {
      expect(JSON.stringify(vector.input.plan)).toBe(before)
    }
    return
  }
  const next = run(vector)
  expect(JSON.stringify(vector.input.plan)).toBe(before)
  const level = levelOf(next, vector.input.levelId)
  if (vector.expect.areas) {
    assertAreas(
      vector,
      extractRooms(next, vector.input.levelId).rooms.map((room) => ({ id: room.id, area: room.area })),
    )
  }
  if (vector.expect.wallThickness) {
    const wall = level.walls.find((item) => item.id === vector.expect.wallThickness?.wallId)
    expect(wall?.thickness).toBe(vector.expect.wallThickness.thickness)
  }
  if (vector.expect.clear) {
    const { wallId, otherId, distance, tolerance } = vector.expect.clear
    expect(Math.abs(clearBetween(next, vector.input.levelId, wallId, otherId) - distance)).toBeLessThanOrEqual(tolerance)
  }
  if (vector.expect.opening) {
    const expected = vector.expect.opening
    const opening = level.openings.find((item) => item.id === expected.id)
    expect(opening?.wall).toBe(expected.wall)
    expect(Math.abs((opening?.width ?? 0) - expected.width)).toBeLessThanOrEqual(expected.tolerance)
    const ends = openingEdges(next, vector.input.levelId, expected.id)
    if (expected.startEdge) {
      expect(Math.hypot(ends.start.x - expected.startEdge.x, ends.start.y - expected.startEdge.y)).toBeLessThanOrEqual(expected.tolerance)
    }
    if (expected.center) {
      expect(Math.hypot(ends.center.x - expected.center.x, ends.center.y - expected.center.y)).toBeLessThanOrEqual(expected.tolerance)
    }
  }
  if (vector.expect.fixture) {
    const expected = vector.expect.fixture
    const fixture = level.fixtures.find((item) => item.id === expected.id)
    expect(Math.abs((fixture?.x ?? Number.NaN) - expected.x)).toBeLessThanOrEqual(expected.tolerance)
    expect(Math.abs((fixture?.y ?? Number.NaN) - expected.y)).toBeLessThanOrEqual(expected.tolerance)
    expect(Math.abs((fixture?.rotationDeg ?? Number.NaN) - expected.rotationDeg)).toBeLessThanOrEqual(expected.tolerance)
  }
  assertMoved(vector, next)
}

function clearBetween(plan: Plan, levelId: string, wallId: string, otherId: string): number {
  const level = levelOf(plan, levelId)
  const verts = vertexMap(plan, levelId)
  const wall = level.walls.find((item) => item.id === wallId)
  const other = level.walls.find((item) => item.id === otherId)
  const a = verts.get(wall?.a ?? "")
  const b = verts.get(wall?.b ?? "")
  const c = verts.get(other?.a ?? "")
  if (!wall || !other || !a || !b || !c) {
    throw new Error("missing walls for clear distance")
  }
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length }
  const d = (c.x - a.x) * normal.x + (c.y - a.y) * normal.y
  return Math.abs(d) - wall.thickness / 2 - other.thickness / 2
}

function openingEdges(plan: Plan, levelId: string, openingId: string): { start: Point; center: Point } {
  const level = levelOf(plan, levelId)
  const verts = vertexMap(plan, levelId)
  const opening = level.openings.find((item) => item.id === openingId)
  const wall = level.walls.find((item) => item.id === opening?.wall)
  const a = verts.get(wall?.a ?? "")
  const b = verts.get(wall?.b ?? "")
  if (!opening || !a || !b) {
    throw new Error("missing opening")
  }
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
  const center = { x: a.x + (b.x - a.x) * opening.offset, y: a.y + (b.y - a.y) * opening.offset }
  return { start: { x: center.x - (along.x * opening.width) / 2, y: center.y - (along.y * opening.width) / 2 }, center }
}

const vectorDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../shared/vectors")

function loadVectors(): VectorCase[] {
  return readdirSync(vectorDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(vectorDir, name), "utf8")) as VectorCase)
}

function levelOf(plan: Plan, levelId: string) {
  const level = plan.levels.find((item) => item.id === levelId)
  if (!level) {
    throw new Error(`missing level ${levelId}`)
  }
  return level
}

function vertexMap(plan: Plan, levelId: string) {
  return new Map(levelOf(plan, levelId).vertices.map((vertex) => [vertex.id, vertex]))
}

function wallAngleDeg(plan: Plan, levelId: string, wallId: string): number {
  const level = levelOf(plan, levelId)
  const wall = level.walls.find((item) => item.id === wallId)
  if (!wall) {
    throw new Error(`missing wall ${wallId}`)
  }
  const verts = vertexMap(plan, levelId)
  const a = verts.get(wall.a)
  const b = verts.get(wall.b)
  if (!a || !b) {
    throw new Error(`missing wall vertices ${wallId}`)
  }
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

function angleDelta(a: number, b: number): number {
  const raw = Math.abs(a - b) % 180
  return Math.min(raw, 180 - raw)
}

function assertAreas(vector: VectorCase, areas: { id: string; area: number }[]) {
  const expected = vector.expect.areas ?? []
  const tolerance = 0.01
  expect(vector.expect.areaTolerance).toBe(tolerance)
  expect(areas).toHaveLength(expected.length)
  for (const item of expected) {
    const found = areas.find((area) => area.id === item.id)
    expect(found, item.id).toBeDefined()
    expect(Math.abs((found?.area ?? 0) - item.area)).toBeLessThanOrEqual(tolerance)
    if (vector.expect.grossCenterlineArea !== undefined) {
      expect(Math.abs((found?.area ?? 0) - vector.expect.grossCenterlineArea)).toBeGreaterThan(tolerance)
    }
  }
}

function assertRooms(vector: VectorCase) {
  const result = extractRooms(vector.input.plan, vector.input.levelId)
  assertAreas(
    vector,
    result.rooms.map((room) => ({ id: room.id, area: room.area })),
  )
  const codes = result.issues.map((issue) => issue.code).sort()
  expect(codes).toEqual([...(vector.expect.issueCodes ?? [])].sort())
  if (vector.expect.enclosedRoom !== undefined) {
    expect(result.rooms.length > 0).toBe(vector.expect.enclosedRoom)
  }
  for (const id of vector.expect.seedInside ?? []) {
    const room = result.rooms.find((item) => item.id === id)
    expect(room, id).toBeDefined()
    expect(pointInRing(room?.seed ?? { x: 0, y: 0 }, room?.polygon ?? [])).toBe(true)
  }
}

function pointInRing(point: Point, ring: Point[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (!a || !b) {
      continue
    }
    const crosses = a.y > point.y !== b.y > point.y
    const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (crosses && point.x < x) {
      inside = !inside
    }
  }
  return inside
}

function assertPolygons(vector: VectorCase) {
  const polys = wallPolygons(vector.input.plan, vector.input.levelId)
  expect(polys.length).toBeGreaterThan(0)
  for (const poly of polys) {
    expect(poly.ring.length).toBeGreaterThanOrEqual(3)
    expect(Math.abs(ringArea(poly.ring))).toBeGreaterThan(0)
    expect(selfIntersects(poly.ring)).toBe(false)
  }
  const spike = maxJoinSpikeM(vector.input.plan, vector.input.levelId, polys)
  const thickness = Math.max(...levelOf(vector.input.plan, vector.input.levelId).walls.map((wall) => wall.thickness))
  expect(spike).toBeLessThanOrEqual(editorTolerances.miter_limit * thickness)
  if (vector.expect.outerCorner) {
    const nearest = nearestVertex(polys, vector.expect.outerCorner)
    expect(nearest).toBeLessThanOrEqual(1e-6)
  }
  if (vector.expect.buttId && vector.expect.hostId) {
    const butt = polys.find((poly) => poly.wallId === vector.expect.buttId)
    const host = polys.find((poly) => poly.wallId === vector.expect.hostId)
    expect(butt).toBeDefined()
    expect(host).toBeDefined()
    expect(overlapArea(butt as WallPolygon, host as WallPolygon)).toBeLessThanOrEqual(1e-6)
    const hostWall = levelOf(vector.input.plan, vector.input.levelId).walls.find((wall) => wall.id === vector.expect.hostId)
    const verts = vertexMap(vector.input.plan, vector.input.levelId)
    const a = verts.get(hostWall?.a ?? "")
    const b = verts.get(hostWall?.b ?? "")
    expect(a && b).toBeTruthy()
    const face = (hostWall?.thickness ?? 0) / 2
    const clearances = (butt?.ring ?? []).map((point) => distanceToSegment(point, a as Point, b as Point))
    expect(Math.min(...clearances)).toBeGreaterThanOrEqual(face - 1e-6)
    expect(Math.min(...clearances)).toBeLessThanOrEqual(face + 1e-4)
  }
}

function ringArea(ring: Point[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (!a || !b) {
      continue
    }
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

function nearestVertex(polys: WallPolygon[], point: Point): number {
  let best = Number.POSITIVE_INFINITY
  for (const poly of polys) {
    for (const vertex of poly.ring) {
      const d = Math.hypot(vertex.x - point.x, vertex.y - point.y)
      if (d < best) {
        best = d
      }
    }
  }
  return best
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const acx = c.x - a.x
  const acy = c.y - a.y
  const adx = d.x - a.x
  const ady = d.y - a.y
  const cdx = d.x - c.x
  const cdy = d.y - c.y
  const cax = a.x - c.x
  const cay = a.y - c.y
  const cbx = b.x - c.x
  const cby = b.y - c.y
  const abac = abx * acy - aby * acx
  const abad = abx * ady - aby * adx
  const cdca = cdx * cay - cdy * cax
  const cdcb = cdx * cby - cdy * cbx
  return abac * abad < 0 && cdca * cdcb < 0
}

function selfIntersects(ring: Point[]): boolean {
  const n = ring.length
  for (let i = 0; i < n; i += 1) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    if (!a || !b) {
      continue
    }
    for (let j = i + 1; j < n; j += 1) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) {
        continue
      }
      const c = ring[j]
      const d = ring[(j + 1) % n]
      if (!c || !d) {
        continue
      }
      if (segmentsCross(a, b, c, d)) {
        return true
      }
    }
  }
  return false
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y)
  }
  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2))
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

function overlapArea(a: WallPolygon, b: WallPolygon): number {
  const hit = intersection(
    [a.ring.map((point) => [point.x, point.y])],
    [b.ring.map((point) => [point.x, point.y])],
  )
  let area = 0
  for (const polygon of hit) {
    const outer = polygon[0]
    if (!outer) {
      continue
    }
    area += Math.abs(ringArea(outer.map(([x, y]) => ({ x, y }))))
  }
  return area
}

function referenceAngle(vector: VectorCase): number | null {
  if (vector.input.wallId) {
    return wallAngleDeg(vector.input.plan, vector.input.levelId, vector.input.wallId)
  }
  if (vector.input.a?.id && vector.input.b?.id) {
    const verts = vertexMap(vector.input.plan, vector.input.levelId)
    const a = verts.get(vector.input.a.id)
    const b = verts.get(vector.input.b.id)
    if (!a || !b) {
      return null
    }
    return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  }
  return null
}

function assertMoved(vector: VectorCase, plan: Plan) {
  const verts = vertexMap(plan, vector.input.levelId)
  for (const [id, point] of Object.entries(vector.expect.vertices ?? {})) {
    const vertex = verts.get(id)
    expect(vertex, id).toBeDefined()
    expect(vertex?.x).toBe(point.x)
    expect(vertex?.y).toBe(point.y)
  }
  const base = referenceAngle(vector)
  if (base === null) {
    return
  }
  for (const wallId of vector.expect.orthogonalWalls ?? []) {
    const angle = wallAngleDeg(plan, vector.input.levelId, wallId)
    expect(Math.abs(angleDelta(base, angle) - 90)).toBeLessThanOrEqual(editorTolerances.ortho_deg)
  }
}

describe("shared vectors", () => {
  const vectors = loadVectors()

  it("loads every Phase 3 case", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(8)
    expect(vectors.map((item) => item.name)).toContain("rectangle-net-area")
  })

  for (const vector of vectors) {
    it(vector.name, () => {
      if (vector.op === "rooms") {
        assertRooms(vector)
        return
      }
      if (vector.op === "wallPolygons") {
        assertPolygons(vector)
        return
      }
      if (vector.op === "moveWall") {
        const next = moveWall(vector.input.plan, vector.input.levelId, vector.input.wallId ?? "", vector.input.delta ?? { x: 0, y: 0 })
        assertMoved(vector, next)
        return
      }
      if (vector.op === "typedDimension") {
        const next = applyTypedDimension(vector.input.plan, vector.input.levelId, {
          a: vector.input.a ?? { type: "vertex", id: "" },
          b: vector.input.b ?? { type: "vertex", id: "" },
          lengthM: vector.input.lengthM ?? 0,
        })
        assertMoved(vector, next)
        return
      }
      if (vector.op === "snap") {
        const hit = snapPoint({
          plan: vector.input.plan,
          levelId: vector.input.levelId,
          cursor: vector.input.cursor ?? { x: 0, y: 0 },
          pixelsPerMeter: vector.input.pixelsPerMeter ?? 1,
          gridM: vector.input.gridM,
          previous: vector.input.previous,
        })
        expect(hit?.kind).toBe(vector.expect.kind)
        if (vector.expect.id) {
          expect(hit?.id).toBe(vector.expect.id)
        }
        expect(hit?.point.x).toBe(vector.expect.point?.x)
        expect(hit?.point.y).toBe(vector.expect.point?.y)
        return
      }
      if (vector.op === "setWallThickness") {
        const next = setWallThickness(vector.input.plan, vector.input.levelId, vector.input.wallId ?? "", vector.input.thickness ?? 0)
        const wall = levelOf(next, vector.input.levelId).walls.find((item) => item.id === vector.expect.wallId)
        expect(wall?.thickness).toBe(vector.expect.thickness)
        return
      }
      if (vector.op === "setRoomName") {
        const next = setRoomName(
          vector.input.plan,
          vector.input.levelId,
          vector.input.roomId ?? "",
          vector.input.name ?? "",
          vector.input.number,
        )
        const room = levelOf(next, vector.input.levelId).rooms.find((item) => item.id === vector.expect.roomId)
        expect(room?.name).toBe(vector.expect.name)
        expect(room?.number).toBe(vector.expect.number)
        return
      }
      if (vector.op === "setOpening") {
        const next = setOpening(vector.input.plan, vector.input.levelId, vector.input.openingId ?? "", vector.input.opening ?? {})
        const opening = levelOf(next, vector.input.levelId).openings.find((item) => item.id === vector.expect.openingId)
        expect(opening?.width).toBe(vector.expect.width)
        expect(opening?.swing).toBe(vector.expect.swing)
        return
      }
      if (vector.op === "moveVertex") {
        const next = moveVertex(vector.input.plan, vector.input.levelId, vector.input.vertexId ?? "", vector.input.point ?? { x: 0, y: 0 })
        const vertex = vertexMap(next, vector.input.levelId).get(vector.expect.vertexId ?? "")
        expect(vertex?.x).toBe(vector.expect.point?.x)
        expect(vertex?.y).toBe(vector.expect.point?.y)
        return
      }
      if (vector.op === "pick") {
        const hits = pickAt(vector.input.plan, vector.input.levelId, vector.input.point ?? { x: 0, y: 0 }, vector.input.toleranceM ?? 0)
        expect(hits[0]?.kind).toBe(vector.expect.firstKind)
        expect(hits[0]?.id).toBe(vector.expect.firstId)
        return
      }
      if (vector.op === "removeSelection") {
        const next = removeSelection(vector.input.plan, vector.input.levelId, vector.input.ids ?? [])
        expect(levelOf(next, vector.input.levelId).walls).toHaveLength(vector.expect.wallCount ?? -1)
        return
      }
      if (vector.op === "setFixtureRotation") {
        const next = setFixtureRotation(
          vector.input.plan,
          vector.input.levelId,
          vector.input.fixtureId ?? "",
          vector.input.rotationDeg ?? 0,
        )
        const fixture = levelOf(next, vector.input.levelId).fixtures.find((item) => item.id === vector.input.fixtureId)
        expect(fixture?.rotationDeg).toBe(vector.expect.rotationDeg)
        return
      }
      if (vector.op === "typedWall") {
        const next = addTypedWall(
          vector.input.plan,
          vector.input.levelId,
          vector.input.point ?? { x: 0, y: 0 },
          vector.input.lengthM ?? 0,
          vector.input.angleDeg ?? 0,
        )
        const level = levelOf(next, vector.input.levelId)
        const wall = level.walls[level.walls.length - 1]
        const end = level.vertices.find((vertex) => vertex.id === wall?.b)
        expect(Math.abs((end?.x ?? 0) - (vector.expect.point?.x ?? 0))).toBeLessThanOrEqual(0.001)
        expect(Math.abs((end?.y ?? 0) - (vector.expect.point?.y ?? 0))).toBeLessThanOrEqual(0.001)
        return
      }
      if (vector.op === "splitMerge") {
        const before = levelOf(vector.input.plan, vector.input.levelId).walls.length
        const split = splitWall(vector.input.plan, vector.input.levelId, vector.input.wallId ?? "", vector.input.t ?? 0.5)
        const merged = mergeCollinearWall(split, vector.input.levelId, vector.input.wallId ?? "")
        expect(levelOf(merged, vector.input.levelId).walls).toHaveLength(before)
        return
      }
      if (vector.op === "setText") {
        const next = setTextContent(vector.input.plan, vector.input.levelId, vector.input.textId ?? "", vector.input.text ?? "")
        const text = levelOf(next, vector.input.levelId).texts.find((item) => item.id === vector.input.textId)
        expect(text?.text).toBe(vector.expect.text)
        return
      }
      if (vector.op === "snapRotation") {
        expect(snapRotation(vector.input.rotationDeg ?? Number.NaN, vector.input.free ?? false)).toBe(vector.expect.rotationDeg)
        return
      }
      if (vector.op in gripOps) {
        assertGrip(vector)
        return
      }
      throw new Error(`unknown op ${vector.op}`)
    })
  }
})

describe("core boundary", () => {
  it("does not import react, konva, or three", () => {
    const coreDir = path.dirname(fileURLToPath(import.meta.url))
    const sources = readdirSync(coreDir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    expect(sources.length).toBeGreaterThan(1)
    for (const name of sources) {
      const text = readFileSync(path.join(coreDir, name), "utf8")
      expect(text, name).not.toMatch(/from ["']react["']/)
      expect(text, name).not.toMatch(/from ["']react-dom["']/)
      expect(text, name).not.toMatch(/from ["']konva["']/)
      expect(text, name).not.toMatch(/from ["']react-konva["']/)
      expect(text, name).not.toMatch(/from ["']three["']/)
    }
  })
})
