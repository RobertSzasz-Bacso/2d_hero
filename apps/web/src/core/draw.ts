import { add, dist, jointAngleDeg, left, mul, sub, unit } from "./geom.ts"
import type {
  Column,
  Dimension,
  Fixture,
  Level,
  Opening,
  Plan,
  PlanText,
  Point,
  Stair,
  Wall,
} from "./plan-types.ts"
import { editorTolerances } from "./tolerances.ts"
import { setOpening, type DimensionRef, type OpeningPatch } from "./ops.ts"

export type Clipboard = {
  vertices: { id: string; x: number; y: number }[]
  walls: Wall[]
  openings: Opening[]
  columns: Column[]
  stairs: Stair[]
  fixtures: Fixture[]
  texts: PlanText[]
}

const FIXTURE_ROLE: Record<Fixture["symbol"], Fixture["role"]> = {
  toilet: "fixture",
  sink: "fixture",
  bathtub: "fixture",
  shower: "fixture",
  "kitchen-counter": "fixture",
  stove: "fixture",
  "bed-double": "furniture",
  sofa: "furniture",
  table: "furniture",
  wardrobe: "furniture",
  block: "furniture",
  chair: "furniture",
}

export function metresFromDisplay(value: number, unit: "cm" | "mm"): number {
  return unit === "mm" ? value / 1000 : value / 100
}

export function displayFromMetres(metres: number, unit: "cm" | "mm"): number {
  return unit === "mm" ? Math.round(metres * 1000) : Math.round(metres * 100)
}

export function ensureDrawingLevel(plan: Plan): Plan {
  if (plan.levels.length > 0) {
    return plan
  }
  const next = structuredClone(plan)
  next.levels.push(emptyLevel())
  return next
}

export function addVertex(plan: Plan, levelId: string, point: Point): { plan: Plan; id: string } {
  const next = ensureDrawingLevel(structuredClone(plan))
  const level = levelOf(next, inLevel(next, levelId))
  const existing = nearestVertex(level, point, editorTolerances.join_snap_m)
  if (existing) {
    return { plan: next, id: existing }
  }
  const id = nextId(level, "v")
  level.vertices.push({ id, x: point.x, y: point.y })
  return { plan: next, id }
}

export function addTypedWall(
  plan: Plan,
  levelId: string,
  start: Point,
  lengthM: number,
  angleDeg: number,
  thickness = 0.2,
): Plan {
  if (!(lengthM > 0) || !Number.isFinite(lengthM)) {
    throw new Error("Typed length must be a positive finite length")
  }
  const next = ensureDrawingLevel(structuredClone(plan))
  const level = levelOf(next, inLevel(next, levelId))
  const direction = directionFromAngle(angleDeg)
  const end = { x: start.x + direction.x * lengthM, y: start.y + direction.y * lengthM }
  const a = nearestVertex(level, start, editorTolerances.join_snap_m) ?? pushVertex(level, start)
  const b = nearestVertex(level, end, editorTolerances.join_snap_m) ?? pushVertex(level, end)
  if (a === b) {
    throw new Error("A wall needs two different vertices")
  }
  level.walls.push({
    id: nextId(level, "w"),
    a,
    b,
    thickness,
    kind: "exterior",
    confidence: 1,
  })
  return next
}

/** The point `lengthM` from `start` at `angleDeg`, exact at multiples of 90°. */
export function pointAtAngle(start: Point, lengthM: number, angleDeg: number): Point {
  const direction = directionFromAngle(angleDeg)
  return { x: start.x + direction.x * lengthM, y: start.y + direction.y * lengthM }
}

/** A wall from an existing vertex to a point, joining a vertex already within `join_snap_m` of it. */
export function addWallFrom(plan: Plan, levelId: string, fromId: string, end: Point, thickness: number): { plan: Plan; endId: string } {
  if (!(thickness > 0) || thickness > 1.5) {
    throw new Error("Wall thickness must be greater than 0 and at most 1.5 m")
  }
  const next = ensureDrawingLevel(structuredClone(plan))
  const level = levelOf(next, inLevel(next, levelId))
  vertexOf(level, fromId)
  const endId = nearestVertex(level, end, editorTolerances.join_snap_m) ?? pushVertex(level, end)
  if (endId === fromId) {
    throw new Error("A wall needs two different vertices")
  }
  level.walls.push({ id: nextId(level, "w"), a: fromId, b: endId, thickness, kind: "exterior", confidence: 1 })
  return { plan: next, endId }
}

