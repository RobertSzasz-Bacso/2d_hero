import { difference, type Polygon, type Ring } from "polygon-clipping"
import { openingEnds } from "@/editor/metrics.ts"
import { symbolPolylines } from "@/editor/symbols.ts"
import { add, dedupeRing, left, mul, rotate, sub, unit } from "@/core/geom.ts"
import type { Level, Plan, Point } from "@/core/plan-types.ts"
import { roomLabelPoint } from "@/core/dimensions.ts"
import { extractRooms } from "@/core/rooms.ts"
import { wallPolygons } from "@/core/wall-polygons.ts"

export const CUT_MM = 0.5
export const VISIBLE_MM = 0.25
export const THIN_MM = 0.13

export type ElementKind = "wall" | "opening" | "column" | "stair" | "fixture" | "separator" | "dimension" | "room" | "text"

export type SceneElement = { kind: ElementKind; id: string }

export type StrokeRole = "cut-wall" | "visible" | "thin" | "separator"

export type StrokePart =
  | "outline"
  | "leaf"
  | "swing"
  | "sliding"
  | "glass"
  | "glass-center"
  | "tread"
  | "run"
  | "arrow"
  | "break"
  | "symbol"
  | "separator"
  | "extension"
  | "dimension-line"
  | "tick"

export type SceneItem =
  | { type: "fill"; element: SceneElement; rings: Point[][] }
  | {
      type: "stroke"
      element: SceneElement | null
      role: StrokeRole
      part: StrokePart
      points: Point[]
      weightMm: number
      closed: boolean
      dashMm?: number[]
    }
  | {
      type: "text"
      element: SceneElement | null
      role: "dimension" | "room" | "note"
      part: "name" | "number" | "area" | "value" | "note"
      at: Point
      liftMm: number
      text: string
      heightMm: number
      rotationDeg: number
      segmentIndex?: number
    }

export type SceneOptions = {
  scale: number
  unit: "cm" | "mm"
  hideFurniture: boolean
}

type Stroke = Extract<SceneItem, { type: "stroke" }>

export function formatDimension(metres: number, unit: "cm" | "mm"): string {
  const factor = unit === "mm" ? 1000 : 100
  return String(Math.round(metres * factor))
}

/** Plan level to scene items in plan metres. The order is the paint order of the sheet. */
export function buildScene(plan: Plan, level: Level, options: SceneOptions): SceneItem[] {
  const items: SceneItem[] = []
  for (const polygon of wallPolygons(plan, level.id)) {
    const element: SceneElement = { kind: "wall", id: polygon.wallId }
    const holes = level.openings
      .filter((opening) => opening.wall === polygon.wallId)
      .map((opening) => openingRect(level, opening))
      .filter((ring): ring is Point[] => ring !== null)
    for (const piece of cutRing(polygon.ring, holes)) {
      items.push({ type: "fill", element, rings: [piece.outer, ...piece.holes] })
      items.push(stroke(element, piece.outer, "cut-wall", "outline", CUT_MM, true))
      for (const hole of piece.holes) {
        items.push(stroke(element, hole, "cut-wall", "outline", CUT_MM, true))
      }
    }
  }
  for (const opening of level.openings) {
    items.push(...openingGraphics(level, opening))
  }
  for (const column of level.columns) {
    const element: SceneElement = { kind: "column", id: column.id }
    const ring = columnRing(column)
    items.push({ type: "fill", element, rings: [ring] })
    items.push(stroke(element, ring, "cut-wall", "outline", CUT_MM, true))
  }
  for (const stair of level.stairs) {
    items.push(...stairGraphics(level, stair))
  }
  for (const fixture of level.fixtures) {
    if (options.hideFurniture && fixture.role === "furniture") {
      continue
    }
    const element: SceneElement = { kind: "fixture", id: fixture.id }
    const dashed = fixture.symbol === "block"
    for (const line of symbolPolylines(fixture.symbol)) {
      items.push(stroke(element, line.map((point) => placeSymbol(fixture, point)), "visible", "symbol", VISIBLE_MM, false, dashed ? [2, 1] : undefined))
    }
  }
  const vertices = new Map(level.vertices.map((vertex) => [vertex.id, { x: vertex.x, y: vertex.y }]))
  for (const separator of level.separators) {
    const a = vertices.get(separator.a)
    const b = vertices.get(separator.b)
    if (!a || !b) {
      continue
    }
    items.push(stroke({ kind: "separator", id: separator.id }, [a, b], "separator", "separator", THIN_MM, false, [4, 1, 0.5, 1]))
  }
  for (const dimension of level.dimensions) {
    items.push(...dimensionGraphics(level, dimension, options.scale, options.unit))
  }
  for (const room of extractRooms(plan, level.id).rooms) {
    items.push(...roomTag(room.id, room.polygon, room.name, room.number, room.area))
  }
  for (const note of level.texts) {
    items.push({
      type: "text",
      element: { kind: "text", id: note.id },
      role: "note",
      part: "note",
      at: { x: note.x, y: note.y },
      liftMm: 0,
      text: note.text,
      heightMm: note.heightM * (1000 / options.scale),
      rotationDeg: 0,
    })
  }
  return items
}

