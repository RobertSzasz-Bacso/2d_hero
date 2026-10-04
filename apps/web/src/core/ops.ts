import { add, dist, dot, jointAngleDeg, lineIntersect, mul, sub, unit } from "./geom.ts"
import type { Level, Opening, Plan, Point, Vertex } from "./plan-types.ts"
import { editorTolerances } from "./tolerances.ts"

export type DimensionRef =
  | { type: "vertex"; id: string }
  | { type: "opening"; id: string; edge: "start" | "end" }

export type OpeningPatch = Partial<
  Pick<Opening, "kind" | "offset" | "width" | "sill" | "head" | "swing" | "swingSide" | "confidence">
>

function clonePlan(plan: Plan): Plan {
  return structuredClone(plan)
}

function levelOf(plan: Plan, levelId: string): Level {
  const level = plan.levels.find((item) => item.id === levelId)
  if (!level) {
    throw new Error(`Unknown level ${levelId}`)
  }
  return level
}

function vertexOf(level: Level, id: string): Vertex {
  const vertex = level.vertices.find((item) => item.id === id)
  if (!vertex) {
    throw new Error(`Unknown vertex ${id}`)
  }
  return vertex
}

function wallLength(level: Level, wallId: string): number {
  const wall = level.walls.find((item) => item.id === wallId)
  if (!wall) {
    throw new Error(`Unknown wall ${wallId}`)
  }
  return dist(vertexOf(level, wall.a), vertexOf(level, wall.b))
}

export function moveWall(plan: Plan, levelId: string, wallId: string, delta: Point): Plan {
  const next = clonePlan(plan)
  const level = levelOf(next, levelId)
  const origin = levelOf(plan, levelId)
  const wall = level.walls.find((item) => item.id === wallId)
  if (!wall) {
    throw new Error(`Unknown wall ${wallId}`)
  }
  const start = vertexOf(origin, wall.a)
  const end = vertexOf(origin, wall.b)
  const direction = unit(sub(end, start))
  if (direction.x === 0 && direction.y === 0) {
    return next
  }
  const normal = { x: -direction.y, y: direction.x }
  const applied = mul(normal, dot(delta, normal))
  const run = collinearRun(origin, wallId)
  const ids = new Set<string>()
  for (const id of run) {
    const item = origin.walls.find((candidate) => candidate.id === id)
    if (!item) {
      continue
    }
    ids.add(item.a)
    ids.add(item.b)
  }
  for (const id of ids) {
    const original = vertexOf(origin, id)
    const updated = vertexOf(level, id)
    const neighbors = origin.walls.filter((item) => !run.has(item.id) && (item.a === id || item.b === id))
    const orthogonal = neighbors.find((item) => {
      const farId = item.a === id ? item.b : item.a
      const far = vertexOf(origin, farId)
      const runWall = origin.walls.find((candidate) => run.has(candidate.id) && (candidate.a === id || candidate.b === id))
      if (!runWall) {
        return false
      }
      const otherId = runWall.a === id ? runWall.b : runWall.a
      const angle = jointAngleDeg(original, vertexOf(origin, otherId), far)
      return Math.abs(angle - 90) <= editorTolerances.ortho_deg
    })
    if (!orthogonal) {
      updated.x = original.x + applied.x
      updated.y = original.y + applied.y
      continue
    }
    const far = vertexOf(origin, orthogonal.a === id ? orthogonal.b : orthogonal.a)
    const runWall = origin.walls.find((candidate) => run.has(candidate.id) && (candidate.a === id || candidate.b === id))
    const other = vertexOf(origin, runWall && runWall.a === id ? runWall.b : (runWall?.a ?? id))
    const runDir = unit(sub(other, original))
    const neighborDir = sub(original, far)
    const hit = lineIntersect(add(original, applied), runDir, far, neighborDir)
    updated.x = hit?.x ?? original.x + applied.x
    updated.y = hit?.y ?? original.y + applied.y
  }
  return next
}

function collinearRun(level: Level, wallId: string): Set<string> {
  const run = new Set<string>([wallId])
  const queue = [wallId]
  while (queue.length > 0) {
    const currentId = queue.pop()
    const wall = level.walls.find((item) => item.id === currentId)
    if (!wall) {
      continue
    }
    for (const end of [wall.a, wall.b]) {
      for (const other of level.walls) {
        if (run.has(other.id) || (other.a !== end && other.b !== end)) {
          continue
        }
        const here = vertexOf(level, end)
        const wallFar = vertexOf(level, wall.a === end ? wall.b : wall.a)
        const otherFar = vertexOf(level, other.a === end ? other.b : other.a)
        const angle = jointAngleDeg(here, wallFar, otherFar)
        if (Math.abs(angle - 180) <= editorTolerances.ortho_deg) {
          run.add(other.id)
          queue.push(other.id)
        }
      }
    }
  }
  return run
}

export function moveVertex(plan: Plan, levelId: string, vertexId: string, point: Point): Plan {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error("Vertex coordinates must be finite")
  }
  const next = clonePlan(plan)
  const vertex = vertexOf(levelOf(next, levelId), vertexId)
  vertex.x = point.x
  vertex.y = point.y
  return next
}

