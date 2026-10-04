import type { Level, Point } from "@/core/plan-types.ts"
import { openingEnds } from "./metrics.ts"

export type SelectionItem = {
  kind: "vertex" | "wall" | "opening" | "column" | "fixture" | "text" | "room" | "separator" | "stair"
  id: string
}

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

export function itemsInPlanRect(level: Level, rect: { minX: number; minY: number; maxX: number; maxY: number }): SelectionItem[] {
  const inside = (point: Point) => point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY
  const vertices = new Map(level.vertices.map((vertex) => [vertex.id, vertex]))
  const selected: SelectionItem[] = []
  for (const vertex of level.vertices) {
    if (inside(vertex)) {
      selected.push({ kind: "vertex", id: vertex.id })
    }
  }
  for (const opening of level.openings) {
    const ends = openingEnds(level, opening)
    if (ends && inside(ends.center)) {
      selected.push({ kind: "opening", id: opening.id })
    }
  }
  for (const column of level.columns) {
    if (inside(column)) {
      selected.push({ kind: "column", id: column.id })
    }
  }
  for (const fixture of level.fixtures) {
    if (inside(fixture)) {
      selected.push({ kind: "fixture", id: fixture.id })
    }
  }
  for (const wall of level.walls) {
    const a = vertices.get(wall.a)
    const b = vertices.get(wall.b)
    if (a && b && inside({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) {
      selected.push({ kind: "wall", id: wall.id })
    }
  }
  for (const separator of level.separators) {
    const a = vertices.get(separator.a)
    const b = vertices.get(separator.b)
    if (a && b && inside({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) {
      selected.push({ kind: "separator", id: separator.id })
    }
  }
  for (const text of level.texts) {
    if (inside(text)) {
      selected.push({ kind: "text", id: text.id })
    }
  }
  for (const room of level.rooms) {
    if (inside(room.seed)) {
      selected.push({ kind: "room", id: room.id })
    }
  }
  for (const stair of level.stairs) {
    const center = stairCenter(stair.outline)
    if (center && inside(center)) {
      selected.push({ kind: "stair", id: stair.id })
    }
  }
  return selected
}

function stairCenter(outline: readonly Point[]): Point | null {
  if (outline.length === 0) {
    return null
  }
  let x = 0
  let y = 0
  for (const point of outline) {
    x += point.x
    y += point.y
  }
  return { x: x / outline.length, y: y / outline.length }
}