export type WallLocation = "center" | "left" | "right"

export type RectangleMode = "interior" | "centerline"

/** Centerline of a wall whose `location` line (centre, left face, or right face) runs from p to q. */
export function wallFromLocation(p: Point, q: Point, thickness: number, location: WallLocation): { a: Point; b: Point } {
  const direction = unit(sub(q, p))
  if (location === "center" || (direction.x === 0 && direction.y === 0)) {
    return { a: { x: p.x, y: p.y }, b: { x: q.x, y: q.y } }
  }
  const shift = mul(left(direction), location === "left" ? -thickness / 2 : thickness / 2)
  return { a: add(p, shift), b: add(q, shift) }
}

/** Four walls counter-clockwise around the box c1, c2, and a room seed at its centre. */
export function addRectangle(plan: Plan, levelId: string, c1: Point, c2: Point, thickness: number, mode: RectangleMode): Plan {
  if (!(thickness > 0) || thickness > 1.5) {
    throw new Error("Wall thickness must be greater than 0 and at most 1.5 m")
  }
  const grow = mode === "interior" ? thickness / 2 : 0
  const minX = Math.min(c1.x, c2.x) - grow
  const minY = Math.min(c1.y, c2.y) - grow
  const maxX = Math.max(c1.x, c2.x) + grow
  const maxY = Math.max(c1.y, c2.y) + grow
  if (!(maxX - minX > thickness) || !(maxY - minY > thickness)) {
    throw new Error("The rectangle is smaller than its walls")
  }
  const next = ensureDrawingLevel(structuredClone(plan))
  const level = levelOf(next, inLevel(next, levelId))
  const corners = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]
  const ids = corners.map((corner) => nearestVertex(level, corner, editorTolerances.join_snap_m) ?? pushVertex(level, corner))
  for (let index = 0; index < ids.length; index += 1) {
    const a = ids[index] as string
    const b = ids[(index + 1) % ids.length] as string
    if (!level.walls.some((wall) => (wall.a === a && wall.b === b) || (wall.a === b && wall.b === a))) {
      level.walls.push({ id: nextId(level, "w"), a, b, thickness, kind: "exterior", confidence: 1 })
    }
  }
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  const seeded = level.rooms.some((room) => room.seed.x > minX && room.seed.x < maxX && room.seed.y > minY && room.seed.y < maxY)
  if (!seeded) {
    level.rooms.push({ id: nextId(level, "r"), name: "Room", number: "", seed: center })
  }
  return next
}

/** Distance along the wall from an end vertex to the inner corner made by the thickest other wall there. */
export function innerCornerOffset(level: Level, wallId: string, vertexId: string): number {
  let half = 0
  for (const wall of level.walls) {
    if (wall.id !== wallId && (wall.a === vertexId || wall.b === vertexId)) {
      half = Math.max(half, wall.thickness / 2)
    }
  }
  return half
}

/** Place an opening whose near edge is `distance` from the inner corner at wall end `end`. */
export function placeOpeningAtDistance(
  plan: Plan,
  levelId: string,
  wallId: string,
  kind: Opening["kind"],
  end: "a" | "b",
  distance: number,
  width: number,
  swingSide: Opening["swingSide"] = "positive",
): Plan {
  if (!(distance >= 0) || !Number.isFinite(distance)) {
    throw new Error("The distance must be zero or more")
  }
  if (!(width > 0)) {
    throw new Error("The opening width must be greater than 0")
  }
  const level = levelOf(plan, levelId)
  const wall = level.walls.find((item) => item.id === wallId)
  if (!wall) {
    throw new Error(`Unknown wall ${wallId}`)
  }
  const length = dist(vertexOf(level, wall.a), vertexOf(level, wall.b))
  const startCorner = innerCornerOffset(level, wallId, wall.a)
  const endCorner = length - innerCornerOffset(level, wallId, wall.b)
  const center = end === "a" ? startCorner + distance + width / 2 : endCorner - distance - width / 2
  if (center - width / 2 < startCorner - 1e-9 || center + width / 2 > endCorner + 1e-9) {
    throw new Error("The opening does not fit between the inner corners")
  }
  const added = addOpeningOnWall(plan, levelId, wallId, kind, center / length, width)
  const openings = levelOf(added, levelId).openings
  const opening = openings[openings.length - 1]
  if (opening) {
    opening.swingSide = swingSide
  }
  return added
}

