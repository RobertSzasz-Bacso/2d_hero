import {
  addColumn,
  addFixture,
  addOpeningOnWall,
  addRoomSeed,
  addSeparator,
  addStair,
  addTextLabel,
  addTypedWall,
  addVertex,
  splitWall,
} from "@/core/draw.ts"
import type { Fixture, Plan, Point } from "@/core/plan-types.ts"
import { ringCentroid } from "@/core/geom.ts"

export type WallChain = {
  anchorId: string
  startId: string
}

function targetLevel(plan: Plan, levelId?: string): string {
  if (levelId && plan.levels.some((level) => level.id === levelId)) {
    return levelId
  }
  return plan.levels[0]?.id ?? "L1"
}

export function startWall(plan: Plan, point: Point, levelId?: string): { plan: Plan; chain: WallChain } {
  const added = addVertex(plan, targetLevel(plan, levelId), point)
  return { plan: added.plan, chain: { anchorId: added.id, startId: added.id } }
}

export function extendWall(
  plan: Plan,
  chain: WallChain,
  lengthM: number,
  angleDeg: number,
  levelId?: string,
): { plan: Plan; chain: WallChain | null } {
  const id = targetLevel(plan, levelId)
  const level = plan.levels.find((item) => item.id === id)
  const start = level?.vertices.find((vertex) => vertex.id === chain.anchorId)
  if (!level || !start) {
    throw new Error("Click a start point first")
  }
  const next = addTypedWall(plan, level.id, start, lengthM, angleDeg)
  const drawn = next.levels.find((item) => item.id === level.id)
  const wall = drawn?.walls[drawn.walls.length - 1]
  const endId = wall?.b
  if (!drawn || !endId) {
    throw new Error("The wall was not created")
  }
  if (endId === chain.startId && drawn.walls.length >= 3) {
    const centroid = ringCentroid(drawn.vertices)
    const seeded = drawn.rooms.some((room) => room.seed.x === centroid.x && room.seed.y === centroid.y)
      ? next
      : addRoomSeed(next, drawn.id, centroid, "Room", "")
    return { plan: seeded, chain: null }
  }
  return { plan: next, chain: { anchorId: endId, startId: chain.startId } }
}

export function placeOpening(
  plan: Plan,
  wallId: string,
  kind: "door" | "window" | "passage",
  offset: number,
  levelId?: string,
): Plan {
  return addOpeningOnWall(plan, targetLevel(plan, levelId), wallId, kind, offset)
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

export function placeFixture(plan: Plan, symbol: Fixture["symbol"], point: Point, levelId?: string): Plan {
  return addFixture(plan, targetLevel(plan, levelId), symbol, point)
}

export function placeSeparator(plan: Plan, a: Point, b: Point, levelId?: string): Plan {
  return addSeparator(plan, targetLevel(plan, levelId), a, b)
}

export function placeSplit(plan: Plan, wallId: string, t: number, levelId?: string): Plan {
  const clamped = Math.min(0.95, Math.max(0.05, t))
  return splitWall(plan, targetLevel(plan, levelId), wallId, clamped)
}
