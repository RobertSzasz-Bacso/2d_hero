import {
  add,
  closestOnRing,
  dist,
  mul,
  pointInRing,
  ringArea,
  ringCentroid,
  samePoint,
  segmentIntersect,
  sub,
  unit,
} from "./geom.ts"
import type { Issue, Plan, Point, Room } from "./plan-types.ts"
import { editorTolerances } from "./tolerances.ts"
import { freeFaces, wallPolygons } from "./wall-polygons.ts"

export type ComputedRoom = {
  id: string
  name: string
  number: string
  seed: Point
  polygon: Point[]
  area: number
}

export type RoomExtract = {
  rooms: ComputedRoom[]
  issues: Issue[]
}

type Face = {
  ring: Point[]
  area: number
}

function splitRing(ring: Point[], a: Point, b: Point): Point[][] | null {
  const hits: { point: Point; edge: number; t: number }[] = []
  for (let i = 0; i < ring.length; i += 1) {
    const start = ring[i]
    const end = ring[(i + 1) % ring.length]
    if (!start || !end) {
      continue
    }
    const hit = segmentIntersect(a, b, start, end)
    if (!hit) {
      continue
    }
    if (hits.some((item) => samePoint(item.point, hit.point, 1e-8))) {
      continue
    }
    hits.push({ point: hit.point, edge: i, t: hit.t })
  }
  if (hits.length < 2) {
    return null
  }
  hits.sort((left, right) => left.t - right.t)
  const first = hits[0]
  const second = hits[hits.length - 1]
  if (!first || !second || samePoint(first.point, second.point, 1e-8)) {
    return null
  }
  return [arc(ring, first, second), arc(ring, second, first)]
}

function arc(
  ring: Point[],
  from: { point: Point; edge: number },
  to: { point: Point; edge: number },
): Point[] {
  const points: Point[] = [from.point]
  const count = ring.length
  let index = (from.edge + 1) % count
  const stop = (to.edge + 1) % count
  let guard = 0
  while (index !== stop && guard <= count) {
    const vertex = ring[index]
    if (vertex && !samePoint(vertex, points[points.length - 1] as Point)) {
      points.push(vertex)
    }
    index = (index + 1) % count
    guard += 1
  }
  if (!samePoint(points[points.length - 1] as Point, to.point)) {
    points.push(to.point)
  }
  return points
}

function cutFaces(plan: Plan, levelId: string, faces: Face[]): Face[] {
  const level = plan.levels.find((item) => item.id === levelId)
  if (!level) {
    return faces
  }
  const vertices = new Map(level.vertices.map((vertex) => [vertex.id, { x: vertex.x, y: vertex.y }]))
  let current = faces
  for (const separator of level.separators) {
    const a = vertices.get(separator.a)
    const b = vertices.get(separator.b)
    if (!a || !b) {
      continue
    }
    const next: Face[] = []
    for (const face of current) {
      const parts = splitRing(face.ring, a, b)
      if (!parts) {
        next.push(face)
        continue
      }
      for (const ring of parts) {
        const area = Math.abs(ringArea(ring))
        if (ring.length >= 3 && area > 0) {
          next.push({ ring, area })
        }
      }
    }
    current = next
  }
  return current
}

function placeInside(ring: Point[], seed: Point): Point {
  if (pointInRing(seed, ring)) {
    return seed
  }
  const boundary = closestOnRing(seed, ring)
  const centroid = ringCentroid(ring)
  const toward = sub(centroid, boundary)
  const length = Math.hypot(toward.x, toward.y)
  if (length === 0) {
    return pointInRing(centroid, ring) ? centroid : boundary
  }
  const nudge = Math.min(length * 0.5, editorTolerances.join_snap_m)
  const moved = add(boundary, mul(unit(toward), nudge))
  if (pointInRing(moved, ring)) {
    return moved
  }
  return pointInRing(centroid, ring) ? centroid : moved
}

function issue(levelId: string, roomId: string, code: Issue["code"], message: string): Issue {
  return {
    id: `i-${code}-${roomId}`.slice(0, 32),
    severity: "warning",
    code,
    message,
    levelId,
    elementId: roomId,
  }
}

export function extractRooms(plan: Plan, levelId: string): RoomExtract {
  const level = plan.levels.find((item) => item.id === levelId)
  if (!level) {
    throw new Error(`Unknown level ${levelId}`)
  }
  const polygons = wallPolygons(plan, levelId)
  let faces: Face[] = freeFaces(polygons)
    .map((ring) => ({ ring, area: Math.abs(ringArea(ring)) }))
    .filter((face) => face.area >= editorTolerances.min_room_m2)
  faces = cutFaces(plan, levelId, faces).filter((face) => face.area >= editorTolerances.min_room_m2)

  const rooms: ComputedRoom[] = []
  const issues: Issue[] = []
  const occupied = new Map<number, Room[]>()

  for (const room of level.rooms) {
    const inside = faces.findIndex((face) => pointInRing(room.seed, face.ring))
    if (inside >= 0) {
      const list = occupied.get(inside) ?? []
      list.push(room)
      occupied.set(inside, list)
      continue
    }
    let nearest = -1
    let nearestGap = Number.POSITIVE_INFINITY
    for (let index = 0; index < faces.length; index += 1) {
      const face = faces[index]
      if (!face) {
        continue
      }
      const gap = dist(room.seed, closestOnRing(room.seed, face.ring))
      if (gap < nearestGap) {
        nearest = index
        nearestGap = gap
      }
    }
    if (nearest >= 0 && nearestGap <= editorTolerances.seed_search_m) {
      const list = occupied.get(nearest) ?? []
      list.push(room)
      occupied.set(nearest, list)
      continue
    }
    issues.push(issue(levelId, room.id, "room_seed_lost", "The room seed is not inside a free face."))
  }

  for (const [index, seeds] of occupied) {
    const face = faces[index]
    if (!face) {
      continue
    }
    if (seeds.length > 1) {
      issues.push(issue(levelId, seeds[0]?.id ?? "room", "room_not_split", "Two room seeds are in the same face."))
    }
    for (const seedRoom of seeds) {
      rooms.push({
        id: seedRoom.id,
        name: seedRoom.name,
        number: seedRoom.number,
        seed: placeInside(face.ring, seedRoom.seed),
        polygon: face.ring,
        area: face.area,
      })
    }
  }

  return { rooms, issues }
}
