import { pointInRing } from "@/core/geom.ts"
import type { SelectionKind } from "@/core/grips.ts"
import type { Plan, Point } from "@/core/plan-types.ts"
import { extractRooms } from "@/core/rooms.ts"
import { wallPolygons } from "@/core/wall-polygons.ts"
import { columnRing, openingRect, placeSymbol } from "@/drawing/scene.ts"

export type SelectionItem = {
  kind: SelectionKind
  id: string
}

export type BoxMode = "window" | "crossing"

export type PlanRect = { minX: number; minY: number; maxX: number; maxY: number }

export function sameSelection(a: SelectionItem, b: SelectionItem): boolean {
  return a.kind === b.kind && a.id === b.id
}

export function toggleItem(items: readonly SelectionItem[], item: SelectionItem, shift: boolean): SelectionItem[] {
  if (!shift) {
    return [item]
  }
  const index = items.findIndex((entry) => sameSelection(entry, item))
  if (index >= 0) {
    return items.filter((_, itemIndex) => itemIndex !== index)
  }
  return [...items, item]
}

/**
 * Box selection. `window` takes items whose whole shape is inside the box.
 * `crossing` also takes items whose shape touches it.
 */
export function itemsInBox(plan: Plan, levelId: string, rect: PlanRect, mode: BoxMode): SelectionItem[] {
  const level = plan.levels.find((item) => item.id === levelId)
  if (!level) {
    return []
  }
  const inside = (point: Point) => point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY
  const corners: Point[] = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ]
  const segmentTouches = (a: Point, b: Point) =>
    inside(a) || inside(b) || corners.some((corner, index) => segmentsIntersect(a, b, corner, corners[(index + 1) % 4] as Point))
  const takes = (points: readonly Point[], closed: boolean): boolean => {
    if (points.length === 0) {
      return false
    }
    if (mode === "window") {
      return points.every(inside)
    }
    const count = closed ? points.length : points.length - 1
    for (let index = 0; index < count; index += 1) {
      if (segmentTouches(points[index] as Point, points[(index + 1) % points.length] as Point)) {
        return true
      }
    }
    if (points.length === 1) {
      return inside(points[0] as Point)
    }
    return closed && corners.some((corner) => pointInRing(corner, points))
  }

  const vertices = new Map(level.vertices.map((vertex) => [vertex.id, vertex]))
  const selected: SelectionItem[] = []
  for (const vertex of level.vertices) {
    if (inside(vertex)) {
      selected.push({ kind: "vertex", id: vertex.id })
    }
  }
  for (const polygon of wallPolygons(plan, levelId)) {
    if (takes(polygon.ring, true)) {
      selected.push({ kind: "wall", id: polygon.wallId })
    }
  }
  for (const opening of level.openings) {
    const ring = openingRect(level, opening)
    if (ring && takes(ring, true)) {
      selected.push({ kind: "opening", id: opening.id })
    }
  }
  for (const column of level.columns) {
    if (takes(columnRing(column), true)) {
      selected.push({ kind: "column", id: column.id })
    }
  }
  for (const fixture of level.fixtures) {
    const square = [
      { x: -0.5, y: -0.5 },
      { x: 0.5, y: -0.5 },
      { x: 0.5, y: 0.5 },
      { x: -0.5, y: 0.5 },
    ].map((point) => placeSymbol(fixture, point))
    if (takes(square, true)) {
      selected.push({ kind: "fixture", id: fixture.id })
    }
  }
  for (const separator of level.separators) {
    const a = vertices.get(separator.a)
    const b = vertices.get(separator.b)
    if (a && b && takes([a, b], false)) {
      selected.push({ kind: "separator", id: separator.id })
    }
  }
  for (const text of level.texts) {
    if (inside(text)) {
      selected.push({ kind: "text", id: text.id })
    }
  }
  for (const room of extractRooms(plan, levelId).rooms) {
    if (takes(room.polygon, true)) {
      selected.push({ kind: "room", id: room.id })
    }
  }
  for (const stair of level.stairs) {
    if (takes(stair.outline, true)) {
      selected.push({ kind: "stair", id: stair.id })
    }
  }
  return selected
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const orient = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  return o1 * o2 <= 0 && o3 * o4 <= 0 && Math.min(a.x, b.x) <= Math.max(c.x, d.x) && Math.min(c.x, d.x) <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= Math.max(c.y, d.y) && Math.min(c.y, d.y) <= Math.max(a.y, b.y)
}
