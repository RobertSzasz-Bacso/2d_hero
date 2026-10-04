import { innerCornerOffset } from "@/core/draw.ts"
import { add, dist, dot, left, mul, sub, unit } from "@/core/geom.ts"
import type { DimensionRef } from "@/core/ops.ts"
import type { Level, Opening, Point } from "@/core/plan-types.ts"
import { openingEnds } from "./metrics.ts"

/** Shift lock: keep the larger of the two axis moves from the anchor. */
export function orthoLock(anchor: Point, point: Point): Point {
  return Math.abs(point.x - anchor.x) >= Math.abs(point.y - anchor.y) ? { x: point.x, y: anchor.y } : { x: anchor.x, y: point.y }
}

/** Length in metres and angle in degrees, counter-clockwise from +X, in [0, 360). */
export function lengthAngle(a: Point, b: Point): { length: number; angleDeg: number } {
  const length = dist(a, b)
  const raw = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  const angleDeg = Math.round((((raw % 360) + 360) % 360) * 1e9) / 1e9
  return { length, angleDeg: angleDeg === 360 ? 0 : angleDeg }
}

/** The far corner of a typed rectangle: width along X and depth along Y, toward the cursor. */
export function rectangleCorner(corner: Point, cursor: Point, widthM: number, depthM: number): Point {
  return {
    x: corner.x + (cursor.x < corner.x ? -widthM : widthM),
    y: corner.y + (cursor.y < corner.y ? -depthM : depthM),
  }
}

/** Corners of a wall body around a centerline, counter-clockwise for a→b along +X. */
export function wallBody(a: Point, b: Point, thickness: number): Point[] {
  const direction = unit(sub(b, a))
  const half = mul(left(direction), thickness / 2)
  return [sub(a, half), sub(b, half), add(b, half), add(a, half)]
}

export type OpeningGhost = {
  wallId: string
  /** Wall end whose inner corner is nearer the ghost. A typed distance is measured from it. */
  end: "a" | "b"
  offset: number
  width: number
  thickness: number
  start: Point
  finish: Point
  cornerStart: Point
  cornerEnd: Point
  normal: Point
  /** Clear distance from the inner corner at wall end a to the ghost's start edge. */
  distStart: number
  /** Clear distance from the ghost's end edge to the inner corner at wall end b. */
  distEnd: number
  swingSide: Opening["swingSide"]
}

/** A ghost opening of true width centred under the cursor, kept between the wall's inner corners. */
export function openingGhost(level: Level, wallId: string, cursor: Point, width: number): OpeningGhost | null {
  const wall = level.walls.find((item) => item.id === wallId)
  const a = wall ? level.vertices.find((vertex) => vertex.id === wall.a) : undefined
  const b = wall ? level.vertices.find((vertex) => vertex.id === wall.b) : undefined
  if (!wall || !a || !b) {
    return null
  }
  const length = dist(a, b)
  if (length === 0) {
    return null
  }
  const along = unit(sub(b, a))
  const normal = left(along)
  const low = innerCornerOffset(level, wallId, wall.a)
  const high = length - innerCornerOffset(level, wallId, wall.b)
  if (high - low < width) {
    return null
  }
  const center = Math.min(high - width / 2, Math.max(low + width / 2, dot(sub(cursor, a), along)))
  const distStart = center - width / 2 - low
  const distEnd = high - (center + width / 2)
  return {
    wallId,
    end: distStart <= distEnd ? "a" : "b",
    offset: center / length,
    width,
    thickness: wall.thickness,
    start: add(a, mul(along, center - width / 2)),
    finish: add(a, mul(along, center + width / 2)),
    cornerStart: add(a, mul(along, low)),
    cornerEnd: add(a, mul(along, high)),
    normal,
    distStart,
    distEnd,
    swingSide: dot(sub(cursor, a), normal) >= 0 ? "positive" : "negative",
  }
}

/** The nearest vertex or opening edge within `tolerance` of the point. */
export function dimensionRefAt(level: Level, point: Point, tolerance: number): { ref: DimensionRef; point: Point } | null {
  let best: { ref: DimensionRef; point: Point } | null = null
  let bestGap = tolerance
  for (const vertex of level.vertices) {
    const gap = dist(vertex, point)
    if (gap <= bestGap) {
      best = { ref: { type: "vertex", id: vertex.id }, point: { x: vertex.x, y: vertex.y } }
      bestGap = gap
    }
  }
  for (const opening of level.openings) {
    const ends = openingEnds(level, opening)
    if (!ends) {
      continue
    }
    for (const [edge, at] of [
      ["start", ends.a],
      ["end", ends.b],
    ] as const) {
      const gap = dist(at, point)
      if (gap <= bestGap) {
        best = { ref: { type: "opening", id: opening.id, edge }, point: { x: at.x, y: at.y } }
        bestGap = gap
      }
    }
  }
  return best
}

/** Signed distance of the click from the line a→b, along its left normal, as the scene draws it. */
export function dimensionOffset(a: Point, b: Point, click: Point): number {
  const direction = unit(sub(b, a))
  return dot(sub(click, a), left(direction))
}