export function openingRect(level: Level, opening: Level["openings"][number]): Point[] | null {
  const ends = openingEnds(level, opening)
  const wall = level.walls.find((item) => item.id === opening.wall)
  if (!ends || !wall) {
    return null
  }
  const direction = unit(sub(ends.b, ends.a))
  if (direction.x === 0 && direction.y === 0) {
    return null
  }
  const normal = left(direction)
  const half = wall.thickness / 2 + 0.002
  return [
    add(ends.a, mul(normal, half)),
    add(ends.b, mul(normal, half)),
    add(ends.b, mul(normal, -half)),
    add(ends.a, mul(normal, -half)),
  ]
}

export function openingGraphics(level: Level, opening: Level["openings"][number]): Stroke[] {
  const ends = openingEnds(level, opening)
  const wall = level.walls.find((item) => item.id === opening.wall)
  if (!ends || !wall) {
    return []
  }
  const element: SceneElement = { kind: "opening", id: opening.id }
  const direction = unit(sub(ends.b, ends.a))
  if (direction.x === 0 && direction.y === 0) {
    return []
  }
  const normal = left(direction)
  const side = opening.swingSide === "positive" ? 1 : -1
  const swing = mul(normal, side)
  if (opening.kind === "window") {
    const half = wall.thickness / 2
    return [
      stroke(element, [add(ends.a, mul(normal, half)), add(ends.b, mul(normal, half))], "visible", "glass", VISIBLE_MM, false),
      stroke(element, [add(ends.a, mul(normal, -half)), add(ends.b, mul(normal, -half))], "visible", "glass", VISIBLE_MM, false),
      stroke(element, [ends.a, ends.b], "thin", "glass-center", THIN_MM, false),
    ]
  }
  if (opening.kind !== "door" || opening.swing === "none") {
    return []
  }
  if (opening.swing === "sliding") {
    const rect = [
      add(ends.a, mul(swing, 0.02)),
      add(ends.b, mul(swing, 0.02)),
      add(ends.b, mul(swing, 0.08)),
      add(ends.a, mul(swing, 0.08)),
    ]
    return [stroke(element, rect, "visible", "sliding", VISIBLE_MM, true)]
  }
  const hinges = opening.swing === "double" ? [ends.a, ends.b] : opening.swing === "right" ? [ends.b] : [ends.a]
  const leaf = opening.swing === "double" ? opening.width / 2 : opening.width
  const strokes: Stroke[] = []
  for (const hinge of hinges) {
    const other = hinge === ends.a ? ends.b : ends.a
    const closed = unit(sub(other, hinge))
    const openEnd = add(hinge, mul(swing, leaf))
    strokes.push(stroke(element, [hinge, openEnd], "visible", "leaf", VISIBLE_MM, false))
    strokes.push(stroke(element, arcPoints(hinge, closed, swing, leaf), "thin", "swing", THIN_MM, false))
  }
  return strokes
}

