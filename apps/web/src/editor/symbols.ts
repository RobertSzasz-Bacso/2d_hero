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

export const SYMBOL_LABELS: Record<Fixture["symbol"], string> = {
  toilet: "Toilet",
  sink: "Sink",
  bathtub: "Bathtub",
  shower: "Shower",
  "kitchen-counter": "Counter",
  stove: "Stove",
  "bed-double": "Double bed",
  sofa: "Sofa",
  table: "Table",
  wardrobe: "Wardrobe",
  block: "Block",
  chair: "Chair",
}

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

function roundRect(x0: number, y0: number, x1: number, y1: number, radius: number): Polyline {
  const r = Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2)
  const corners = [
    { cx: x1 - r, cy: y0 + r, start: -Math.PI / 2 },
    { cx: x1 - r, cy: y1 - r, start: 0 },
    { cx: x0 + r, cy: y1 - r, start: Math.PI / 2 },
    { cx: x0 + r, cy: y0 + r, start: Math.PI },
  ]
  const points: Point[] = []
  for (const corner of corners) {
    for (let step = 0; step <= 4; step += 1) {
      const angle = corner.start + (step / 4) * (Math.PI / 2)
      points.push({ x: corner.cx + Math.cos(angle) * r, y: corner.cy + Math.sin(angle) * r })
    }
  }
  const first = points[0]
  if (first) {
    points.push({ ...first })
  }
  return points
}

function oval(cx: number, cy: number, rx: number, ry: number): Polyline {
  const points: Point[] = []
  for (let step = 0; step <= 24; step += 1) {
    const angle = (step / 24) * Math.PI * 2
    points.push({ x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry })
  }
  return points
}

function arc(cx: number, cy: number, radius: number, start: number, end: number): Polyline {
  const points: Point[] = []
  for (let step = 0; step <= 12; step += 1) {
    const angle = start + ((end - start) * step) / 12
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius })
  }
  return points
}

function line(x0: number, y0: number, x1: number, y1: number): Polyline {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ]
}

function burner(cx: number, cy: number): Polyline[] {
  return [oval(cx, cy, 0.17, 0.17), oval(cx, cy, 0.08, 0.08)]
}

const shapes: Record<Fixture["symbol"], Polyline[]> = {
  toilet: [rect(-0.45, 0.22, 0.45, 0.5), oval(0, -0.14, 0.36, 0.36), oval(0, -0.17, 0.22, 0.24)],
  sink: [rect(-0.5, -0.5, 0.5, 0.5), roundRect(-0.36, -0.38, 0.36, 0.22, 0.12), oval(0, 0.34, 0.06, 0.06)],
  bathtub: [rect(-0.5, -0.5, 0.5, 0.5), roundRect(-0.42, -0.4, 0.42, 0.4, 0.2), oval(-0.3, 0, 0.04, 0.04)],
  shower: [
    rect(-0.5, -0.5, 0.5, 0.5),
    line(-0.5, -0.5, 0.5, 0.5),
    line(-0.5, 0.5, 0.5, -0.5),
    oval(0, 0, 0.07, 0.07),
    arc(-0.5, -0.5, 0.5, 0, Math.PI / 2),
  ],
  "kitchen-counter": [rect(-0.5, -0.5, 0.5, 0.5), line(-0.5, -0.4, 0.5, -0.4)],
  stove: [rect(-0.5, -0.5, 0.5, 0.5), ...burner(-0.24, -0.22), ...burner(0.24, -0.22), ...burner(-0.24, 0.22), ...burner(0.24, 0.22)],
  "bed-double": [
    rect(-0.5, -0.5, 0.5, 0.5),
    roundRect(-0.44, 0.24, -0.04, 0.44, 0.05),
    roundRect(0.04, 0.24, 0.44, 0.44, 0.05),
    line(-0.5, 0.12, 0.5, 0.12),
    line(0.5, -0.12, 0.12, -0.5),
  ],
  sofa: [
    rect(-0.5, 0.2, 0.5, 0.5),
    rect(-0.5, -0.5, -0.36, 0.2),
    rect(0.36, -0.5, 0.5, 0.2),
    roundRect(-0.36, -0.46, -0.12, 0.2, 0.04),
    roundRect(-0.12, -0.46, 0.12, 0.2, 0.04),
    roundRect(0.12, -0.46, 0.36, 0.2, 0.04),
  ],
  table: [rect(-0.5, -0.5, 0.5, 0.5), rect(-0.44, -0.44, 0.44, 0.44)],
  wardrobe: [
    rect(-0.5, -0.5, 0.5, 0.5),
    line(-0.46, 0.05, 0.46, 0.05),
    line(-0.34, -0.3, -0.26, 0.4),
    line(-0.12, -0.3, -0.04, 0.4),
    line(0.08, -0.3, 0.16, 0.4),
    line(0.28, -0.3, 0.36, 0.4),
  ],
  block: [rect(-0.5, -0.5, 0.5, 0.5)],
  chair: [roundRect(-0.4, -0.5, 0.4, 0.25, 0.08), rect(-0.45, 0.3, 0.45, 0.5)],
}

export function symbolPolylines(symbol: Fixture["symbol"]): Polyline[] {
  return shapes[symbol]
}
