import { memo, useMemo } from "react"
import type { Level, Plan, Point } from "@/core/plan-types.ts"
import { extractRooms } from "@/core/rooms.ts"
import { editorTolerances } from "@/core/tolerances.ts"
import { wallPolygons } from "@/core/wall-polygons.ts"
import { buildScene, openingRect, placeSymbol, type SceneElement, type SceneItem } from "@/drawing/scene.ts"
import { planToScreen, type Camera } from "@/view/camera.ts"
import { pxPerPaperMm, screenStrokePx, screenTextPx } from "@/view/screen.ts"
import { formatMetre, segmentLength, wallAngleDeg } from "./metrics.ts"
import type { SelectionItem } from "./select.ts"

export const HOVER_COLOR = "#3b82f6"
export const SELECT_COLOR = "#1d4ed8"
const PREVIEW_COLOR = "#ea580c"
const INK = "#000"

export type PlanSvgProps = {
  plan: Plan
  level: Level
  camera: Camera
  width: number
  height: number
  unit: "cm" | "mm"
  hideFurniture: boolean
  selection: readonly SelectionItem[]
  hover: SceneElement | null
  preview: Plan | null
  aiChanged: ReadonlySet<string>
  onElementDown: (element: SceneElement, event: React.PointerEvent) => void
  onVertexDown: (vertexId: string, event: React.PointerEvent) => void
  onDimensionText: (dimensionId: string, segmentIndex: number, at: Point) => void
  onHover: (element: SceneElement | null) => void
  children?: React.ReactNode
}

type Stroke = Extract<SceneItem, { type: "stroke" }>
type Text = Extract<SceneItem, { type: "text" }>

function key(element: SceneElement): string {
  return `${element.kind}:${element.id}`
}

function pathOf(camera: Camera, points: readonly Point[], closed: boolean): string {
  let d = ""
  points.forEach((point, index) => {
    const screen = planToScreen(camera, point)
    d += `${index === 0 ? "M" : "L"}${screen.x.toFixed(2)} ${screen.y.toFixed(2)}`
  })
  return closed && points.length > 0 ? `${d}Z` : d
}

function ringsPath(camera: Camera, rings: readonly (readonly Point[])[]): string {
  return rings.map((ring) => pathOf(camera, ring, true)).join("")
}

/**
 * The editor plan view. It paints the same scene as the sheet, in screen pixels,
 * and every element carries its own hit shape and data attributes.
 */
