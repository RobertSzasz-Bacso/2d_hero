import { describe, expect, it } from "vitest"
import { ringArea } from "@/core/geom.ts"
import type { Level, Plan, Point } from "@/core/plan-types.ts"
import { wallPolygons } from "@/core/wall-polygons.ts"
import { buildScene, type SceneItem } from "./scene.ts"

function twoRoomLevel(): Level {
  return {
    id: "L1",
    name: "Ground",
    elevation: 0,
    ceilingHeight: 2.7,
    vertices: [
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: 5, y: 0 },
      { id: "v3", x: 10, y: 0 },
      { id: "v4", x: 10, y: 4 },
      { id: "v5", x: 5, y: 4 },
      { id: "v6", x: 0, y: 4 },
    ],
    walls: [
      { id: "w1", a: "v1", b: "v2", thickness: 0.2, kind: "exterior", confidence: 1 },
      { id: "w2", a: "v2", b: "v3", thickness: 0.2, kind: "exterior", confidence: 1 },
      { id: "w3", a: "v3", b: "v4", thickness: 0.2, kind: "exterior", confidence: 1 },
      { id: "w4", a: "v4", b: "v5", thickness: 0.2, kind: "exterior", confidence: 1 },
      { id: "w5", a: "v5", b: "v6", thickness: 0.2, kind: "exterior", confidence: 1 },
      { id: "w6", a: "v6", b: "v1", thickness: 0.2, kind: "exterior", confidence: 1 },
      { id: "w7", a: "v2", b: "v5", thickness: 0.2, kind: "partition", confidence: 1 },
    ],
    openings: [
      { id: "o1", wall: "w1", kind: "door", offset: 0.5, width: 0.9, sill: 0, head: 2.1, swing: "left", swingSide: "positive", confidence: 1 },
      { id: "o2", wall: "w5", kind: "window", offset: 0.5, width: 1.2, sill: 0.9, head: 2.1, swing: "none", swingSide: "positive", confidence: 1 },
    ],
    columns: [],
    stairs: [],
    rooms: [
      { id: "r1", name: "Living", number: "01", seed: { x: 2.5, y: 2 } },
      { id: "r2", name: "Kitchen", number: "02", seed: { x: 7.5, y: 2 } },
    ],
    separators: [],
    fixtures: [],
    texts: [],
    dimensions: [],
    suppressedAutoDimensions: [],
  }
}

function planOf(level: Level): Plan {
  return {
    schemaVersion: 2,
    units: "m",
    revision: 0,
    project: { name: "Golden", address: "", northAngleDeg: 0 },
    sheet: {
      paper: "A3",
      orientation: "landscape",
      scale: 50,
      titleBlock: { company: "", project: "Golden", address: "", drawnBy: "", date: "", sheetTitle: "", sheetNumber: "01", revisionNote: "" },
    },
    detection: { source: null, issues: [] },
    levels: [level],
  }
}

function itemsOf(scene: SceneItem[], kind: string, id: string): SceneItem[] {
  return scene.filter((item) => item.element?.kind === kind && item.element.id === id)
}

function strokes(items: SceneItem[]): Extract<SceneItem, { type: "stroke" }>[] {
  return items.filter((item): item is Extract<SceneItem, { type: "stroke" }> => item.type === "stroke")
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

describe("scene builder", () => {
  const level = twoRoomLevel()
  const plan = planOf(level)
  const scene = buildScene(plan, level, { scale: 50, unit: "cm", hideFurniture: false })

  it("gives each door a swing arc whose radius is the leaf width", () => {
    const door = strokes(itemsOf(scene, "opening", "o1"))
    const leaf = door.find((item) => item.part === "leaf")
    const swing = door.find((item) => item.part === "swing")
    expect(leaf).toBeDefined()
    expect(swing).toBeDefined()
    const hinge = leaf?.points[0]
    if (!hinge || !swing) {
      return
    }
    for (const point of swing.points) {
      expect(Math.abs(dist(point, hinge) - 0.9)).toBeLessThanOrEqual(0.001)
    }
  })

  it("gives each window two 0.25 mm glass lines and one 0.13 mm center line", () => {
    const window = strokes(itemsOf(scene, "opening", "o2"))
    expect(window.filter((item) => item.part === "glass" && item.weightMm === 0.25)).toHaveLength(2)
    expect(window.filter((item) => item.part === "glass-center" && item.weightMm === 0.13)).toHaveLength(1)
  })

  it("cuts the openings out of solid black poche", () => {
    const polygons = new Map(wallPolygons(plan, level.id).map((polygon) => [polygon.wallId, polygon.ring]))
    for (const wall of level.walls) {
      const fills = itemsOf(scene, "wall", wall.id).filter((item): item is Extract<SceneItem, { type: "fill" }> => item.type === "fill")
      expect(fills.length).toBeGreaterThan(0)
      const area = fills.reduce((sum, fill) => {
        const [outer, ...holes] = fill.rings
        return sum + Math.abs(ringArea(outer ?? [])) - holes.reduce((inner, hole) => inner + Math.abs(ringArea(hole)), 0)
      }, 0)
      const cut = level.openings.filter((opening) => opening.wall === wall.id).reduce((sum, opening) => sum + opening.width * wall.thickness, 0)
      expect(Math.abs(area - (Math.abs(ringArea(polygons.get(wall.id) ?? [])) - cut))).toBeLessThanOrEqual(0.001)
    }
  })

  it("tags every item that belongs to an element and keeps cut lines at 0.50 mm", () => {
    const cuts = strokes(scene).filter((item) => item.role === "cut-wall")
    expect(cuts.length).toBeGreaterThan(0)
    expect(cuts.every((item) => item.weightMm === 0.5 && item.element !== null)).toBe(true)
    const rooms = scene.filter((item) => item.type === "text" && item.role === "room")
    expect(rooms.map((item) => (item.type === "text" ? item.text : "")).filter((text) => text === "Living" || text === "Kitchen")).toHaveLength(2)
  })
})
