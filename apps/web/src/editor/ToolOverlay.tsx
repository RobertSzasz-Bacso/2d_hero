import { wallFromLocation, symbolSize, type RectangleMode, type WallLocation } from "@/core/draw.ts"
import { add, dist, left, mul, sub, unit as direction } from "@/core/geom.ts"
import type { Fixture, Opening, Point } from "@/core/plan-types.ts"
import { formatDimension, placeSymbol } from "@/drawing/scene.ts"
import { planToScreen, type Camera } from "@/view/camera.ts"
import { symbolPolylines } from "./symbols.ts"
import { dimensionOffset, lengthAngle, wallBody, type OpeningGhost } from "./tool-math.ts"

export type ToolPreview = {
  wall?: { from: Point; to: Point; thickness: number; location: WallLocation }
  rect?: { from: Point; to: Point; thickness: number; mode: RectangleMode }
  ghost?: OpeningGhost & { kind: Opening["kind"] }
  dimension?: { points: Point[]; cursor: Point }
  symbol?: { symbol: Fixture["symbol"]; at: Point; rotationDeg: number }
  guides?: { from: Point; to: Point }[]
}

const TEMP = "#2563eb"
const GHOST = "#1d4ed8"

function fmt(value: number): string {
  return value.toFixed(2)
}