function PlanSvg(props: PlanSvgProps) {
  const { plan, level, camera, unit, hideFurniture, selection, hover, preview, aiChanged } = props
  const scale = plan.sheet.scale
  const scene = useMemo(() => buildScene(plan, level, { scale, unit, hideFurniture }), [plan, level, scale, unit, hideFurniture])
  const ppmm = pxPerPaperMm(camera.pixelsPerMeter, scale)
  const selectedKeys = new Set(selection.map((item) => `${item.kind}:${item.id}`))
  const hoverKey = hover ? key(hover) : ""
  const vertices = new Map(level.vertices.map((vertex) => [vertex.id, vertex]))
  const hitPx = editorTolerances.snap_px

  const groups = new Map<string, { element: SceneElement; items: SceneItem[] }>()
  const order: string[] = []
  for (const item of scene) {
    if (!item.element) {
      continue
    }
    const id = key(item.element)
    let group = groups.get(id)
    if (!group) {
      group = { element: item.element, items: [] }
      groups.set(id, group)
      order.push(id)
    }
    group.items.push(item)
  }

  const colorOf = (element: SceneElement): string =>
    selectedKeys.has(key(element)) ? SELECT_COLOR : hoverKey === key(element) ? HOVER_COLOR : INK

  const strokeNode = (item: Stroke, index: number, color: string) => (
    <path
      key={index}
      d={pathOf(camera, item.points, item.closed)}
      fill="none"
      stroke={color}
      strokeWidth={screenStrokePx(item.weightMm, camera.pixelsPerMeter, scale)}
      strokeDasharray={item.dashMm ? item.dashMm.map((mm) => Math.max(1, mm * ppmm)).join(" ") : undefined}
      strokeLinejoin="miter"
      data-role={item.part}
      pointerEvents="none"
    />
  )

  const liftScale = Math.max(ppmm, 10 / 3.5)
  const textNode = (
    item: Text,
    index: number,
    color: string,
    extra: Record<string, string> = {},
    onDown?: (event: React.PointerEvent) => void,
    interactive = onDown !== undefined,
  ) => {
    const at = planToScreen(camera, item.at)
    const y = at.y - item.liftMm * liftScale
    return (
      <text
        key={index}
        x={at.x.toFixed(2)}
        y={y.toFixed(2)}
        fontSize={screenTextPx(item.heightMm, camera.pixelsPerMeter, scale).toFixed(2)}
        fontFamily="Helvetica, Arial, sans-serif"
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        transform={item.rotationDeg !== 0 ? `rotate(${(-item.rotationDeg).toFixed(2)} ${at.x.toFixed(2)} ${at.y.toFixed(2)})` : undefined}
        pointerEvents={interactive ? "all" : "none"}
        style={onDown ? { cursor: "text" } : undefined}
        onPointerDown={onDown}
        {...extra}
      >
        {item.text}
      </text>
    )
  }

  const hoverHandlers = (element: SceneElement) => ({
    onPointerEnter: () => props.onHover(element),
    onPointerLeave: () => props.onHover(null),
    onPointerDown: (event: React.PointerEvent) => props.onElementDown(element, event),
  })

  const nodes: React.ReactNode[] = []
  for (const id of order) {
    const group = groups.get(id)
    if (!group) {
      continue
    }
    const { element, items } = group
    const color = colorOf(element)
    if (element.kind === "wall") {
      const wall = level.walls.find((item) => item.id === element.id)
      const a = wall ? vertices.get(wall.a) : undefined
      const b = wall ? vertices.get(wall.b) : undefined
      if (!wall || !a || !b) {
        continue
      }
      const rings = items.flatMap((item) => (item.type === "fill" ? item.rings : []))
      nodes.push(
        <g key={id}>
          <path
            d={ringsPath(camera, rings)}
            fill={INK}
            fillRule="evenodd"
            stroke="none"
            data-wall-id={wall.id}
            data-thickness={formatMetre(wall.thickness)}
            data-length={formatMetre(segmentLength(a, b))}
            data-angle={formatMetre(wallAngleDeg(a, b))}
            data-ai-changed={aiChanged.has(wall.id) ? "true" : "false"}
            data-selected={selectedKeys.has(id) ? "true" : "false"}
            data-hover={hoverKey === id ? "true" : "false"}
            style={{ cursor: "move" }}
            {...hoverHandlers(element)}
          />
          {items.map((item, index) => (item.type === "stroke" ? strokeNode(item, index, INK) : null))}
        </g>,
      )
      continue
    }
    if (element.kind === "opening") {
      const opening = level.openings.find((item) => item.id === element.id)
      const rect = opening ? openingRect(level, opening) : null
      nodes.push(
        <g
          key={id}
          data-opening-id={element.id}
          data-offset={opening ? formatMetre(opening.offset) : undefined}
          data-swing-side={opening?.swingSide}
          data-selected={selectedKeys.has(id) ? "true" : "false"}
          data-hover={hoverKey === id ? "true" : "false"}
          style={{ cursor: "move" }}
          {...hoverHandlers(element)}
        >
          {rect ? <path d={pathOf(camera, rect, true)} fill="#fff" fillOpacity={0} stroke="none" pointerEvents="all" data-hit="opening" /> : null}
          {items.map((item, index) => (item.type === "stroke" ? hitStroke(item, index) : null))}
          {items.map((item, index) => (item.type === "stroke" ? strokeNode(item, index, color) : null))}
        </g>,
      )
      continue
    }
    if (element.kind === "column") {
      nodes.push(
        <g key={id} data-column-id={element.id} data-selected={selectedKeys.has(id) ? "true" : "false"} {...hoverHandlers(element)}>
          {items.map((item, index) =>
            item.type === "fill" ? <path key={index} d={ringsPath(camera, item.rings)} fill={color} fillRule="evenodd" stroke="none" /> : item.type === "stroke" ? strokeNode(item, index, color) : null,
          )}
        </g>,
      )
      continue
    }
    if (element.kind === "stair") {
      const stair = level.stairs.find((item) => item.id === element.id)
      nodes.push(
        <g key={id} data-stair-id={element.id} data-selected={selectedKeys.has(id) ? "true" : "false"} {...hoverHandlers(element)}>
          {stair && stair.outline.length >= 3 ? <path d={pathOf(camera, stair.outline, true)} fill="#fff" fillOpacity={0} stroke="none" pointerEvents="all" /> : null}
          {items.map((item, index) => (item.type === "stroke" ? strokeNode(item, index, color) : null))}
        </g>,
      )
      continue
    }
    if (element.kind === "fixture") {
      const fixture = level.fixtures.find((item) => item.id === element.id)
      if (!fixture) {
        continue
      }
      const square = [
        { x: -0.5, y: -0.5 },
        { x: 0.5, y: -0.5 },
        { x: 0.5, y: 0.5 },
        { x: -0.5, y: 0.5 },
      ].map((point) => placeSymbol(fixture, point))
      nodes.push(
        <g
          key={id}
          data-fixture-id={fixture.id}
          data-symbol={fixture.symbol}
          data-selected={selectedKeys.has(id) ? "true" : "false"}
          style={{ cursor: "move" }}
          {...hoverHandlers(element)}
        >
          <path d={pathOf(camera, square, true)} fill="#fff" fillOpacity={0} stroke="none" pointerEvents="all" />
          {items.map((item, index) => (item.type === "stroke" ? strokeNode(item, index, color) : null))}
        </g>,
      )
      continue
    }
    if (element.kind === "separator") {
      nodes.push(
        <g key={id} data-separator-id={element.id} data-selected={selectedKeys.has(id) ? "true" : "false"} {...hoverHandlers(element)}>
          {items.map((item, index) => (item.type === "stroke" ? hitStroke(item, index) : null))}
          {items.map((item, index) => (item.type === "stroke" ? strokeNode(item, index, selectedKeys.has(id) || hoverKey === id ? color : "#334155") : null))}
        </g>,
      )
      continue
    }
    if (element.kind === "dimension") {
      nodes.push(
        <g key={id} data-dimension-id={element.id} data-selected={selectedKeys.has(id) ? "true" : "false"}>
          {items.map((item, index) => {
            if (item.type === "stroke") {
              return strokeNode(item, index, color)
            }
            if (item.type === "text") {
              const segmentIndex = item.segmentIndex ?? 0
              return textNode(item, index, color, { "data-segment": String(segmentIndex) }, (event) => {
                event.stopPropagation()
                props.onDimensionText(element.id, segmentIndex, planToScreen(camera, item.at))
              })
            }
            return null
          })}
        </g>,
      )
      continue
    }
    if (element.kind === "room") {
      nodes.push(
        <g key={id} data-room-id={element.id} data-selected={selectedKeys.has(id) ? "true" : "false"} pointerEvents="none">
          {items.map((item, index) =>
            item.type === "text"
              ? textNode(item, index, selectedKeys.has(id) ? SELECT_COLOR : INK, item.part === "area" ? { "data-testid": "room-area" } : { "data-part": item.part })
              : null,
          )}
        </g>,
      )
      continue
    }
    if (element.kind === "text") {
      nodes.push(
        <g key={id} data-text-id={element.id} data-selected={selectedKeys.has(id) ? "true" : "false"} {...hoverHandlers(element)} style={{ cursor: "move" }}>
          {items.map((item, index) => (item.type === "text" ? textNode(item, index, color, {}, undefined, true) : null))}
        </g>,
      )
    }
  }

  function hitStroke(item: Stroke, index: number) {
    return (
      <path
        key={`hit-${index}`}
        d={pathOf(camera, item.points, item.closed)}
        fill="none"
        stroke="#fff"
        strokeOpacity={0}
        strokeWidth={hitPx}
        pointerEvents="stroke"
      />
    )
  }

  const overlays: React.ReactNode[] = []
  const polygons = wallPolygons(plan, level.id)
  for (const polygon of polygons) {
    const id = `wall:${polygon.wallId}`
    const isSelected = selectedKeys.has(id)
    const isHover = hoverKey === id
    if (!isSelected && !isHover) {
      continue
    }
    overlays.push(
      <path key={`outline-${polygon.wallId}`} d={pathOf(camera, polygon.ring, true)} fill="none" stroke={isSelected ? SELECT_COLOR : HOVER_COLOR} strokeWidth={2} pointerEvents="none" />,
    )
    const wall = level.walls.find((item) => item.id === polygon.wallId)
    const a = wall ? vertices.get(wall.a) : undefined
    const b = wall ? vertices.get(wall.b) : undefined
    if (isSelected && a && b) {
      overlays.push(<path key={`center-${polygon.wallId}`} d={pathOf(camera, [a, b], false)} fill="none" stroke={SELECT_COLOR} strokeWidth={1} strokeDasharray="6 4" pointerEvents="none" />)
    }
  }
  if (selection.some((item) => item.kind === "room")) {
    for (const room of extractRooms(plan, level.id).rooms) {
      if (selectedKeys.has(`room:${room.id}`)) {
        overlays.push(
          <path key={`room-${room.id}`} d={pathOf(camera, room.polygon, true)} fill={SELECT_COLOR} fillOpacity={0.06} stroke={SELECT_COLOR} strokeWidth={1.5} strokeDasharray="6 4" pointerEvents="none" />,
        )
      }
    }
  }
  if (preview) {
    const previewLevel = preview.levels.find((item) => item.id === level.id) ?? preview.levels[0]
    if (previewLevel) {
      for (const polygon of wallPolygons(preview, previewLevel.id)) {
        if (!aiChanged.has(polygon.wallId)) {
          continue
        }
        overlays.push(
          <path
            key={`preview-${polygon.wallId}`}
            d={pathOf(camera, polygon.ring, true)}
            fill={PREVIEW_COLOR}
            fillOpacity={0.35}
            stroke={PREVIEW_COLOR}
            strokeWidth={2}
            pointerEvents="none"
            data-ai-preview-wall={polygon.wallId}
          />,
        )
      }
    }
  }

  return (
    <svg className="absolute inset-0" width={props.width} height={props.height} data-testid="plan-svg">
      {nodes}
      {overlays}
      {level.vertices.map((vertex) => {
        const screen = planToScreen(camera, vertex)
        const isSelected = selectedKeys.has(`vertex:${vertex.id}`)
        return (
          <circle
            key={vertex.id}
            cx={screen.x.toFixed(2)}
            cy={screen.y.toFixed(2)}
            r={6}
            className={isSelected ? "opacity-100" : "opacity-0 hover:opacity-100"}
            fill="#fff"
            stroke={isSelected ? SELECT_COLOR : HOVER_COLOR}
            strokeWidth={2}
            pointerEvents="all"
            style={{ cursor: "pointer" }}
            data-vertex-id={vertex.id}
            data-x={formatMetre(vertex.x)}
            data-y={formatMetre(vertex.y)}
            data-selected={isSelected ? "true" : "false"}
            onPointerDown={(event) => props.onVertexDown(vertex.id, event)}
          />
        )
      })}
      {props.children}
    </svg>
  )
}

export default memo(PlanSvg)
