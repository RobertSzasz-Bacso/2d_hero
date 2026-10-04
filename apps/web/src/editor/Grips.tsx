import { add, mul, rotate } from "@/core/geom.ts"
import { parallelNeighbors, wallFrame } from "@/core/grips.ts"
import type { Level, Point } from "@/core/plan-types.ts"
import { formatDimension, placeSymbol } from "@/drawing/scene.ts"
import { planToScreen, type Camera } from "@/view/camera.ts"
import { openingEnds } from "./metrics.ts"
import type { SelectionItem } from "./select.ts"

export type GripSpec =
  | { kind: "wall-end"; wallId: string; vertexId: string }
  | { kind: "wall-middle"; wallId: string }
  | { kind: "wall-face"; wallId: string; face: "left" | "right" }
  | { kind: "opening-center"; openingId: string }
  | { kind: "opening-edge"; openingId: string; edge: "start" | "end" }
  | { kind: "fixture-rotate"; fixtureId: string }
  | { kind: "fixture-width"; fixtureId: string }
  | { kind: "fixture-depth"; fixtureId: string }

export type TempDimension = { id: "length" | "clear-left" | "clear-right"; wallId: string; otherId?: string; valueM: number; at: Point }

export type SnapGlyph = { at: Point; kind: string }

const GRIP = "#1d4ed8"
const TEMP = "#2563eb"

type Props = {
  level: Level
  camera: Camera
  selection: readonly SelectionItem[]
  unit: "cm" | "mm"
  snap: SnapGlyph | null
  onGripDown: (grip: GripSpec, event: React.PointerEvent) => void
  onTempDimension: (dimension: TempDimension) => void
  onFlip: (openingId: string, which: "hinge" | "side") => void
}

/** Screen direction of a plan vector. */
function screenDir(v: Point): Point {
  const length = Math.hypot(v.x, v.y) || 1
  return { x: v.x / length, y: -v.y / length }
}

function fmt(value: number): string {
  return value.toFixed(2)
}

function stop(event: React.PointerEvent) {
  event.stopPropagation()
}