function arcPoints(origin: Point, from: Point, to: Point, radius: number): Point[] {
  const start = Math.atan2(from.y, from.x)
  let delta = Math.atan2(to.y, to.x) - start
  while (delta > Math.PI) {
    delta -= Math.PI * 2
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2
  }
  const points: Point[] = []
  for (let step = 0; step <= 8; step += 1) {
    const angle = start + (delta * step) / 8
    points.push({ x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius })
  }
  return points
}

export function columnRing(column: Level["columns"][number]): Point[] {
  const halfW = column.width / 2
  const halfD = column.depth / 2
  const corners = [
    { x: -halfW, y: -halfD },
    { x: halfW, y: -halfD },
    { x: halfW, y: halfD },
    { x: -halfW, y: halfD },
  ]
  return corners.map((corner) => add({ x: column.x, y: column.y }, rotate(corner, column.rotationDeg)))
}

function stairGraphics(level: Level, stair: Level["stairs"][number]): Stroke[] {
  const element: SceneElement = { kind: "stair", id: stair.id }
  const strokes: Stroke[] = []
  if (stair.outline.length >= 2) {
    strokes.push(stroke(element, stair.outline, "visible", "outline", VISIBLE_MM, true))
  }
  const direction = unit(stair.direction)
  if ((direction.x === 0 && direction.y === 0) || stair.outline.length === 0) {
    return strokes
  }
  const normal = left(direction)
  let minU = Number.POSITIVE_INFINITY
  let maxU = Number.NEGATIVE_INFINITY
  let minV = Number.POSITIVE_INFINITY
  let maxV = Number.NEGATIVE_INFINITY
  for (const point of stair.outline) {
    const u = point.x * direction.x + point.y * direction.y
    const v = point.x * normal.x + point.y * normal.y
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }
  const count = Math.max(1, stair.riserCount)
  for (let index = 1; index < count; index += 1) {
    const u = minU + ((maxU - minU) * index) / count
    const a = add(mul(direction, u), mul(normal, minV))
    const b = add(mul(direction, u), mul(normal, maxV))
    strokes.push(stroke(element, [a, b], "thin", "tread", THIN_MM, false))
  }
  const midV = (minV + maxV) / 2
  const tail = add(mul(direction, minU), mul(normal, midV))
  const head = add(mul(direction, maxU), mul(normal, midV))
  strokes.push(stroke(element, [tail, head], "visible", "run", VISIBLE_MM, false))
  const headBack = add(head, mul(direction, -0.25))
  strokes.push(stroke(element, [add(headBack, mul(normal, 0.12)), head, add(headBack, mul(normal, -0.12))], "visible", "arrow", VISIBLE_MM, false))
  if (stair.toElevation > level.ceilingHeight || stair.fromElevation < 0) {
    const u = (minU + maxU) / 2
    const zig = [0, 0.15, -0.15, 0.15, 0].map((offset, index) => add(mul(direction, u + (index - 2) * 0.12), mul(normal, midV + offset)))
    strokes.push(stroke(element, zig, "thin", "break", THIN_MM, false))
  }
  return strokes
}

export function placeSymbol(fixture: Level["fixtures"][number], point: Point): Point {
  const scaled = { x: point.x * fixture.width, y: point.y * fixture.depth }
  return add({ x: fixture.x, y: fixture.y }, rotate(scaled, fixture.rotationDeg))
}