/** A manual dimension chain through two or more references. */
export function addDimension(plan: Plan, levelId: string, refs: readonly DimensionRef[], offset: number): Plan {
  if (refs.length < 2) {
    throw new Error("A dimension needs at least two points")
  }
  if (!Number.isFinite(offset)) {
    throw new Error("The dimension offset must be a number")
  }
  const next = structuredClone(plan)
  const level = levelOf(next, levelId)
  for (const ref of refs) {
    const known = ref.type === "vertex" ? level.vertices.some((item) => item.id === ref.id) : level.openings.some((item) => item.id === ref.id)
    if (!known) {
      throw new Error(`Unknown ${ref.type} ${ref.id}`)
    }
  }
  const segments: Dimension["segments"] = []
  for (let index = 0; index < refs.length - 1; index += 1) {
    const a = refs[index] as DimensionRef
    const b = refs[index + 1] as DimensionRef
    if (JSON.stringify(a) === JSON.stringify(b)) {
      throw new Error("A dimension segment needs two different points")
    }
    segments.push({ a: { ...a }, b: { ...b } })
  }
  level.dimensions.push({ id: nextId(level, "d"), auto: false, offset, segments })
  return next
}

export function splitWall(plan: Plan, levelId: string, wallId: string, t: number): Plan {
  if (!(t > 0) || !(t < 1)) {
    throw new Error("Split the wall between its ends")
  }
  const next = structuredClone(plan)
  const level = levelOf(next, levelId)
  const wall = level.walls.find((item) => item.id === wallId)
  if (!wall) {
    throw new Error(`Unknown wall ${wallId}`)
  }
  const a = vertexOf(level, wall.a)
  const b = vertexOf(level, wall.b)
  const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  const middle = pushVertex(level, point)
  const far = wall.b
  wall.b = middle
  const created = nextId(level, "w")
  level.walls.push({
    id: created,
    a: middle,
    b: far,
    thickness: wall.thickness,
    kind: wall.kind,
    confidence: wall.confidence,
  })
  for (const opening of level.openings) {
    if (opening.wall !== wallId) {
      continue
    }
    if (opening.offset <= t) {
      opening.offset = Math.min(1, Math.max(0, opening.offset / t))
    } else {
      opening.wall = created
      opening.offset = Math.min(1, Math.max(0, (opening.offset - t) / (1 - t)))
    }
  }
  return next
}

export function mergeCollinearWall(plan: Plan, levelId: string, wallId: string): Plan {
  const next = structuredClone(plan)
  const level = levelOf(next, levelId)
  const wall = level.walls.find((item) => item.id === wallId)
  if (!wall) {
    throw new Error(`Unknown wall ${wallId}`)
  }
  const neighbor = collinearNeighbor(level, wall)
  if (!neighbor) {
    return next
  }
  const shared = wall.a === neighbor.wall.a || wall.a === neighbor.wall.b ? wall.a : wall.b
  const keepA = wall.a === shared ? wall.b : wall.a
  const keepB = neighbor.wall.a === shared ? neighbor.wall.b : neighbor.wall.a
  const centers = new Map<string, { center: Point; width: number; opening: Opening }>()
  for (const opening of level.openings) {
    if (opening.wall !== wall.id && opening.wall !== neighbor.wall.id) {
      continue
    }
    const host = level.walls.find((item) => item.id === opening.wall)
    if (!host) {
      continue
    }
    const a = vertexOf(level, host.a)
    const b = vertexOf(level, host.b)
    centers.set(opening.id, {
      center: { x: a.x + (b.x - a.x) * opening.offset, y: a.y + (b.y - a.y) * opening.offset },
      width: opening.width,
      opening,
    })
  }
  wall.a = keepA
  wall.b = keepB
  level.walls = level.walls.filter((item) => item.id !== neighbor.wall.id)
  const start = vertexOf(level, keepA)
  const end = vertexOf(level, keepB)
  const span = sub(end, start)
  const length = Math.hypot(span.x, span.y) || 1
  const axis = unit(span)
  for (const opening of level.openings) {
    const remembered = centers.get(opening.id)
    if (!remembered) {
      continue
    }
    opening.wall = wall.id
    const offset = ((remembered.center.x - start.x) * axis.x + (remembered.center.y - start.y) * axis.y) / length
    opening.offset = Math.min(1, Math.max(0, offset))
  }
  const stillUsed = referencedVertices(level)
  level.vertices = level.vertices.filter((vertex) => vertex.id !== shared || stillUsed.has(vertex.id))
  if (!stillUsed.has(shared)) {
    level.vertices = level.vertices.filter((vertex) => vertex.id !== shared)
  }
  return next
}