export function setWallThickness(plan: Plan, levelId: string, wallId: string, thickness: number): Plan {
  if (!(thickness > 0) || thickness > 1.5) {
    throw new Error("Wall thickness must be greater than 0 and at most 1.5 m")
  }
  const next = clonePlan(plan)
  const wall = levelOf(next, levelId).walls.find((item) => item.id === wallId)
  if (!wall) {
    throw new Error(`Unknown wall ${wallId}`)
  }
  wall.thickness = thickness
  return next
}

export function setRoomName(plan: Plan, levelId: string, roomId: string, name: string, number?: string): Plan {
  const next = clonePlan(plan)
  const room = levelOf(next, levelId).rooms.find((item) => item.id === roomId)
  if (!room) {
    throw new Error(`Unknown room ${roomId}`)
  }
  room.name = name
  if (number !== undefined) {
    room.number = number
  }
  return next
}

export function setOpening(plan: Plan, levelId: string, openingId: string, patch: OpeningPatch): Plan {
  const next = clonePlan(plan)
  const level = levelOf(next, levelId)
  const opening = level.openings.find((item) => item.id === openingId)
  if (!opening) {
    throw new Error(`Unknown opening ${openingId}`)
  }
  Object.assign(opening, patch)
  const length = wallLength(level, opening.wall)
  if (!(opening.width > 0) || opening.width >= length) {
    throw new Error("Opening width must be shorter than its wall")
  }
  if (opening.head <= opening.sill) {
    throw new Error("Opening head must be above the sill")
  }
  return next
}

function referencePoint(level: Level, ref: DimensionRef): Point {
  if (ref.type === "vertex") {
    return vertexOf(level, ref.id)
  }
  const opening = level.openings.find((item) => item.id === ref.id)
  if (!opening) {
    throw new Error(`Unknown opening ${ref.id}`)
  }
  const wall = level.walls.find((item) => item.id === opening.wall)
  if (!wall) {
    throw new Error(`Unknown wall ${opening.wall}`)
  }
  const a = vertexOf(level, wall.a)
  const b = vertexOf(level, wall.b)
  const span = sub(b, a)
  const length = Math.hypot(span.x, span.y)
  if (length === 0) {
    return a
  }
  const along = mul(span, 1 / length)
  const center = add(a, mul(span, opening.offset))
  const half = opening.width / 2
  return ref.edge === "start" ? add(center, mul(along, -half)) : add(center, mul(along, half))
}

export function applyTypedDimension(
  plan: Plan,
  levelId: string,
  segment: { a: DimensionRef; b: DimensionRef; lengthM: number },
): Plan {
  if (!(segment.lengthM > 0) || !Number.isFinite(segment.lengthM)) {
    throw new Error("Typed length must be a positive finite length")
  }
  const source = levelOf(plan, levelId)
  const anchor = referencePoint(source, segment.a)
  const moving = referencePoint(source, segment.b)
  const axis = unit(sub(moving, anchor))
  if (axis.x === 0 && axis.y === 0) {
    return clonePlan(plan)
  }
  const target = add(anchor, mul(axis, segment.lengthM))
  const delta = sub(target, moving)
  const limit = dot(moving, axis)
  const next = clonePlan(plan)
  const level = levelOf(next, levelId)
  const before = new Map(source.vertices.map((vertex) => [vertex.id, { x: vertex.x, y: vertex.y }]))
  for (const vertex of level.vertices) {
    const onB = segment.b.type === "vertex" && segment.b.id === vertex.id
    if (onB || dot(vertex, axis) >= limit) {
      vertex.x += delta.x
      vertex.y += delta.y
    }
  }
  for (const opening of level.openings) {
    const wall = level.walls.find((item) => item.id === opening.wall)
    if (!wall) {
      continue
    }
    const oldA = before.get(wall.a)
    const oldB = before.get(wall.b)
    const newA = vertexOf(level, wall.a)
    const newB = vertexOf(level, wall.b)
    if (!oldA || !oldB) {
      continue
    }
    const oldSpan = sub(oldB, oldA)
    const center = add(oldA, mul(oldSpan, opening.offset))
    const moved = dot(center, axis) >= limit ? add(center, delta) : center
    const newSpan = sub(newB, newA)
    const length = Math.hypot(newSpan.x, newSpan.y)
    if (length === 0) {
      continue
    }
    const offset = dot(sub(moved, newA), unit(newSpan)) / length
    opening.offset = Math.min(1, Math.max(0, offset))
  }
  if (segment.b.type === "opening") {
    const opening = level.openings.find((item) => item.id === segment.b.id)
    const wall = opening ? level.walls.find((item) => item.id === opening.wall) : undefined
    if (opening && wall) {
      const a = vertexOf(level, wall.a)
      const b = vertexOf(level, wall.b)
      const span = sub(b, a)
      const length = Math.hypot(span.x, span.y)
      if (length > 0) {
        const along = unit(span)
        const edge = target
        const half = opening.width / 2
        const center = segment.b.edge === "start" ? add(edge, mul(along, half)) : add(edge, mul(along, -half))
        opening.offset = Math.min(1, Math.max(0, dot(sub(center, a), along) / length))
      }
    }
  }
  return next
}
