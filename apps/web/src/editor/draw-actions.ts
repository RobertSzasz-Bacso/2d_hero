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

export function startWall(plan: Plan, point: Point): { plan: Plan; chain: WallChain } {
  const added = addVertex(plan, "L1", point)
  return { plan: added.plan, chain: { anchorId: added.id, startId: added.id } }
}

export function extendWall(plan: Plan, chain: WallChain, lengthM: number, angleDeg: number): { plan: Plan; chain: WallChain | null } {
  const level = plan.levels[0]
  const start = level?.vertices.find((vertex) => vertex.id === chain.anchorId)
  if (!level || !start) {
    throw new Error("Click a start point first")
  }
  const next = addTypedWall(plan, level.id, start, lengthM, angleDeg)
  const drawn = next.levels[0]
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

export function placeOpening(plan: Plan, wallId: string, kind: "door" | "window" | "passage", offset: number): Plan {
  return addOpeningOnWall(plan, plan.levels[0]?.id ?? "L1", wallId, kind, offset)
}

export function placeColumn(plan: Plan, point: Point): Plan {
  return addColumn(plan, plan.levels[0]?.id ?? "L1", point)
}

export function placeStair(plan: Plan, point: Point): Plan {
  return addStair(plan, plan.levels[0]?.id ?? "L1", point)
}

export function placeText(plan: Plan, point: Point): Plan {
  return addTextLabel(plan, plan.levels[0]?.id ?? "L1", point)
}

export function placeFixture(plan: Plan, symbol: Fixture["symbol"], point: Point): Plan {
  return addFixture(plan, plan.levels[0]?.id ?? "L1", symbol, point)
}

export function placeSeparator(plan: Plan, a: Point, b: Point): Plan {
  return addSeparator(plan, plan.levels[0]?.id ?? "L1", a, b)
}

export function placeSplit(plan: Plan, wallId: string, t: number): Plan {
  const clamped = Math.min(0.95, Math.max(0.05, t))
  return splitWall(plan, plan.levels[0]?.id ?? "L1", wallId, clamped)
}