function dimensionGraphics(level: Level, dimension: Level["dimensions"][number], scale: number, displayUnit: "cm" | "mm"): SceneItem[] {
  const element: SceneElement = { kind: "dimension", id: dimension.id }
  const items: SceneItem[] = []
  const gapM = (2 * scale) / 1000
  const tickM = (2.5 * scale) / 1000
  dimension.segments.forEach((segment, segmentIndex) => {
    const a = dimensionEndpoint(level, segment.a)
    const b = dimensionEndpoint(level, segment.b)
    if (!a || !b) {
      return
    }
    const delta = sub(b, a)
    const length = Math.hypot(delta.x, delta.y)
    if (length === 0) {
      return
    }
    const direction = unit(delta)
    const normal = left(direction)
    const offset = mul(normal, dimension.offset)
    const aLine = add(a, offset)
    const bLine = add(b, offset)
    const beyond = dimension.offset === 0 ? normal : unit(offset)
    items.push(stroke(element, [add(a, mul(beyond, gapM)), add(aLine, mul(beyond, gapM))], "thin", "extension", THIN_MM, false))
    items.push(stroke(element, [add(b, mul(beyond, gapM)), add(bLine, mul(beyond, gapM))], "thin", "extension", THIN_MM, false))
    items.push(stroke(element, [aLine, bLine], "thin", "dimension-line", THIN_MM, false))
    const tick = rotate(direction, 45)
    const half = mul(tick, tickM / 2)
    items.push(stroke(element, [sub(aLine, half), add(aLine, half)], "thin", "tick", THIN_MM, false))
    items.push(stroke(element, [sub(bLine, half), add(bLine, half)], "thin", "tick", THIN_MM, false))
    const mid = { x: (aLine.x + bLine.x) / 2, y: (aLine.y + bLine.y) / 2 }
    const label = add(mid, mul(beyond, (1.6 * scale) / 1000))
    let rotation = (Math.atan2(direction.y, direction.x) * 180) / Math.PI
    if (rotation > 90 || rotation < -90) {
      rotation -= 180
    }
    items.push({
      type: "text",
      element,
      role: "dimension",
      part: "value",
      at: label,
      liftMm: 0,
      text: formatDimension(length, displayUnit),
      heightMm: 2.5,
      rotationDeg: rotation,
      segmentIndex,
    })
  })
  return items
}

export function dimensionEndpoint(level: Level, ref: Level["dimensions"][number]["segments"][number]["a"]): Point | null {
  if (ref.type === "vertex") {
    const vertex = level.vertices.find((item) => item.id === ref.id)
    return vertex ? { x: vertex.x, y: vertex.y } : null
  }
  const opening = level.openings.find((item) => item.id === ref.id)
  if (!opening) {
    return null
  }
  const ends = openingEnds(level, opening)
  if (!ends) {
    return null
  }
  return ref.edge === "start" ? ends.a : ends.b
}

function roomTag(id: string, polygon: Point[], name: string, number: string, area: number): SceneItem[] {
  const element: SceneElement = { kind: "room", id }
  const at = roomLabelPoint(polygon)
  const tag = (part: "name" | "number" | "area", text: string, heightMm: number, liftMm: number): SceneItem => ({
    type: "text",
    element,
    role: "room",
    part,
    at,
    liftMm,
    text,
    heightMm,
    rotationDeg: 0,
  })
  const items: SceneItem[] = [tag("name", name.trim().length > 0 ? name : "Room", 5, 4.5)]
  if (number.trim().length > 0) {
    items.push(tag("number", number, 3.5, 0))
  }
  items.push(tag("area", `${area.toFixed(1)} m²`, 3.5, -4.5))
  return items
}

function cutRing(ring: Point[], holes: Point[][]): { outer: Point[]; holes: Point[][] }[] {
  if (holes.length === 0) {
    const outer = dedupeRing(ring)
    return outer.length >= 3 ? [{ outer, holes: [] }] : []
  }
  let current: Polygon[] = [[toRing(ring)]]
  for (const hole of holes) {
    const next: Polygon[] = []
    const cutter: Polygon = [toRing(hole)]
    for (const polygon of current) {
      next.push(...difference(polygon, cutter))
    }
    current = next
  }
  const pieces: { outer: Point[]; holes: Point[][] }[] = []
  for (const polygon of current) {
    const outer = fromRing(polygon[0] ?? [])
    if (outer.length < 3) {
      continue
    }
    pieces.push({ outer, holes: polygon.slice(1).map((hole) => fromRing(hole)).filter((hole) => hole.length >= 3) })
  }
  return pieces
}

function toRing(points: readonly Point[]): Ring {
  return points.map((point) => [point.x, point.y])
}

function fromRing(ring: Ring): Point[] {
  return dedupeRing(ring.map(([x, y]) => ({ x: x ?? 0, y: y ?? 0 })))
}

function stroke(
  element: SceneElement | null,
  points: Point[],
  role: StrokeRole,
  part: StrokePart,
  weightMm: number,
  closed: boolean,
  dashMm?: number[],
): Stroke {
  return { type: "stroke", element, role, part, points, weightMm, closed, dashMm }
}