export function addOpeningOnWall(
  plan: Plan,
  levelId: string,
  wallId: string,
  kind: Opening["kind"],
  offset: number,
  width = 0.9,
): Plan {
  const next = structuredClone(plan)
  const level = levelOf(next, levelId)
  const wall = level.walls.find((item) => item.id === wallId)
  if (!wall) {
    throw new Error(`Unknown wall ${wallId}`)
  }
  const opening: Opening = {
    id: nextId(level, "o"),
    wall: wallId,
    kind,
    offset,
    width,
    sill: kind === "window" ? 0.9 : 0,
    head: kind === "window" ? 2.1 : 2.1,
    swing: kind === "passage" ? "none" : "left",
    swingSide: "positive",
    confidence: 1,
  }
  level.openings.push(opening)
  return setOpening(next, levelId, opening.id, {})
}

export function flipSwing(plan: Plan, levelId: string, openingId: string): Plan {
  const level = levelOf(plan, levelId)
  const opening = level.openings.find((item) => item.id === openingId)
  if (!opening) {
    throw new Error(`Unknown opening ${openingId}`)
  }
  const swingSide: Opening["swingSide"] = opening.swingSide === "positive" ? "negative" : "positive"
  const patch: OpeningPatch = { swingSide }
  return setOpening(plan, levelId, openingId, patch)
}

export function addColumn(plan: Plan, levelId: string, point: Point): Plan {
  const next = structuredClone(plan)
  const level = levelOf(next, levelId)
  level.columns.push({ id: nextId(level, "c"), x: point.x, y: point.y, width: 0.3, depth: 0.3, rotationDeg: 0 })
  return next
}

export function addStair(plan: Plan, levelId: string, point: Point): Plan {
  const next = structuredClone(plan)
  const level = levelOf(next, levelId)
  const x0 = point.x - 0.5
  const x1 = point.x + 0.5
  const y0 = point.y - 1.5
  const y1 = point.y + 1.5
  level.stairs.push({
    id: nextId(level, "s"),
    outline: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
    direction: { x: 0, y: 1 },
    riserCount: 16,
    fromElevation: 0,
    toElevation: level.ceilingHeight,
  })
  return next
}

export function addTextLabel(plan: Plan, levelId: string, point: Point, text = "Label"): Plan {
  const next = structuredClone(plan)
  const level = levelOf(next, levelId)
  level.texts.push({ id: nextId(level, "t"), x: point.x, y: point.y, text, heightM: 0.25 })
  return next
}

export function addFixture(plan: Plan, levelId: string, symbol: Fixture["symbol"], point: Point, rotationDeg = 0): Plan {
  const next = structuredClone(plan)
  const level = levelOf(next, levelId)
  const size = symbolSize(symbol)
  level.fixtures.push({
    id: nextId(level, "f"),
    symbol,
    x: point.x,
    y: point.y,
    rotationDeg: (((rotationDeg % 360) + 360) % 360),
    width: size.width,
    depth: size.depth,
    confidence: 1,
    role: FIXTURE_ROLE[symbol],
  })
  return next
}