export default function Grips({ level, camera, selection, unit, snap, onGripDown, onTempDimension, onFlip }: Props) {
  const nodes: React.ReactNode[] = []
  const only = selection.length === 1 ? selection[0] : undefined
  const toScreen = (point: Point) => planToScreen(camera, point)

  const square = (key: string, grip: GripSpec, name: string, at: Point) => (
    <rect
      key={key}
      x={fmt(at.x - 4.5)}
      y={fmt(at.y - 4.5)}
      width={9}
      height={9}
      fill="#fff"
      stroke={GRIP}
      strokeWidth={1.5}
      data-grip={name}
      style={{ cursor: "move" }}
      onPointerDown={(event) => onGripDown(grip, event)}
    />
  )
  const diamond = (key: string, grip: GripSpec, name: string, at: Point) => (
    <path
      key={key}
      d={`M${fmt(at.x)} ${fmt(at.y - 6)}L${fmt(at.x + 6)} ${fmt(at.y)}L${fmt(at.x)} ${fmt(at.y + 6)}L${fmt(at.x - 6)} ${fmt(at.y)}Z`}
      fill="#fff"
      stroke={GRIP}
      strokeWidth={1.5}
      data-grip={name}
      style={{ cursor: "move" }}
      onPointerDown={(event) => onGripDown(grip, event)}
    />
  )
  const triangle = (key: string, grip: GripSpec, name: string, at: Point, dir: Point, cursor: string) => {
    const tip = add(at, mul(dir, 5))
    const back = add(at, mul(dir, -4))
    const side = { x: -dir.y * 4.5, y: dir.x * 4.5 }
    return (
      <path
        key={key}
        d={`M${fmt(tip.x)} ${fmt(tip.y)}L${fmt(back.x + side.x)} ${fmt(back.y + side.y)}L${fmt(back.x - side.x)} ${fmt(back.y - side.y)}Z`}
        fill={GRIP}
        stroke="#fff"
        strokeWidth={1}
        data-grip={name}
        style={{ cursor }}
        onPointerDown={(event) => onGripDown(grip, event)}
      />
    )
  }

  const tempDimension = (dimension: TempDimension, from: Point, to: Point, label: Point) => {
    const text = formatDimension(dimension.valueM, unit)
    const width = Math.max(28, text.length * 7 + 8)
    return (
      <g key={dimension.id} pointerEvents="none">
        <path d={`M${fmt(from.x)} ${fmt(from.y)}L${fmt(to.x)} ${fmt(to.y)}`} stroke={TEMP} strokeWidth={1} fill="none" />
        <circle cx={fmt(from.x)} cy={fmt(from.y)} r={2} fill={TEMP} />
        <circle cx={fmt(to.x)} cy={fmt(to.y)} r={2} fill={TEMP} />
        <rect x={fmt(label.x - width / 2)} y={fmt(label.y - 9)} width={width} height={18} rx={3} fill="#fff" stroke={TEMP} strokeWidth={1} />
        <text
          x={fmt(label.x)}
          y={fmt(label.y)}
          fontSize={12}
          fill={TEMP}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="Helvetica, Arial, sans-serif"
          pointerEvents="all"
          style={{ cursor: "text" }}
          data-testid={`temp-dim-${dimension.id}`}
          onPointerDown={stop}
          onClick={() => onTempDimension({ ...dimension, at: label })}
        >
          {text}
        </text>
      </g>
    )
  }

  if (only?.kind === "wall") {
    let frame: ReturnType<typeof wallFrame> | null = null
    try {
      frame = wallFrame(level, only.id)
    } catch {
      frame = null
    }
    const wall = level.walls.find((item) => item.id === only.id)
    if (frame && wall) {
      const half = frame.thickness / 2
      const mid = add(frame.a, mul(frame.dir, frame.length / 2))
      const n = screenDir(frame.normal)
      const leftFace = add(toScreen(add(mid, mul(frame.normal, half))), mul(n, 7))
      const rightFace = add(toScreen(add(mid, mul(frame.normal, -half))), mul(n, -7))
      const lengthBase = add(toScreen(add(mid, mul(frame.normal, -half))), mul(n, -26))
      const aLine = add(toScreen(add(frame.a, mul(frame.normal, -half))), mul(n, -26))
      const bLine = add(toScreen(add(frame.b, mul(frame.normal, -half))), mul(n, -26))
      nodes.push(tempDimension({ id: "length", wallId: wall.id, valueM: frame.length, at: lengthBase }, aLine, bLine, lengthBase))
      const neighbors = parallelNeighbors(level, wall.id)
      for (const [side, entry] of [
        ["left", neighbors.left],
        ["right", neighbors.right],
      ] as const) {
        if (!entry) {
          continue
        }
        const sign = side === "left" ? 1 : -1
        const start = add(mid, mul(frame.normal, sign * half))
        const end = add(mid, mul(frame.normal, sign * (half + entry.clear)))
        const from = toScreen(start)
        const to = toScreen(end)
        const label = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
        nodes.push(tempDimension({ id: side === "left" ? "clear-left" : "clear-right", wallId: wall.id, otherId: entry.wallId, valueM: entry.clear, at: label }, from, to, label))
      }
      nodes.push(square("end-a", { kind: "wall-end", wallId: wall.id, vertexId: wall.a }, "end-a", toScreen(frame.a)))
      nodes.push(square("end-b", { kind: "wall-end", wallId: wall.id, vertexId: wall.b }, "end-b", toScreen(frame.b)))
      nodes.push(diamond("middle", { kind: "wall-middle", wallId: wall.id }, "middle", toScreen(mid)))
      nodes.push(triangle("face-left", { kind: "wall-face", wallId: wall.id, face: "left" }, "face-left", leftFace, n, "ns-resize"))
      nodes.push(triangle("face-right", { kind: "wall-face", wallId: wall.id, face: "right" }, "face-right", rightFace, mul(n, -1), "ns-resize"))
    }
  }

  if (only?.kind === "opening") {
    const opening = level.openings.find((item) => item.id === only.id)
    const ends = opening ? openingEnds(level, opening) : null
    const wall = opening ? level.walls.find((item) => item.id === opening.wall) : undefined
    if (opening && ends && wall) {
      const alongPlan = { x: ends.b.x - ends.a.x, y: ends.b.y - ends.a.y }
      const along = screenDir(alongPlan)
      const normalPlan = { x: -alongPlan.y, y: alongPlan.x }
      const swing = screenDir(mul(normalPlan, opening.swingSide === "positive" ? 1 : -1))
      const center = toScreen(ends.center)
      const halfPx = (wall.thickness / 2) * camera.pixelsPerMeter
      nodes.push(diamond("opening-center", { kind: "opening-center", openingId: opening.id }, "opening-center", center))
      nodes.push(triangle("opening-start", { kind: "opening-edge", openingId: opening.id, edge: "start" }, "opening-start", add(toScreen(ends.a), mul(along, -6)), mul(along, -1), "ew-resize"))
      nodes.push(triangle("opening-end", { kind: "opening-edge", openingId: opening.id, edge: "end" }, "opening-end", add(toScreen(ends.b), mul(along, 6)), along, "ew-resize"))
      if (opening.kind === "door") {
        const sideAt = add(center, mul(swing, -(halfPx + 20)))
        nodes.push(flipControl("flip-side", sideAt, swing, () => onFlip(opening.id, "side")))
        if (opening.swing === "left" || opening.swing === "right") {
          const hingeAt = add(sideAt, mul(along, 22))
          nodes.push(flipControl("flip-hinge", hingeAt, along, () => onFlip(opening.id, "hinge")))
        }
      }
    }
  }

  if (only?.kind === "fixture") {
    const fixture = level.fixtures.find((item) => item.id === only.id)
    if (fixture) {
      const localY = screenDir(rotate({ x: 0, y: 1 }, fixture.rotationDeg))
      const localX = screenDir(rotate({ x: 1, y: 0 }, fixture.rotationDeg))
      const back = add(toScreen(placeSymbol(fixture, { x: 0, y: 0.5 })), mul(localY, 16))
      const backEdge = toScreen(placeSymbol(fixture, { x: 0, y: 0.5 }))
      nodes.push(<path key="rotate-stem" d={`M${fmt(backEdge.x)} ${fmt(backEdge.y)}L${fmt(back.x)} ${fmt(back.y)}`} stroke={GRIP} strokeWidth={1} pointerEvents="none" />)
      nodes.push(
        <circle
          key="fixture-rotate"
          cx={fmt(back.x)}
          cy={fmt(back.y)}
          r={5}
          fill="#fff"
          stroke={GRIP}
          strokeWidth={1.5}
          data-grip="fixture-rotate"
          style={{ cursor: "grab" }}
          onPointerDown={(event) => onGripDown({ kind: "fixture-rotate", fixtureId: fixture.id }, event)}
        />,
      )
      nodes.push(triangle("fixture-width", { kind: "fixture-width", fixtureId: fixture.id }, "fixture-width", add(toScreen(placeSymbol(fixture, { x: 0.5, y: 0 })), mul(localX, 6)), localX, "ew-resize"))
      nodes.push(triangle("fixture-depth", { kind: "fixture-depth", fixtureId: fixture.id }, "fixture-depth", add(toScreen(placeSymbol(fixture, { x: 0, y: -0.5 })), mul(localY, -6)), mul(localY, -1), "ns-resize"))
    }
  }

  if (snap) {
    nodes.push(snapGlyph(snap))
  }
  return <g data-layer="grips">{nodes}</g>
}

