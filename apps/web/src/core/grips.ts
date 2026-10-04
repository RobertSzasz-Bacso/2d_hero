import { add, dot, footOnLine, left, mul, sub } from "./geom.ts"
import { moveWall, setOpening } from "./ops.ts"
import type { Level, Plan, Point, Vertex, Wall } from "./plan-types.ts"
import { editorTolerances } from "./tolerances.ts"

export type SelectionKind = "vertex" | "wall" | "opening" | "column" | "fixture" | "text" | "room" | "separator" | "stair" | "dimension"

export type FaceKeep = "left" | "right" | "center"

function levelOf(plan: Plan, levelId: string): Level {
  const level = plan.levels.find((item) => item.id === levelId)
  if (!level) {
    throw new Error(`Unknown level ${levelId}`)
  }
  return level
}

function wallOf(level: Level, wallId: string): Wall {
  const wall = level.walls.find((item) => item.id === wallId)
  if (!wall) {
    throw new Error(`Unknown wall ${wallId}`)
  }
  return wall
}

function vertexOf(level: Level, id: string): Vertex {
  const vertex = level.vertices.find((item) => item.id === id)
  if (!vertex) {
    throw new Error(`Unknown vertex ${id}`)
  }
  return vertex
}

/** Centerline frame of a wall: start, unit direction, left normal, and length. */
export function wallFrame(level: Level, wallId: string): { a: Point; b: Point; dir: Point; normal: Point; length: number; thickness: number } {
  const wall = wallOf(level, wallId)
  const a = vertexOf(level, wall.a)
  const b = vertexOf(level, wall.b)
  const span = sub(b, a)
  const length = Math.hypot(span.x, span.y)
  if (length === 0) {
    throw new Error(`Wall ${wallId} has no length`)
  }
  const dir = mul(span, 1 / length)
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, dir, normal: left(dir), length, thickness: wall.thickness }
}

/** Change thickness while the kept face (or the centerline) stays where it is. */
export function setWallThicknessFromFace(plan: Plan, levelId: string, wallId: string, thickness: number, keep: FaceKeep): Plan {
  if (!(thickness > 0) || thickness > 1.5) {
    throw new Error("Wall thickness must be greater than 0 and at most 1.5 m")
  }
  const frame = wallFrame(levelOf(plan, levelId), wallId)
  const shift = (frame.thickness - thickness) / 2
  const moved = keep === "center" ? plan : moveWall(plan, levelId, wallId, mul(frame.normal, keep === "left" ? shift : -shift))
  const next = moved === plan ? structuredClone(plan) : moved
  wallOf(levelOf(next, levelId), wallId).thickness = thickness
  return next
}

/** Face-to-face distance from a wall to a parallel wall, signed by the wall's left normal. */
export function clearDistance(level: Level, wallId: string, otherId: string): { clear: number; side: number } {
  const frame = wallFrame(level, wallId)
  const other = wallFrame(level, otherId)
  const cos = Math.abs(dot(frame.dir, other.dir))
  if (Math.acos(Math.min(1, cos)) * (180 / Math.PI) > editorTolerances.ortho_deg) {
    throw new Error("The two walls are not parallel")
  }
  const d = dot(sub(other.a, frame.a), frame.normal)
  return { clear: Math.abs(d) - frame.thickness / 2 - other.thickness / 2, side: Math.sign(d) }
}

/** Move a wall so the clear distance to a parallel wall becomes `distance`. */
export function setClearDistance(plan: Plan, levelId: string, wallId: string, otherId: string, distance: number): Plan {
  if (!(distance > 0) || !Number.isFinite(distance)) {
    throw new Error("Clear distance must be greater than 0")
  }
  const level = levelOf(plan, levelId)
  const { clear, side } = clearDistance(level, wallId, otherId)
  if (side === 0) {
    throw new Error("The two walls share a centerline")
  }
  const frame = wallFrame(level, wallId)
  return moveWall(plan, levelId, wallId, mul(frame.normal, -side * (distance - clear)))
}

/** Grow (or shrink) an opening by moving one edge. The other edge stays. */
export function setOpeningEdge(plan: Plan, levelId: string, openingId: string, edge: "start" | "end", amountM: number): Plan {
  const level = levelOf(plan, levelId)
  const opening = level.openings.find((item) => item.id === openingId)
  if (!opening) {
    throw new Error(`Unknown opening ${openingId}`)
  }
  const frame = wallFrame(level, opening.wall)
  const width = opening.width + amountM
  const centerM = opening.offset * frame.length + (edge === "end" ? amountM / 2 : -amountM / 2)
  if (!(width > 0) || centerM - width / 2 < -1e-9 || centerM + width / 2 > frame.length + 1e-9) {
    throw new Error("The opening must stay on its wall")
  }
  return setOpening(plan, levelId, openingId, { width, offset: centerM / frame.length })
}

/** Move an opening onto another wall, centered at the foot of `point`. */
export function rehostOpening(plan: Plan, levelId: string, openingId: string, wallId: string, point: Point): Plan {
  const level = levelOf(plan, levelId)
  const opening = level.openings.find((item) => item.id === openingId)
  if (!opening) {
    throw new Error(`Unknown opening ${openingId}`)
  }
  const frame = wallFrame(level, wallId)
  if (opening.width >= frame.length) {
    throw new Error("The opening is wider than that wall")
  }
  const foot = footOnLine(point, frame.a, frame.b)
  const half = opening.width / 2 / frame.length
  const t = Math.min(1 - half, Math.max(half, foot?.t ?? 0.5))
  const next = structuredClone(plan)
  const moved = levelOf(next, levelId).openings.find((item) => item.id === openingId)
  if (moved) {
    moved.wall = wallId
    moved.offset = t
  }
  return next
}