export function addSeparator(plan: Plan, levelId: string, a: Point, b: Point): Plan {
  const next = structuredClone(plan)
  const level = levelOf(next, levelId)
  const aId = nearestVertex(level, a, editorTolerances.join_snap_m) ?? pushVertex(level, a)
  const bId = nearestVertex(level, b, editorTolerances.join_snap_m) ?? pushVertex(level, b)
  level.separators.push({ id: nextId(level, "p"), a: aId, b: bId })
  return next
}

export function addRoomSeed(plan: Plan, levelId: string, point: Point, name: string, number: string): Plan {
  const next = structuredClone(plan)
  const level = levelOf(next, levelId)
  level.rooms.push({ id: nextId(level, "r"), name, number, seed: { x: point.x, y: point.y } })
  return next
}

export function copySelection(plan: Plan, levelId: string, ids: readonly string[]): Clipboard {
  const level = levelOf(plan, levelId)
  const wanted = new Set(ids)
  const walls = level.walls.filter((wall) => wanted.has(wall.id) || wanted.has(wall.a) || wanted.has(wall.b))
  const wallIds = new Set(walls.map((wall) => wall.id))
  const vertexIds = new Set<string>()
  for (const wall of walls) {
    vertexIds.add(wall.a)
    vertexIds.add(wall.b)
  }
  return {
    vertices: level.vertices.filter((vertex) => vertexIds.has(vertex.id)).map((vertex) => ({ ...vertex })),
    walls: walls.map((wall) => ({ ...wall })),
    openings: level.openings.filter((opening) => wanted.has(opening.id) || wallIds.has(opening.wall)).map((opening) => ({ ...opening })),
    columns: level.columns.filter((column) => wanted.has(column.id)).map((column) => ({ ...column })),
    stairs: level.stairs.filter((stair) => wanted.has(stair.id)).map((stair) => structuredClone(stair)),
    fixtures: level.fixtures.filter((fixture) => wanted.has(fixture.id)).map((fixture) => ({ ...fixture })),
    texts: level.texts.filter((text) => wanted.has(text.id)).map((text) => ({ ...text })),
  }
}

export function pasteClipboard(plan: Plan, levelId: string, clipboard: Clipboard, delta: Point = { x: 0.5, y: 0.5 }): Plan {
  const next = structuredClone(plan)
  const level = levelOf(next, levelId)
  const map = new Map<string, string>()
  for (const vertex of clipboard.vertices) {
    const id = nextId(level, "v")
    map.set(vertex.id, id)
    level.vertices.push({ id, x: vertex.x + delta.x, y: vertex.y + delta.y })
  }
  const wallMap = new Map<string, string>()
  for (const wall of clipboard.walls) {
    const id = nextId(level, "w")
    wallMap.set(wall.id, id)
    const a = map.get(wall.a)
    const b = map.get(wall.b)
    if (!a || !b) {
      continue
    }
    level.walls.push({ ...wall, id, a, b })
  }
  for (const opening of clipboard.openings) {
    const wall = wallMap.get(opening.wall)
    if (!wall) {
      continue
    }
    level.openings.push({ ...opening, id: nextId(level, "o"), wall })
  }
  for (const column of clipboard.columns) {
    level.columns.push({ ...column, id: nextId(level, "c"), x: column.x + delta.x, y: column.y + delta.y })
  }
  for (const stair of clipboard.stairs) {
    level.stairs.push({
      ...structuredClone(stair),
      id: nextId(level, "s"),
      outline: stair.outline.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })),
    })
  }
  for (const fixture of clipboard.fixtures) {
    level.fixtures.push({ ...fixture, id: nextId(level, "f"), x: fixture.x + delta.x, y: fixture.y + delta.y })
  }
  for (const text of clipboard.texts) {
    level.texts.push({ ...text, id: nextId(level, "t"), x: text.x + delta.x, y: text.y + delta.y })
  }
  return next
}

