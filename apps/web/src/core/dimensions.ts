import { pointInRing, ringCentroid } from "./geom.ts"
import type { Dimension, Level, Plan, Point } from "./plan-types.ts"
import { extractRooms } from "./rooms.ts"

const SIDES = ["south", "east", "north", "west"] as const

type Side = (typeof SIDES)[number]

export function syncAutoDimensions(plan: Plan, levelId: string): Plan {
  const next = structuredClone(plan)
  const level = next.levels.find((item) => item.id === levelId)
  if (!level) {
    throw new Error(`Unknown level ${levelId}`)
  }
  const manual = level.dimensions.filter((dimension) => !dimension.auto)
  const suppressed = new Set(level.suppressedAutoDimensions)
  const generated = chainsFor(next, level).filter((dimension) => !suppressed.has(dimension.id))
  level.dimensions = [...manual, ...generated]
  return next
}

export function suppressDimension(plan: Plan, levelId: string, dimensionId: string): Plan {
  const next = structuredClone(plan)
  const level = next.levels.find((item) => item.id === levelId)
  if (!level) {
    throw new Error(`Unknown level ${levelId}`)
  }
  const dimension = level.dimensions.find((item) => item.id === dimensionId)
  level.dimensions = level.dimensions.filter((item) => item.id !== dimensionId)
  if (dimension?.auto && !level.suppressedAutoDimensions.includes(dimensionId)) {
    level.suppressedAutoDimensions.push(dimensionId)
  }
  return next
}

function chainsFor(plan: Plan, level: Level): Dimension[] {
  const chains: Dimension[] = []
  const vertices = level.vertices
  if (vertices.length === 0) {
    return chains
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex.x)
    minY = Math.min(minY, vertex.y)
    maxX = Math.max(maxX, vertex.x)
    maxY = Math.max(maxY, vertex.y)
  }
  for (const side of SIDES) {
    const onSide = vertices
      .filter((vertex) => onExterior(side, vertex, minX, minY, maxX, maxY))
      .sort((a, b) => (side === "east" || side === "west" ? a.y - b.y : a.x - b.x))
    if (onSide.length < 2) {
      continue
    }
    const first = onSide[0]
    const last = onSide[onSide.length - 1]
    if (!first || !last) {
      continue
    }
    const overall = chain(`exterior-${side}-overall`, sideOffset(side, 0.4), [{ a: first.id, b: last.id }])
    const segments = chain(
      `exterior-${side}-segments`,
      sideOffset(side, 0.8),
      pairs(onSide).map((pair) => ({ a: pair.a, b: pair.b })),
    )
    chains.push(overall)
    if (segments.segments.length > 0) {
      chains.push(segments)
    }
    const openingSegments = openingChain(level, side, minX, minY, maxX, maxY)
    if (openingSegments.length > 0) {
      chains.push(chain(`exterior-${side}-openings`, sideOffset(side, 1.2), openingSegments))
    }
  }
  for (const room of extractRooms(plan, level.id).rooms) {
    if (!rectangular(room.polygon)) {
      continue
    }
    const bounds = polygonBounds(room.polygon)
    const width = axisVertices(vertices, bounds, "x")
    const depth = axisVertices(vertices, bounds, "y")
    if (width) {
      chains.push(chain(`room-${room.id}-width`, 0.3, [{ a: width.a, b: width.b }]))
    }
    if (depth) {
      chains.push(chain(`room-${room.id}-depth`, 0.3, [{ a: depth.a, b: depth.b }]))
    }
  }
  return chains
}

function chain(id: string, offset: number, segments: { a: string; b: string }[]): Dimension {
  return {
    id,
    auto: true,
    offset,
    segments: segments.map((segment) => ({
      a: { type: "vertex", id: segment.a },
      b: { type: "vertex", id: segment.b },
    })),
  }
}

function pairs(points: { id: string }[]): { a: string; b: string }[] {
  const result: { a: string; b: string }[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]
    const b = points[index + 1]
    if (a && b && a.id !== b.id) {
      result.push({ a: a.id, b: b.id })
    }
  }
  return result
}

function onExterior(side: Side, point: Point, minX: number, minY: number, maxX: number, maxY: number): boolean {
  const tolerance = 0.02
  if (side === "south") {
    return Math.abs(point.y - minY) <= tolerance
  }
  if (side === "north") {
    return Math.abs(point.y - maxY) <= tolerance
  }
  if (side === "west") {
    return Math.abs(point.x - minX) <= tolerance
  }
  return Math.abs(point.x - maxX) <= tolerance
}

function sideOffset(side: Side, distance: number): number {
  if (side === "south" || side === "east") {
    return -distance
  }
  return distance
}

function openingChain(
  level: Level,
  side: Side,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): { a: string; b: string }[] {
  const segments: { a: string; b: string }[] = []
  for (const opening of level.openings) {
    const wall = level.walls.find((item) => item.id === opening.wall)
    if (!wall) {
      continue
    }
    const a = level.vertices.find((vertex) => vertex.id === wall.a)
    const b = level.vertices.find((vertex) => vertex.id === wall.b)
    if (!a || !b) {
      continue
    }
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    if (!onExterior(side, mid, minX, minY, maxX, maxY)) {
      continue
    }
    segments.push({ a: wall.a, b: wall.b })
  }
  return segments
}

function rectangular(polygon: readonly Point[]): boolean {
  if (polygon.length < 4) {
    return false
  }
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]
    const b = polygon[(index + 1) % polygon.length]
    if (!a || !b) {
      return false
    }
    const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
    const axis = Math.abs(angle) % 90
    const delta = Math.min(axis, 90 - axis)
    if (delta > 5) {
      return false
    }
  }
  return true
}

function polygonBounds(polygon: readonly Point[]) {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of polygon) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return { minX, minY, maxX, maxY }
}

function axisVertices(
  vertices: { id: string; x: number; y: number }[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  axis: "x" | "y",
): { a: string; b: string } | null {
  const low = axis === "x" ? bounds.minY : bounds.minX
  const onAxis = vertices.filter((vertex) => Math.abs((axis === "x" ? vertex.y : vertex.x) - low) <= 0.05)
  onAxis.sort((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y))
  const first = onAxis[0]
  const last = onAxis[onAxis.length - 1]
  if (!first || !last || first.id === last.id) {
    return null
  }
  return { a: first.id, b: last.id }
}

export function dimensionLabelPoint(level: Level, dimension: Dimension, segmentIndex: number): { point: Point; length: number } | null {
  const segment = dimension.segments[segmentIndex]
  if (!segment || segment.a.type !== "vertex" || segment.b.type !== "vertex") {
    return null
  }
  const a = level.vertices.find((vertex) => vertex.id === segment.a.id)
  const b = level.vertices.find((vertex) => vertex.id === segment.b.id)
  if (!a || !b) {
    return null
  }
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length === 0) {
    return null
  }
  const left = { x: -dy / length, y: dx / length }
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  return {
    point: { x: mid.x + left.x * dimension.offset, y: mid.y + left.y * dimension.offset },
    length,
  }
}

export function roomLabelPoint(polygon: readonly Point[]): Point {
  if (pointInRing(ringCentroid(polygon), polygon)) {
    return ringCentroid(polygon)
  }
  return polygon[0] ?? { x: 0, y: 0 }
}