function pathOf(points: Point[], closed = true): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${fmt(point.x)},${fmt(point.y)}`).join(" ") + (closed ? " Z" : "")
}

function Label({ at, text, testId }: { at: Point; text: string; testId?: string }) {
  return (
    <text
      x={fmt(at.x)}
      y={fmt(at.y)}
      fill={TEMP}
      fontSize={12}
      textAnchor="middle"
      dominantBaseline="middle"
      stroke="white"
      strokeWidth={3}
      paintOrder="stroke"
      data-testid={testId}
    >
      {text}
    </text>
  )
}

/** Live previews for the drawing tools, in screen pixels like the grips. */
export default function ToolOverlay({ preview, camera, unit }: { preview: ToolPreview; camera: Camera; unit: "cm" | "mm" }) {
  const toScreen = (point: Point) => planToScreen(camera, point)
  const nodes: React.ReactNode[] = []

  for (const [index, guide] of (preview.guides ?? []).entries()) {
    const a = toScreen(guide.from)
    const b = toScreen(guide.to)
    nodes.push(
      <line key={`guide-${index}`} x1={fmt(a.x)} y1={fmt(a.y)} x2={fmt(b.x)} y2={fmt(b.y)} stroke={TEMP} strokeWidth={1} strokeDasharray="4 3" data-testid="alignment-guide" />,
    )
  }

  const wall = preview.wall
  if (wall && dist(wall.from, wall.to) > 1e-6) {
    const line = wallFromLocation(wall.from, wall.to, wall.thickness, wall.location)
    const body = wallBody(line.a, line.b, wall.thickness).map(toScreen)
    const { length, angleDeg } = lengthAngle(wall.from, wall.to)
    const a = toScreen(wall.from)
    const b = toScreen(wall.to)
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const along = direction(sub(b, a))
    const at = add(middle, mul({ x: along.y, y: -along.x }, 18 + (wall.thickness * camera.pixelsPerMeter) / 2))
    nodes.push(
      <g key="wall" pointerEvents="none">
        <path d={pathOf(body)} fill="#111827" fillOpacity={0.85} data-testid="wall-preview" />
        <line x1={fmt(a.x)} y1={fmt(a.y)} x2={fmt(b.x)} y2={fmt(b.y)} stroke={TEMP} strokeWidth={1} strokeDasharray="6 3" />
        <Label at={at} text={`${formatDimension(length, unit)} · ${Math.round(angleDeg * 10) / 10}°`} testId="wall-preview-label" />
      </g>,
    )
  }

  const rect = preview.rect
  if (rect) {
    const inner = rect.mode === "interior" ? 0 : rect.thickness / 2
    const outer = rect.mode === "interior" ? rect.thickness : rect.thickness / 2
    const minX = Math.min(rect.from.x, rect.to.x)
    const minY = Math.min(rect.from.y, rect.to.y)
    const maxX = Math.max(rect.from.x, rect.to.x)
    const maxY = Math.max(rect.from.y, rect.to.y)
    const box = (grow: number) =>
      [
        { x: minX - grow, y: minY - grow },
        { x: maxX + grow, y: minY - grow },
        { x: maxX + grow, y: maxY + grow },
        { x: minX - grow, y: maxY + grow },
      ].map(toScreen)
    const hollow = maxX - minX > 2 * inner && maxY - minY > 2 * inner
    const top = toScreen({ x: (minX + maxX) / 2, y: maxY + outer })
    nodes.push(
      <g key="rect" pointerEvents="none" data-testid="rect-preview">
        <path d={`${pathOf(box(outer))} ${hollow ? pathOf(box(-inner)) : ""}`} fill="#111827" fillOpacity={0.85} fillRule="evenodd" />
        <path d={pathOf(box(0))} fill="none" stroke={TEMP} strokeWidth={1} strokeDasharray="6 3" />
        <Label at={{ x: top.x, y: top.y - 12 }} text={`${formatDimension(maxX - minX, unit)} × ${formatDimension(maxY - minY, unit)}`} testId="rect-preview-label" />
      </g>,
    )
  }

  const ghost = preview.ghost
  if (ghost) {
    const half = mul(ghost.normal, ghost.thickness / 2)
    const outline = [sub(ghost.start, half), sub(ghost.finish, half), add(ghost.finish, half), add(ghost.start, half)].map(toScreen)
    const side = ghost.swingSide === "positive" ? 1 : -1
    const swing = mul(ghost.normal, side)
    const leaf = add(ghost.start, mul(swing, ghost.width))
    const s = toScreen(ghost.start)
    const l = toScreen(leaf)
    const f = toScreen(ghost.finish)
    const radius = ghost.width * camera.pixelsPerMeter
    const sweep = side > 0 ? 0 : 1
    const away = mul(ghost.normal, -side * (ghost.thickness / 2 + 14 / camera.pixelsPerMeter))
    const labelStart = toScreen(add(mul(add(ghost.cornerStart, ghost.start), 0.5), away))
    const labelEnd = toScreen(add(mul(add(ghost.finish, ghost.cornerEnd), 0.5), away))
    nodes.push(
      <g key="ghost" pointerEvents="none" data-testid="opening-ghost" data-end={ghost.end} data-swing-side={ghost.swingSide}>
        <path d={pathOf(outline)} fill="white" stroke={GHOST} strokeWidth={1.5} />
        {ghost.kind === "door" ? (
          <>
            <line x1={fmt(s.x)} y1={fmt(s.y)} x2={fmt(l.x)} y2={fmt(l.y)} stroke={GHOST} strokeWidth={1} />
            <path d={`M${fmt(l.x)},${fmt(l.y)} A${fmt(radius)},${fmt(radius)} 0 0 ${sweep} ${fmt(f.x)},${fmt(f.y)}`} fill="none" stroke={GHOST} strokeWidth={1} strokeDasharray="4 2" />
          </>
        ) : null}
        <Label at={labelStart} text={formatDimension(ghost.distStart, unit)} testId="ghost-dist-start" />
        <Label at={labelEnd} text={formatDimension(ghost.distEnd, unit)} testId="ghost-dist-end" />
      </g>,
    )
  }

  const dimension = preview.dimension
  if (dimension && dimension.points.length > 0) {
    const [first, second] = dimension.points
    const markers = dimension.points.map(toScreen)
    let drawn: React.ReactNode = null
    if (first && second && dist(first, second) > 1e-9) {
      const offset = dimensionOffset(first, second, dimension.cursor)
      const shift = mul(left(direction(sub(second, first))), offset)
      const a = toScreen(add(first, shift))
      const b = toScreen(add(second, shift))
      const fa = toScreen(first)
      const fb = toScreen(second)
      drawn = (
        <g data-testid="dimension-preview">
          <line x1={fmt(fa.x)} y1={fmt(fa.y)} x2={fmt(a.x)} y2={fmt(a.y)} stroke={TEMP} strokeWidth={1} />
          <line x1={fmt(fb.x)} y1={fmt(fb.y)} x2={fmt(b.x)} y2={fmt(b.y)} stroke={TEMP} strokeWidth={1} />
          <line x1={fmt(a.x)} y1={fmt(a.y)} x2={fmt(b.x)} y2={fmt(b.y)} stroke={TEMP} strokeWidth={1} />
          <Label at={{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 10 }} text={formatDimension(dist(first, second), unit)} />
        </g>
      )
    } else if (first) {
      const a = toScreen(first)
      const c = toScreen(dimension.cursor)
      drawn = <line x1={fmt(a.x)} y1={fmt(a.y)} x2={fmt(c.x)} y2={fmt(c.y)} stroke={TEMP} strokeWidth={1} strokeDasharray="4 3" />
    }
    nodes.push(
      <g key="dimension" pointerEvents="none">
        {drawn}
        {markers.map((point, index) => (
          <circle key={index} cx={fmt(point.x)} cy={fmt(point.y)} r={4} fill="white" stroke={TEMP} strokeWidth={1.5} />
        ))}
      </g>,
    )
  }

  const symbol = preview.symbol
  if (symbol) {
    const size = symbolSize(symbol.symbol)
    const fixture = { x: symbol.at.x, y: symbol.at.y, rotationDeg: symbol.rotationDeg, width: size.width, depth: size.depth }
    nodes.push(
      <g key="symbol" pointerEvents="none" data-testid="symbol-ghost" data-rotation={symbol.rotationDeg}>
        {symbolPolylines(symbol.symbol).map((line, index) => (
          <polyline
            key={index}
            points={line.map((point) => {
              const at = toScreen(placeSymbol({ ...fixture, id: "", symbol: symbol.symbol, confidence: 1, role: "furniture" }, point))
              return `${fmt(at.x)},${fmt(at.y)}`
            }).join(" ")}
            fill="none"
            stroke={GHOST}
            strokeWidth={1}
          />
        ))}
      </g>,
    )
  }

  return <g data-testid="tool-overlay">{nodes}</g>
}