export function symbolSize(symbol: Fixture["symbol"]): { width: number; depth: number } {
  if (symbol === "bed-double") {
    return { width: 1.6, depth: 2 }
  }
  if (symbol === "sofa" || symbol === "kitchen-counter") {
    return { width: 2, depth: 0.6 }
  }
  if (symbol === "bathtub") {
    return { width: 0.7, depth: 1.7 }
  }
  if (symbol === "table") {
    return { width: 1.2, depth: 0.8 }
  }
  if (symbol === "wardrobe") {
    return { width: 1.2, depth: 0.6 }
  }
  if (symbol === "toilet") {
    return { width: 0.4, depth: 0.7 }
  }
  return { width: 0.6, depth: 0.6 }
}

function emptyLevel(): Level {
  return {
    id: "L1",
    name: "Ground floor",
    elevation: 0,
    ceilingHeight: 2.7,
    vertices: [],
    walls: [],
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

function inLevel(plan: Plan, levelId: string): string {
  if (plan.levels.some((level) => level.id === levelId)) {
    return levelId
  }
  const only = plan.levels[0]
  if (!only) {
    throw new Error(`Unknown level ${levelId}`)
  }
  return only.id
}

function levelOf(plan: Plan, levelId: string): Level {
  const level = plan.levels.find((item) => item.id === levelId)
  if (!level) {
    throw new Error(`Unknown level ${levelId}`)
  }
  return level
}

function vertexOf(level: Level, id: string): Point {
  const vertex = level.vertices.find((item) => item.id === id)
  if (!vertex) {
    throw new Error(`Unknown vertex ${id}`)
  }
  return vertex
}

function directionFromAngle(degrees: number): Point {
  const turns = ((degrees % 360) + 360) % 360
  if (turns === 0) {
    return { x: 1, y: 0 }
  }
  if (turns === 90) {
    return { x: 0, y: 1 }
  }
  if (turns === 180) {
    return { x: -1, y: 0 }
  }
  if (turns === 270) {
    return { x: 0, y: -1 }
  }
  const radians = (turns * Math.PI) / 180
  return { x: Math.cos(radians), y: Math.sin(radians) }
}

function nearestVertex(level: Level, point: Point, tolerance: number): string | null {
  let best: string | null = null
  let bestDistance = tolerance
  for (const vertex of level.vertices) {
    const distance = dist(vertex, point)
    if (distance <= bestDistance) {
      best = vertex.id
      bestDistance = distance
    }
  }
  return best
}

function pushVertex(level: Level, point: Point): string {
  const id = nextId(level, "v")
  level.vertices.push({ id, x: point.x, y: point.y })
  return id
}

function nextId(level: Level, prefix: string): string {
  const used = allIds(level)
  for (let index = 1; index < 10000; index += 1) {
    const id = `${prefix}${index}`
    if (!used.has(id)) {
      return id
    }
  }
  throw new Error("No free id")
}

function allIds(level: Level): Set<string> {
  const used = new Set<string>()
  const lists = [
    level.vertices,
    level.walls,
    level.openings,
    level.columns,
    level.stairs,
    level.rooms,
    level.separators,
    level.fixtures,
    level.texts,
    level.dimensions,
  ]
  for (const list of lists) {
    for (const item of list) {
      used.add(item.id)
    }
  }
  return used
}

function collinearNeighbor(level: Level, wall: Wall): { wall: Wall } | null {
  for (const other of level.walls) {
    if (other.id === wall.id) {
      continue
    }
    const shared = [wall.a, wall.b].find((id) => id === other.a || id === other.b)
    if (!shared) {
      continue
    }
    const here = vertexOf(level, shared)
    const wallFar = vertexOf(level, wall.a === shared ? wall.b : wall.a)
    const otherFar = vertexOf(level, other.a === shared ? other.b : other.a)
    const angle = jointAngleDeg(here, wallFar, otherFar)
    if (Math.abs(angle - 180) <= editorTolerances.ortho_deg) {
      return { wall: other }
    }
  }
  return null
}

function referencedVertices(level: Level): Set<string> {
  const used = new Set<string>()
  for (const wall of level.walls) {
    used.add(wall.a)
    used.add(wall.b)
  }
  for (const separator of level.separators) {
    used.add(separator.a)
    used.add(separator.b)
  }
  return used
}