function flipControl(testId: string, at: Point, dir: Point, onFlip: () => void) {
  const tip = add(at, mul(dir, 5))
  const tail = add(at, mul(dir, -5))
  const side = { x: -dir.y * 3, y: dir.x * 3 }
  const head = (point: Point, toward: Point) => {
    const base = add(point, mul(toward, -3))
    return `M${fmt(point.x)} ${fmt(point.y)}L${fmt(base.x + side.x)} ${fmt(base.y + side.y)}M${fmt(point.x)} ${fmt(point.y)}L${fmt(base.x - side.x)} ${fmt(base.y - side.y)}`
  }
  return (
    <g key={testId} data-testid={testId} role="button" style={{ cursor: "pointer" }} onPointerDown={stop} onClick={onFlip}>
      <circle cx={fmt(at.x)} cy={fmt(at.y)} r={8} fill="#fff" stroke={GRIP} strokeWidth={1} />
      <path
        d={`M${fmt(tail.x)} ${fmt(tail.y)}L${fmt(tip.x)} ${fmt(tip.y)}${head(tip, dir)}${head(tail, mul(dir, -1))}`}
        stroke={GRIP}
        strokeWidth={1.5}
        fill="none"
        pointerEvents="none"
      />
    </g>
  )
}

function snapGlyph(snap: SnapGlyph) {
  const { x, y } = snap.at
  const color = "#16a34a"
  let d = ""
  if (snap.kind === "vertex") {
    d = `M${fmt(x - 5)} ${fmt(y - 5)}h10v10h-10Z`
  } else if (snap.kind === "midpoint") {
    d = `M${fmt(x)} ${fmt(y - 6)}L${fmt(x + 6)} ${fmt(y + 4)}L${fmt(x - 6)} ${fmt(y + 4)}Z`
  } else if (snap.kind === "intersection") {
    d = `M${fmt(x - 5)} ${fmt(y - 5)}L${fmt(x + 5)} ${fmt(y + 5)}M${fmt(x + 5)} ${fmt(y - 5)}L${fmt(x - 5)} ${fmt(y + 5)}`
  } else if (snap.kind === "foot") {
    d = `M${fmt(x - 6)} ${fmt(y + 5)}h12M${fmt(x)} ${fmt(y + 5)}v-11M${fmt(x)} ${fmt(y)}h4v5`
  } else if (snap.kind === "grid") {
    d = `M${fmt(x - 5)} ${fmt(y)}h10M${fmt(x)} ${fmt(y - 5)}v10`
  } else {
    d = `M${fmt(x - 6)} ${fmt(y)}h12`
  }
  return (
    <g key="snap" data-snap-kind={snap.kind} pointerEvents="none">
      <path d={d} stroke={color} strokeWidth={1.5} fill="none" />
    </g>
  )
}
