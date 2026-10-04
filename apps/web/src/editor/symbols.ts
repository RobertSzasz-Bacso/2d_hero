import type { Fixture, Point } from "@/core/plan-types.ts"

export const SYMBOLS: Fixture["symbol"][] = [
  "toilet",
  "sink",
  "bathtub",
  "shower",
  "kitchen-counter",
  "stove",
  "bed-double",
  "sofa",
  "table",
  "wardrobe",
  "block",
  "chair",
]

type Polyline = Point[]

function rect(x0: number, y0: number, x1: number, y1: number): Polyline {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: y0 },
  ]
}

function oval(cx: number, cy: number, rx: number, ry: number): Polyline {
  const points: Point[] = []
  for (let step = 0; step <= 16; step += 1) {
    const angle = (step / 16) * Math.PI * 2
    points.push({ x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry })
  }
  return points
}

function arc(cx: number, cy: number, radius: number, start: number, end: number): Polyline {
  const points: Point[] = []
  for (let step = 0; step <= 8; step += 1) {
    const angle = start + ((end - start) * step) / 8
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius })
  }
  return points
}

const shapes: Record<Fixture["symbol"], Polyline[]> = {
  toilet: [rect(-0.45, -0.5, 0.45, 0.05), oval(0, 0.22, 0.32, 0.28)],
  sink: [rect(-0.5, -0.4, 0.5, 0.4), oval(0, 0, 0.28, 0.22)],
  bathtub: [rect(-0.5, -0.5, 0.5, 0.5), arc(0, 0.2, 0.22, 0, Math.PI)],
  shower: [rect(-0.5, -0.5, 0.5, 0.5), [{ x: -0.5, y: -0.5 }, { x: 0.5, y: 0.5 }], [{ x: -0.5, y: 0.5 }, { x: 0.5, y: -0.5 }], arc(0.5, -0.5, 0.45, Math.PI, Math.PI * 1.5)],
  "kitchen-counter": [rect(-0.5, -0.5, 0.5, 0.5)],
  stove: [rect(-0.5, -0.5, 0.5, 0.5), oval(-0.2, -0.2, 0.12, 0.12), oval(0.2, -0.2, 0.12, 0.12), oval(-0.2, 0.2, 0.12, 0.12), oval(0.2, 0.2, 0.12, 0.12)],
  "bed-double": [rect(-0.5, -0.5, 0.5, 0.5), rect(-0.5, 0.25, 0.5, 0.5)],
  sofa: [rect(-0.5, -0.5, 0.5, 0.5), [{ x: -0.5, y: 0.2 }, { x: 0.5, y: 0.2 }]],
  table: [rect(-0.5, -0.5, 0.5, 0.5)],
  wardrobe: [rect(-0.5, -0.5, 0.5, 0.5), [{ x: -0.5, y: -0.5 }, { x: 0.5, y: 0.5 }], [{ x: -0.5, y: 0.5 }, { x: 0.5, y: -0.5 }]],
  block: [rect(-0.5, -0.5, 0.5, 0.5)],
  chair: [rect(-0.4, -0.5, 0.4, 0.15), arc(0, 0.15, 0.4, 0, Math.PI)],
}

export function symbolPolylines(symbol: Fixture["symbol"]): Polyline[] {
  return shapes[symbol]
}