/** Move every selected item by exactly `delta`. Openings ride on their walls. */
export function moveSelection(plan: Plan, levelId: string, items: readonly { kind: SelectionKind; id: string }[], delta: Point): Plan {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    throw new Error("Move must be finite")
  }
  const next = structuredClone(plan)
  const level = levelOf(next, levelId)
  const ids = (kind: SelectionKind) => new Set(items.filter((item) => item.kind === kind).map((item) => item.id))
  const vertexIds = ids("vertex")
  for (const wall of level.walls) {
    if (ids("wall").has(wall.id)) {
      vertexIds.add(wall.a)
      vertexIds.add(wall.b)
    }
  }
  for (const separator of level.separators) {
    if (ids("separator").has(separator.id)) {
      vertexIds.add(separator.a)
      vertexIds.add(separator.b)
    }
  }
  const shift = (point: { x: number; y: number }) => {
    point.x += delta.x
    point.y += delta.y
  }
  level.vertices.filter((vertex) => vertexIds.has(vertex.id)).forEach(shift)
  const fixtures = ids("fixture")
  level.fixtures.filter((item) => fixtures.has(item.id)).forEach(shift)
  const columns = ids("column")
  level.columns.filter((item) => columns.has(item.id)).forEach(shift)
  const texts = ids("text")
  level.texts.filter((item) => texts.has(item.id)).forEach(shift)
  const stairs = ids("stair")
  level.stairs.filter((item) => stairs.has(item.id)).forEach((stair) => stair.outline.forEach(shift))
  const rooms = ids("room")
  level.rooms.filter((item) => rooms.has(item.id)).forEach((room) => shift(room.seed))
  return next
}

/** Grip rotation: multiples of 15° unless `free`. */
export function snapRotation(rotationDeg: number, free: boolean): number {
  if (free) {
    return rotationDeg
  }
  return Math.round(rotationDeg / 15) * 15
}

/** Turn a fixture's back (local +Y) to the nearest wall face within `toleranceM`, touching it. */
export function snapFixtureToWall(plan: Plan, levelId: string, fixtureId: string, toleranceM: number): Plan {
  const level = levelOf(plan, levelId)
  const fixture = level.fixtures.find((item) => item.id === fixtureId)
  if (!fixture) {
    throw new Error(`Unknown fixture ${fixtureId}`)
  }
  const center = { x: fixture.x, y: fixture.y }
  let best: { gap: number; back: number; into: Point } | null = null
  for (const wall of level.walls) {
    const frame = wallFrame(level, wall.id)
    const foot = footOnLine(center, frame.a, frame.b)
    if (!foot || foot.t < 0 || foot.t > 1) {
      continue
    }
    const s = dot(sub(center, frame.a), frame.normal)
    const gap = Math.abs(s) - frame.thickness / 2
    if (s === 0 || gap <= 0) {
      continue
    }
    const back = gap - fixture.depth / 2
    if (Math.abs(back) > toleranceM) {
      continue
    }
    if (!best || gap < best.gap) {
      best = { gap, back, into: mul(frame.normal, Math.sign(s)) }
    }
  }
  if (!best) {
    return plan
  }
  const next = structuredClone(plan)
  const moved = levelOf(next, levelId).fixtures.find((item) => item.id === fixtureId)
  if (moved) {
    const placed = add(center, mul(best.into, -best.back))
    moved.x = placed.x
    moved.y = placed.y
    const angle = (Math.atan2(best.into.x, -best.into.y) * 180) / Math.PI
    moved.rotationDeg = ((angle % 360) + 360) % 360
  }
  return next
}

export type ParallelNeighbor = { wallId: string; clear: number }

/** Nearest parallel wall on each side of a wall whose span overlaps it, for temporary dimensions. */
export function parallelNeighbors(level: Level, wallId: string): { left: ParallelNeighbor | null; right: ParallelNeighbor | null } {
  const frame = wallFrame(level, wallId)
  let leftBest: ParallelNeighbor | null = null
  let rightBest: ParallelNeighbor | null = null
  for (const other of level.walls) {
    if (other.id === wallId) {
      continue
    }
    let measured: { clear: number; side: number }
    try {
      measured = clearDistance(level, wallId, other.id)
    } catch {
      continue
    }
    if (measured.side === 0 || measured.clear <= 0) {
      continue
    }
    const span = wallFrame(level, other.id)
    const u0 = dot(sub(span.a, frame.a), frame.dir)
    const u1 = dot(sub(span.b, frame.a), frame.dir)
    if (Math.max(u0, u1) <= 0 || Math.min(u0, u1) >= frame.length) {
      continue
    }
    const entry = { wallId: other.id, clear: measured.clear }
    if (measured.side > 0 && (!leftBest || entry.clear < leftBest.clear)) {
      leftBest = entry
    }
    if (measured.side < 0 && (!rightBest || entry.clear < rightBest.clear)) {
      rightBest = entry
    }
  }
  return { left: leftBest, right: rightBest }
}
