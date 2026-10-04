import { add, dist, dot, footOnLine, mul, rotate, segmentIntersect, unit } from "./geom.ts"
import type { Level, Plan, Point } from "./plan-types.ts"
import { editorTolerances } from "./tolerances.ts"

export type SnapKind = "vertex" | "midpoint" | "intersection" | "foot" | "extension" | "angle" | "grid"

export type SnapHit = {
  kind: SnapKind
  point: Point
  id?: string
}

type Candidate = SnapHit & { priority: number; distance: number }

const priority: Record<SnapKind, number> = {
  vertex: 1,
  midpoint: 2,
  intersection: 3,
  foot: 4,
  extension: 5,
  angle: 6,
  grid: 7,
}

function levelOf(plan: Plan, levelId: string): Level {
  const level = plan.levels.find((item) => item.id === levelId)
  if (!level) {
    throw new Error(`Unknown level ${levelId}`)
  }
  return level
}

function consider(list: Candidate[], kind: SnapKind, point: Point, cursor: Point, tolerance: number, id?: string) {
  const distance = dist(point, cursor)
  if (distance <= tolerance) {
    list.push({ kind, point, id, priority: priority[kind], distance })
  }
}

export function snapPoint(input: {
  plan: Plan
  levelId: string
  cursor: Point
  pixelsPerMeter: number
  gridM?: number
  previous?: { x: number; y: number; dirX: number; dirY: number }
}): SnapHit | null {
  if (!(input.pixelsPerMeter > 0)) {
    return null
  }
  const tolerance = editorTolerances.snap_px / input.pixelsPerMeter
  const level = levelOf(input.plan, input.levelId)
  const vertices = new Map(level.vertices.map((vertex) => [vertex.id, vertex]))
  const candidates: Candidate[] = []

  for (const vertex of level.vertices) {
    consider(candidates, "vertex", vertex, input.cursor, tolerance, vertex.id)
  }

  const segments: { id: string; a: Point; b: Point }[] = []
  for (const wall of level.walls) {
    const a = vertices.get(wall.a)
    const b = vertices.get(wall.b)
    if (!a || !b) {
      continue
    }
    segments.push({ id: wall.id, a, b })
    consider(candidates, "midpoint", { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, input.cursor, tolerance, wall.id)
    const foot = footOnLine(input.cursor, a, b)
    if (!foot) {
      continue
    }
    const length = dist(a, b)
    if (foot.t > 0 && foot.t < 1) {
      consider(candidates, "foot", foot.point, input.cursor, tolerance, wall.id)
    } else if (length > 0) {
      const past = foot.t < 0 ? -foot.t * length : (foot.t - 1) * length
      if (past > 0 && past <= editorTolerances.extension_max_m) {
        consider(candidates, "extension", foot.point, input.cursor, tolerance, wall.id)
      }
    }
  }

  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const left = segments[i]
      const right = segments[j]
      if (!left || !right) {
        continue
      }
      const hit = segmentIntersect(left.a, left.b, right.a, right.b)
      if (hit) {
        consider(candidates, "intersection", hit.point, input.cursor, tolerance, left.id)
      }
    }
  }

  if (input.previous) {
    const anchor = { x: input.previous.x, y: input.previous.y }
    const direction = unit({ x: input.previous.dirX, y: input.previous.dirY })
    if (direction.x !== 0 || direction.y !== 0) {
      for (const degrees of [0, 45, -45, 90, -90]) {
        const ray = rotate(direction, degrees)
        const travel = dot(subPoint(input.cursor, anchor), ray)
        if (travel < 0) {
          continue
        }
        consider(candidates, "angle", add(anchor, mul(ray, travel)), input.cursor, tolerance)
      }
    }
  }

  const grid = input.gridM ?? editorTolerances.grid_m
  if (grid > 0) {
    consider(
      candidates,
      "grid",
      { x: Math.round(input.cursor.x / grid) * grid, y: Math.round(input.cursor.y / grid) * grid },
      input.cursor,
      tolerance,
    )
  }

  candidates.sort((a, b) => a.priority - b.priority || a.distance - b.distance)
  const best = candidates[0]
  if (!best) {
    return null
  }
  return { kind: best.kind, point: best.point, id: best.id }
}

function subPoint(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}
