import {
  addColumn,
  addDimension,
  addFixture,
  addRectangle,
  addRoomSeed,
  addSeparator,
  addStair,
  addTextLabel,
  addVertex,
  addWallFrom,
  placeOpeningAtDistance,
  splitWall,
  wallFromLocation,
  type RectangleMode,
  type WallLocation,
} from "@/core/draw.ts"
import { dist, lineIntersect, ringCentroid, sub } from "@/core/geom.ts"
import type { DimensionRef } from "@/core/ops.ts"
import { moveVertex } from "@/core/ops.ts"
import type { Fixture, Opening, Plan, Point } from "@/core/plan-types.ts"
import { editorTolerances } from "@/core/tolerances.ts"

/** A wall chain in progress. Face points are the clicked location line; vertices sit on the centerline. */
export type WallChain = {
  anchorId: string
  startId: string
  anchorFace: Point
  startFace: Point
  first: { from: Point; to: Point } | null
  previous: { from: Point; to: Point } | null
  count: number
}

function targetLevel(plan: Plan, levelId?: string): string {
  if (levelId && plan.levels.some((level) => level.id === levelId)) {
    return levelId
  }
  return plan.levels[0]?.id ?? "L1"
}

export function startWall(plan: Plan, point: Point, levelId?: string): { plan: Plan; chain: WallChain } {
  const added = addVertex(plan, targetLevel(plan, levelId), point)
  const level = added.plan.levels.find((item) => item.id === targetLevel(added.plan, levelId))
  const vertex = level?.vertices.find((item) => item.id === added.id)
  const face = vertex ? { x: vertex.x, y: vertex.y } : point
  return {
    plan: added.plan,
    chain: { anchorId: added.id, startId: added.id, anchorFace: face, startFace: face, first: null, previous: null, count: 0 },
  }
}

function corner(previous: { from: Point; to: Point }, next: { from: Point; to: Point }, thickness: number, location: WallLocation): Point | null {
  const before = wallFromLocation(previous.from, previous.to, thickness, location)
  const after = wallFromLocation(next.from, next.to, thickness, location)
  return lineIntersect(before.a, sub(before.b, before.a), after.a, sub(after.b, after.a))
}

/** Add the next wall of the chain to the location-line point `face`. Closing on the start face ends the chain. */
export function extendWallTo(
  plan: Plan,
  chain: WallChain,
  face: Point,
  thickness: number,
  location: WallLocation,
  levelId?: string,
): { plan: Plan; chain: WallChain | null } {
  const id = targetLevel(plan, levelId)
  if (dist(chain.anchorFace, face) <= 0.001) {
    throw new Error("The wall needs a length")
  }
  const segment = { from: chain.anchorFace, to: face }
  const closing = chain.count >= 2 && dist(face, chain.startFace) <= editorTolerances.join_snap_m
  let next = plan
  if (location !== "center") {
    const line = wallFromLocation(segment.from, segment.to, thickness, location)
    const anchorAt = chain.previous ? (corner(chain.previous, segment, thickness, location) ?? line.a) : line.a
    next = moveVertex(next, id, chain.anchorId, anchorAt)
    if (closing && chain.first) {
      const closeAt = corner(segment, chain.first, thickness, location) ?? line.b
      next = moveVertex(next, id, chain.startId, closeAt)
    }
  }
  const level = next.levels.find((item) => item.id === id)
  const anchor = level?.vertices.find((vertex) => vertex.id === chain.anchorId)
  if (!level || !anchor) {
    throw new Error("Click a start point first")
  }
  const end = location === "center" ? face : wallFromLocation(segment.from, segment.to, thickness, location).b
  const target = closing ? level.vertices.find((vertex) => vertex.id === chain.startId) : undefined
  const drawn = addWallFrom(next, id, chain.anchorId, target ? { x: target.x, y: target.y } : end, thickness)
  if (drawn.endId === chain.startId && chain.count >= 2) {
    const ring = drawn.plan.levels.find((item) => item.id === id)?.vertices ?? []
    const centroid = ringCentroid(ring)
    const seeded = level.rooms.some((room) => room.seed.x === centroid.x && room.seed.y === centroid.y)
    return { plan: seeded ? drawn.plan : addRoomSeed(drawn.plan, id, centroid, "Room", ""), chain: null }
  }
  return {
    plan: drawn.plan,
    chain: {
      anchorId: drawn.endId,
      startId: chain.startId,
      anchorFace: face,
      startFace: chain.startFace,
      first: chain.first ?? segment,
      previous: segment,
      count: chain.count + 1,
    },
  }
}

export function placeRectangle(plan: Plan, c1: Point, c2: Point, thickness: number, mode: RectangleMode, levelId?: string): Plan {
  return addRectangle(plan, targetLevel(plan, levelId), c1, c2, thickness, mode)
}

export function placeOpeningAt(
  plan: Plan,
  wallId: string,
  kind: Opening["kind"],
  end: "a" | "b",
  distance: number,
  width: number,
  swingSide: Opening["swingSide"],
  levelId?: string,
): Plan {
  return placeOpeningAtDistance(plan, targetLevel(plan, levelId), wallId, kind, end, distance, width, swingSide)
}

export function placeDimension(plan: Plan, refs: DimensionRef[], offset: number, levelId?: string): Plan {
  return addDimension(plan, targetLevel(plan, levelId), refs, offset)
}

export function placeColumn(plan: Plan, point: Point, levelId?: string): Plan {
  return addColumn(plan, targetLevel(plan, levelId), point)
}

export function placeStair(plan: Plan, point: Point, levelId?: string): Plan {
  return addStair(plan, targetLevel(plan, levelId), point)
}

export function placeText(plan: Plan, point: Point, levelId?: string): Plan {
  return addTextLabel(plan, targetLevel(plan, levelId), point)
}

export function placeFixture(plan: Plan, symbol: Fixture["symbol"], point: Point, rotationDeg = 0, levelId?: string): Plan {
  return addFixture(plan, targetLevel(plan, levelId), symbol, point, rotationDeg)
}

export function placeSeparator(plan: Plan, a: Point, b: Point, levelId?: string): Plan {
  return addSeparator(plan, targetLevel(plan, levelId), a, b)
}

export function placeSplit(plan: Plan, wallId: string, t: number, levelId?: string): Plan {
  const clamped = Math.min(0.95, Math.max(0.05, t))
  return splitWall(plan, targetLevel(plan, levelId), wallId, clamped)
}
