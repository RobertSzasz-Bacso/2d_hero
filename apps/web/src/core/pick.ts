import RBush from "rbush"
import { dist, distanceToSegment, pointInRing } from "./geom.ts"
import type { Level, Plan, Point } from "./plan-types.ts"
import { extractRooms } from "./rooms.ts"

export type PickKind = "vertex" | "opening" | "column" | "fixture" | "wall" | "separator" | "text" | "room"

export type PickHit = {
  kind: PickKind
  id: string
  distance: number
}

type Indexed = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  kind: PickKind
  id: string
}

const rank: Record<PickKind, number> = {
  vertex: 0,
  opening: 1,
  column: 2,
  fixture: 3,
  wall: 4,
  separator: 5,
  text: 6,
  room: 7,
}

function levelOf(plan: Plan, levelId: string): Level {
  const level = plan.levels.find((item) => item.id === levelId)
  if (!level) {
    throw new Error(`Unknown level ${levelId}`)
  }
  return level
}

function box(point: Point, pad: number): Pick<Indexed, "minX" | "minY" | "maxX" | "maxY"> {
  return {
    minX: point.x - pad,
    minY: point.y - pad,
    maxX: point.x + pad,
    maxY: point.y + pad,
  }
}

function segmentBox(a: Point, b: Point, pad: number): Pick<Indexed, "minX" | "minY" | "maxX" | "maxY"> {
  return {
    minX: Math.min(a.x, b.x) - pad,
    minY: Math.min(a.y, b.y) - pad,
    maxX: Math.max(a.x, b.x) + pad,
    maxY: Math.max(a.y, b.y) + pad,
  }
}

export function pickAt(plan: Plan, levelId: string, point: Point, toleranceM: number): PickHit[] {
  const level = levelOf(plan, levelId)
  const vertices = new Map(level.vertices.map((vertex) => [vertex.id, vertex]))
  const items: Indexed[] = []
  for (const vertex of level.vertices) {
    items.push({ ...box(vertex, 0), kind: "vertex", id: vertex.id })
  }
  for (const wall of level.walls) {
    const a = vertices.get(wall.a)
    const b = vertices.get(wall.b)
    if (!a || !b) {
      continue
    }
    items.push({ ...segmentBox(a, b, wall.thickness / 2), kind: "wall", id: wall.id })
  }
  for (const opening of level.openings) {
    const wall = level.walls.find((item) => item.id === opening.wall)
    if (!wall) {
      continue
    }
    const a = vertices.get(wall.a)
    const b = vertices.get(wall.b)
    if (!a || !b) {
      continue
    }
    const dx = b.x - a.x
    const dy = b.y - a.y
    const center = { x: a.x + dx * opening.offset, y: a.y + dy * opening.offset }
    const half = opening.width / 2
    const length = Math.hypot(dx, dy) || 1
    const along = { x: (dx / length) * half, y: (dy / length) * half }
    items.push({
      ...segmentBox({ x: center.x - along.x, y: center.y - along.y }, { x: center.x + along.x, y: center.y + along.y }, wall.thickness / 2),
      kind: "opening",
      id: opening.id,
    })
  }
  for (const column of level.columns) {
    items.push({ ...box(column, Math.max(column.width, column.depth) / 2), kind: "column", id: column.id })
  }
  for (const fixture of level.fixtures) {
    items.push({ ...box(fixture, Math.max(fixture.width, fixture.depth) / 2), kind: "fixture", id: fixture.id })
  }
  for (const text of level.texts) {
    items.push({ ...box(text, text.heightM), kind: "text", id: text.id })
  }
  for (const separator of level.separators) {
    const a = vertices.get(separator.a)
    const b = vertices.get(separator.b)
    if (!a || !b) {
      continue
    }
    items.push({ ...segmentBox(a, b, 0), kind: "separator", id: separator.id })
  }
  const rooms = extractRooms(plan, levelId).rooms
  for (const room of rooms) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const vertex of room.polygon) {
      minX = Math.min(minX, vertex.x)
      minY = Math.min(minY, vertex.y)
      maxX = Math.max(maxX, vertex.x)
      maxY = Math.max(maxY, vertex.y)
    }
    items.push({ minX, minY, maxX, maxY, kind: "room", id: room.id })
  }

  const tree = new RBush<Indexed>()
  tree.load(items)
  const found = tree.search(box(point, toleranceM))
  const hits: PickHit[] = []
  for (const item of found) {
    const distance = preciseDistance(level, vertices, rooms, item, point)
    if (distance === null || (distance > toleranceM && !covers(item.kind, distance, level, item.id, toleranceM))) {
      continue
    }
    hits.push({ kind: item.kind, id: item.id, distance })
  }
  hits.sort((a, b) => rank[a.kind] - rank[b.kind] || a.distance - b.distance)
  return hits
}

function covers(kind: PickKind, distance: number, level: Level, id: string, toleranceM: number): boolean {
  if (kind !== "wall" && kind !== "opening") {
    return distance <= toleranceM
  }
  const wall = kind === "wall" ? level.walls.find((item) => item.id === id) : level.walls.find((item) => item.id === level.openings.find((opening) => opening.id === id)?.wall)
  const thickness = wall?.thickness ?? 0
  return distance <= thickness / 2 + toleranceM
}

function preciseDistance(
  level: Level,
  vertices: Map<string, Point>,
  rooms: { id: string; polygon: Point[] }[],
  item: Indexed,
  point: Point,
): number | null {
  if (item.kind === "vertex") {
    const vertex = vertices.get(item.id)
    return vertex ? dist(point, vertex) : null
  }
  if (item.kind === "wall" || item.kind === "separator") {
    const ends =
      item.kind === "wall"
        ? level.walls.find((wall) => wall.id === item.id)
        : level.separators.find((separator) => separator.id === item.id)
    if (!ends) {
      return null
    }
    const a = vertices.get(ends.a)
    const b = vertices.get(ends.b)
    if (!a || !b) {
      return null
    }
    return distanceToSegment(point, a, b)
  }
  if (item.kind === "opening") {
    const opening = level.openings.find((entry) => entry.id === item.id)
    const wall = opening ? level.walls.find((entry) => entry.id === opening.wall) : undefined
    if (!opening || !wall) {
      return null
    }
    const a = vertices.get(wall.a)
    const b = vertices.get(wall.b)
    if (!a || !b) {
      return null
    }
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy) || 1
    const center = { x: a.x + dx * opening.offset, y: a.y + dy * opening.offset }
    const half = opening.width / 2
    const along = { x: (dx / length) * half, y: (dy / length) * half }
    return distanceToSegment(point, { x: center.x - along.x, y: center.y - along.y }, { x: center.x + along.x, y: center.y + along.y })
  }
  if (item.kind === "room") {
    const room = rooms.find((entry) => entry.id === item.id)
    if (!room) {
      return null
    }
    return pointInRing(point, room.polygon) ? 0 : distanceToSegmentRing(point, room.polygon)
  }
  if (item.kind === "column") {
    const column = level.columns.find((entry) => entry.id === item.id)
    return column ? dist(point, column) : null
  }
  if (item.kind === "fixture") {
    const fixture = level.fixtures.find((entry) => entry.id === item.id)
    return fixture ? dist(point, fixture) : null
  }
  const text = level.texts.find((entry) => entry.id === item.id)
  return text ? dist(point, text) : null
}

function distanceToSegmentRing(point: Point, ring: Point[]): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (!a || !b) {
      continue
    }
    best = Math.min(best, distanceToSegment(point, a, b))
  }
  return best
}
