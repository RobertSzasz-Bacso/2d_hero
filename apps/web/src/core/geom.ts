import type { Point } from "./plan-types.ts"

/** Float noise for parallel and on-segment tests. Not a design tolerance. */
const floatEps = 1e-9

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function mul(a: Point, scale: number): Point {
  return { x: a.x * scale, y: a.y * scale }
}

export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y
}

export function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x
}

export function hypot(a: Point): number {
  return Math.hypot(a.x, a.y)
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function unit(a: Point): Point {
  const length = hypot(a)
  if (length === 0) {
    return { x: 0, y: 0 }
  }
  return { x: a.x / length, y: a.y / length }
}

/** Left normal of a direction. Plan Y is up, so this is counter-clockwise. */
export function left(direction: Point): Point {
  return { x: -direction.y, y: direction.x }
}

export function right(direction: Point): Point {
  return { x: direction.y, y: -direction.x }
}

export function samePoint(a: Point, b: Point, eps = floatEps): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps
}

export function lineIntersect(origin: Point, direction: Point, otherOrigin: Point, otherDirection: Point): Point | null {
  const denom = cross(direction, otherDirection)
  if (Math.abs(denom) < floatEps) {
    return null
  }
  const delta = sub(otherOrigin, origin)
  const t = cross(delta, otherDirection) / denom
  return add(origin, mul(direction, t))
}

export function footOnLine(point: Point, origin: Point, end: Point): { point: Point; t: number } | null {
  const delta = sub(end, origin)
  const length2 = dot(delta, delta)
  if (length2 === 0) {
    return null
  }
  const t = dot(sub(point, origin), delta) / length2
  return { point: add(origin, mul(delta, t)), t }
}

export function segmentIntersect(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): { point: Point; t: number; u: number } | null {
  const ab = sub(b, a)
  const cd = sub(d, c)
  const denom = cross(ab, cd)
  if (Math.abs(denom) < floatEps) {
    return null
  }
  const ac = sub(c, a)
  const t = cross(ac, cd) / denom
  const u = cross(ac, ab) / denom
  if (t < -floatEps || t > 1 + floatEps || u < -floatEps || u > 1 + floatEps) {
    return null
  }
  return { point: add(a, mul(ab, t)), t, u }
}

export function ringArea(ring: readonly Point[]): number {
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

export function pointInRing(point: Point, ring: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]
    const b = ring[j]
    if (!a || !b || a.y === b.y) {
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

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const foot = footOnLine(point, a, b)
  if (!foot) {
    return dist(point, a)
  }
  const t = Math.min(1, Math.max(0, foot.t))
  const projected = add(a, mul(sub(b, a), t))
  return dist(point, projected)
}

export function closestOnRing(point: Point, ring: readonly Point[]): Point {
  let best = ring[0] ?? point
  let bestDist = dist(point, best)
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (!a || !b) {
      continue
    }
    const foot = footOnLine(point, a, b)
    const t = foot ? Math.min(1, Math.max(0, foot.t)) : 0
    const projected = add(a, mul(sub(b, a), t))
    const gap = dist(point, projected)
    if (gap < bestDist) {
      best = projected
      bestDist = gap
    }
  }
  return best
}

export function ringCentroid(ring: readonly Point[]): Point {
  if (ring.length === 0) {
    return { x: 0, y: 0 }
  }
  let x = 0
  let y = 0
  for (const point of ring) {
    x += point.x
    y += point.y
  }
  return { x: x / ring.length, y: y / ring.length }
}

export function dedupeRing(ring: Point[]): Point[] {
  const out: Point[] = []
  for (const point of ring) {
    const prev = out[out.length - 1]
    if (!prev || !samePoint(prev, point)) {
      out.push(point)
    }
  }
  if (out.length > 1 && samePoint(out[0] as Point, out[out.length - 1] as Point)) {
    out.pop()
  }
  return out
}

export function rotate(direction: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: direction.x * cos - direction.y * sin,
    y: direction.x * sin + direction.y * cos,
  }
}

export function jointAngleDeg(vertex: Point, leftPoint: Point, rightPoint: Point): number {
  const a = unit(sub(leftPoint, vertex))
  const b = unit(sub(rightPoint, vertex))
  const cos = Math.min(1, Math.max(-1, dot(a, b)))
  return (Math.acos(cos) * 180) / Math.PI
}
