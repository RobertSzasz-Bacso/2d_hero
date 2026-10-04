import { footOnLine } from "@/core/geom.ts"
import type { Level, Opening, Point } from "@/core/plan-types.ts"

export function formatMetre(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6
  if (Object.is(rounded, -0)) {
    return "0"
  }
  return String(rounded)
}

export function wallAngleDeg(a: Point, b: Point): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

export function segmentLength(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function openingEnds(level: Level, opening: Opening): { a: Point; b: Point; center: Point } | null {
  const wall = level.walls.find((item) => item.id === opening.wall)
  if (!wall) {
    return null
  }
  const start = level.vertices.find((vertex) => vertex.id === wall.a)
  const end = level.vertices.find((vertex) => vertex.id === wall.b)
  if (!start || !end) {
    return null
  }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy) || 1
  const center = { x: start.x + dx * opening.offset, y: start.y + dy * opening.offset }
  const along = { x: (dx / length) * (opening.width / 2), y: (dy / length) * (opening.width / 2) }
  return {
    a: { x: center.x - along.x, y: center.y - along.y },
    b: { x: center.x + along.x, y: center.y + along.y },
    center,
  }
}

export function offsetAlongWall(a: Point, b: Point, point: Point, width: number): number {
  const foot = footOnLine(point, a, b)
  const length = segmentLength(a, b)
  if (!foot || length === 0) {
    return 0.5
  }
  const half = Math.min(0.49, width / 2 / length)
  return Math.min(1 - half, Math.max(half, foot.t))
}
