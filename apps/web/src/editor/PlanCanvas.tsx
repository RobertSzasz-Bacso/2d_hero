import { useEffect, useRef, useState } from "react"
import { Group, Layer, Line, Stage } from "react-konva"
import { dimensionLabelPoint, roomLabelPoint } from "@/core/dimensions.ts"
import { displayFromMetres, metresFromDisplay } from "@/core/draw.ts"
import { footOnLine } from "@/core/geom.ts"
import { applyTypedDimension, moveVertex, moveWall, setOpening } from "@/core/ops.ts"
import { pickAt } from "@/core/pick.ts"
import type { Level, Plan, Point } from "@/core/plan-types.ts"
import { extractRooms } from "@/core/rooms.ts"
import { snapPoint } from "@/core/snap.ts"
import { editorTolerances } from "@/core/tolerances.ts"
import { wallPolygons } from "@/core/wall-polygons.ts"
import { planToScreen, screenToPlan } from "@/view/camera.ts"
import { extendWall, placeColumn, placeFixture, placeOpening, placeSeparator, placeSplit, placeStair, placeText, startWall } from "./draw-actions.ts"
import { formatMetre, offsetAlongWall, openingEnds, segmentLength, wallAngleDeg } from "./metrics.ts"
import { itemsInPlanRect, type SelectionItem } from "./select.ts"
import { symbolPolylines } from "./symbols.ts"
import UnderlayLayer from "./UnderlayLayer.tsx"
import { useEditor } from "./store.ts"

type SessionKind = "vertex" | "wall" | "opening" | "box" | "pan"

type Session = {
  kind: SessionKind
  id?: string
  base: Plan
  origin: Point
  last: Point
  moved: boolean
  shift: boolean
  stop: () => void
}

function shownLevel(plan: Plan): Level | undefined {
  const id = useEditor.getState().activeLevelId
  return plan.levels.find((level) => level.id === id) ?? plan.levels[0]
}

function localPoint(event: { clientX: number; clientY: number }, host: HTMLElement): Point {
  const rect = host.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function selected(items: readonly SelectionItem[], kind: SelectionItem["kind"], id: string): boolean {
  return items.some((item) => item.kind === kind && item.id === id)
}

export default function PlanCanvas() {
  const plan = useEditor((state) => state.history?.plan ?? null)
  const camera = useEditor((state) => state.camera)
  const stage = useEditor((state) => state.stage)
  const selection = useEditor((state) => state.selection)
  const tool = useEditor((state) => state.tool)
  const symbol = useEditor((state) => state.symbol)
  const hideFurniture = useEditor((state) => state.hideFurniture)
  const dimensionUnit = useEditor((state) => state.dimensionUnit)
  const host = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Session | null>(null)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [dimensionEdit, setDimensionEdit] = useState<{ id: string; index: number; value: string } | null>(null)
  const [toolError, setToolError] = useState("")

  useEffect(() => {
    const node = host.current
    if (!node) {
      return
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }
      useEditor.getState().setStage(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const node = host.current
    if (!node) {
      return
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      const factor = Math.exp(-event.deltaY * 0.0015)
      useEditor.getState().zoomAt({ x: event.clientX - rect.left, y: event.clientY - rect.top }, factor)
    }
    node.addEventListener("wheel", onWheel, { passive: false })
    return () => node.removeEventListener("wheel", onWheel)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const session = dragRef.current
      if (event.key !== "Escape" || !session) {
        return
      }
      event.preventDefault()
      session.stop()
      dragRef.current = null
      setBox(null)
      if (session.moved && session.kind !== "box" && session.kind !== "pan") {
        useEditor.getState().cancelTransaction()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const projectId = useEditor((state) => state.projectId)
  const activeLevelId = useEditor((state) => state.activeLevelId)
  const level = plan?.levels.find((item) => item.id === activeLevelId) ?? plan?.levels[0]
  const vertices = new Map(level?.vertices.map((vertex) => [vertex.id, vertex]) ?? [])
  const polygons = plan && level ? wallPolygons(plan, level.id) : []

  function begin(kind: SessionKind, event: React.PointerEvent, id?: string) {
    const node = host.current
    const history = useEditor.getState().history
    if (!node || !history) {
      return
    }
    if (kind !== "box") {
      event.stopPropagation()
    }
    if (event.button === 1) {
      event.preventDefault()
    }
    const origin = localPoint(event, node)
    const session: Session = {
      kind,
      id,
      base: history.plan,
      origin,
      last: origin,
      moved: false,
      shift: event.shiftKey,
      stop: () => undefined,
    }
    const onMove = (ev: PointerEvent) => {
      if (dragRef.current !== session) {
        return
      }
      const screen = localPoint(ev, node)
      const distance = Math.hypot(screen.x - session.origin.x, screen.y - session.origin.y)
      if (!session.moved && session.kind !== "pan" && distance < 4) {
        return
      }
      if (!session.moved && session.kind !== "box" && session.kind !== "pan") {
        useEditor.getState().beginTransaction()
      }
      session.moved = true
      applySession(session, screen)
    }
    const onUp = () => {
      if (dragRef.current !== session) {
        session.stop()
        return
      }
      session.stop()
      dragRef.current = null
      finishSession(session)
    }
    session.stop = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    dragRef.current = session
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  function onBackground(event: React.PointerEvent) {
    const state = useEditor.getState()
    const space = state.spaceDown
    if (event.button === 1 || (space && event.button === 0)) {
      begin("pan", event)
      return
    }
    if (event.button !== 0) {
      return
    }
    const placing = state.symbol !== null || (state.tool !== "select" && state.tool !== "door" && state.tool !== "window" && state.tool !== "passage" && state.tool !== "split")
    if (!placing) {
      begin("box", event)
      return
    }
    const node = host.current
    if (!node) {
      return
    }
    placeAt(localPoint(event, node))
  }

  return (
    <div ref={host} className="relative h-full w-full overflow-hidden bg-white" onPointerDown={onBackground} data-testid="plan-stage" data-tool={tool} data-symbol={symbol ?? ""}>
      {projectId && level ? <UnderlayLayer projectId={projectId} levelId={level.id} /> : null}
      <div className="pointer-events-none absolute inset-0">
        {stage.width > 0 && stage.height > 0 ? (
          <Stage width={stage.width} height={stage.height} listening={false}>
            <Layer>
              <Group x={camera.originX} y={camera.originY} scaleX={camera.pixelsPerMeter} scaleY={-camera.pixelsPerMeter}>
                {polygons.map((polygon) => (
                  <Line
                    key={polygon.wallId}
                    points={polygon.ring.flatMap((point) => [point.x, point.y])}
                    closed
                    fill="rgba(0,0,0,0.35)"
                    stroke={selected(selection, "wall", polygon.wallId) ? "#1d4ed8" : "#111827"}
                    strokeWidth={selected(selection, "wall", polygon.wallId) ? 0.04 : 0.015}
                  />
                ))}
                {level?.openings.map((opening) => {
                  const ends = openingEnds(level, opening)
                  const wall = level.walls.find((item) => item.id === opening.wall)
                  if (!ends || !wall) {
                    return null
                  }
                  return (
                    <Line
                      key={opening.id}
                      points={[ends.a.x, ends.a.y, ends.b.x, ends.b.y]}
                      stroke="#ffffff"
                      strokeWidth={wall.thickness * 0.92}
                    />
                  )
                })}
                {level?.separators.map((separator) => {
                  const a = vertices.get(separator.a)
                  const b = vertices.get(separator.b)
                  if (!a || !b) {
                    return null
                  }
                  return (
                    <Line
                      key={separator.id}
                      points={[a.x, a.y, b.x, b.y]}
                      stroke="#64748b"
                      strokeWidth={0.02}
                      dash={[0.08, 0.06]}
                    />
                  )
                })}
                {level?.columns.map((column) => (
                  <Line
                    key={column.id}
                    x={column.x}
                    y={column.y}
                    rotation={column.rotationDeg}
                    points={rectanglePoints(column.width, column.depth)}
                    closed
                    fill="rgba(0,0,0,0.55)"
                    stroke="#111827"
                    strokeWidth={0.02}
                  />
                ))}
                {level?.stairs.map((stair) => (
                  <Line
                    key={stair.id}
                    points={stair.outline.flatMap((point) => [point.x, point.y])}
                    closed
                    stroke="#111827"
                    strokeWidth={0.015}
                  />
                ))}
                {level?.fixtures
                  .filter((fixture) => !(hideFurniture && fixture.role === "furniture"))
                  .map((fixture) => (
                    <Group key={fixture.id} x={fixture.x} y={fixture.y} rotation={fixture.rotationDeg} scaleX={fixture.width} scaleY={fixture.depth}>
                      {symbolPolylines(fixture.symbol).map((polyline, index) => (
                        <Line
                          key={`${fixture.id}-${index}`}
                          points={polyline.flatMap((point) => [point.x, point.y])}
                          stroke="#111827"
                          strokeWidth={1.5}
                          strokeScaleEnabled={false}
                          dash={fixture.symbol === "block" ? [4, 3] : undefined}
                        />
                      ))}
                    </Group>
                  ))}
                {level?.walls.map((wall) => {
                  if (!selected(selection, "wall", wall.id)) {
                    return null
                  }
                  const a = vertices.get(wall.a)
                  const b = vertices.get(wall.b)
                  if (!a || !b) {
                    return null
                  }
                  return (
                    <Line
                      key={`${wall.id}-center`}
                      points={[a.x, a.y, b.x, b.y]}
                      stroke="#2563eb"
                      strokeWidth={0.02}
                      dash={[0.08, 0.06]}
                    />
                  )
                })}
              </Group>
            </Layer>
          </Stage>
        ) : null}
      </div>
      <div className="pointer-events-none absolute inset-0">
        {level?.walls.map((wall) => {
          const a = vertices.get(wall.a)
          const b = vertices.get(wall.b)
          if (!a || !b) {
            return null
          }
          const screen = wallHandle(camera, a, b)
          return (
            <button
              key={wall.id}
              type="button"
              data-wall-id={wall.id}
              data-length={formatMetre(segmentLength(a, b))}
              data-angle={formatMetre(wallAngleDeg(a, b))}
              data-selected={selected(selection, "wall", wall.id) ? "true" : "false"}
              className="pointer-events-auto absolute z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-slate-700 bg-white"
              style={{ left: screen.x, top: screen.y }}
              onPointerDown={(event) => onWallPointer(event, wall.id)}
            />
          )
        })}
        {level?.openings.map((opening) => {
          const ends = openingEnds(level, opening)
          if (!ends) {
            return null
          }
          const screen = planToScreen(camera, ends.center)
          return (
            <button
              key={opening.id}
              type="button"
              data-opening-id={opening.id}
              data-offset={formatMetre(opening.offset)}
              className="pointer-events-auto absolute z-20 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-700 bg-amber-100"
              style={{ left: screen.x, top: screen.y }}
              onPointerDown={(event) => begin("opening", event, opening.id)}
            />
          )
        })}
        {level?.vertices.map((vertex) => {
          const screen = planToScreen(camera, vertex)
          return (
            <button
              key={vertex.id}
              type="button"
              data-vertex-id={vertex.id}
              data-x={formatMetre(vertex.x)}
              data-y={formatMetre(vertex.y)}
              data-selected={selected(selection, "vertex", vertex.id) ? "true" : "false"}
              className="pointer-events-auto absolute z-30 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-900 bg-white"
              style={{ left: screen.x, top: screen.y }}
              onPointerDown={(event) => begin("vertex", event, vertex.id)}
            />
          )
        })}
      </div>
        {plan && level
          ? extractRooms(plan, level.id).rooms.map((room) => {
              const screen = planToScreen(camera, roomLabelPoint(room.polygon))
              return (
                <div
                  key={room.id}
                  className="pointer-events-none absolute z-0 -translate-x-1/2 -translate-y-1/2 text-center text-xs text-slate-800"
                  style={{ left: screen.x, top: screen.y }}
                  data-room-id={room.id}
                >
                  <div>{room.name || "Room"}</div>
                  {room.number ? <div>{room.number}</div> : null}
                  <div data-testid="room-area">{`${room.area.toFixed(1)} m²`}</div>
                </div>
              )
            })
          : null}
        {level?.dimensions.map((dimension) =>
          dimension.segments.map((segment, index) => {
            const label = dimensionLabelPoint(level, dimension, index)
            if (!label) {
              return null
            }
            const screen = planToScreen(camera, label.point)
            const editing = dimensionEdit?.id === dimension.id && dimensionEdit.index === index
            return (
              <button
                key={`${dimension.id}-${index}`}
                type="button"
                data-dimension-id={dimension.id}
                className="pointer-events-auto absolute z-0 -translate-x-1/2 -translate-y-1/2 bg-white/80 px-1 text-xs text-slate-800"
                style={{ left: screen.x, top: screen.y }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  useEditor.getState().setSelection([{ kind: "dimension", id: dimension.id }])
                  setDimensionEdit({ id: dimension.id, index, value: String(displayFromMetres(label.length, dimensionUnit)) })
                }}
              >
                {editing ? (
                  <input
                    className="w-16 border border-slate-300 px-1"
                    value={dimensionEdit.value}
                    autoFocus
                    onChange={(event) => setDimensionEdit({ id: dimension.id, index, value: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        applyDimension(dimension.id, index, dimensionEdit.value, segment)
                      }
                    }}
                    onBlur={() => applyDimension(dimension.id, index, dimensionEdit.value, segment)}
                  />
                ) : (
                  displayFromMetres(label.length, dimensionUnit)
                )}
              </button>
            )
          }),
        )}
        {level?.fixtures
          .filter((fixture) => !(hideFurniture && fixture.role === "furniture"))
          .map((fixture) => {
            const screen = planToScreen(camera, fixture)
            return (
              <button
                key={fixture.id}
                type="button"
                data-fixture-id={fixture.id}
                data-symbol={fixture.symbol}
                className="pointer-events-auto absolute z-20 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-800 bg-emerald-100"
                style={{ left: screen.x, top: screen.y }}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  useEditor.getState().toggleSelection({ kind: "fixture", id: fixture.id }, event.shiftKey)
                }}
              />
            )
          })}
        {level?.columns.map((column) => {
          const screen = planToScreen(camera, column)
          return (
            <button
              key={column.id}
              type="button"
              data-column-id={column.id}
              className="pointer-events-auto absolute z-20 size-3 -translate-x-1/2 -translate-y-1/2 border border-slate-900 bg-slate-700"
              style={{ left: screen.x, top: screen.y }}
              onPointerDown={(event) => {
                event.stopPropagation()
                useEditor.getState().toggleSelection({ kind: "column", id: column.id }, event.shiftKey)
              }}
            />
          )
        })}
        {level?.stairs.map((stair) => {
          const center = stairCenter(stair.outline)
          const screen = planToScreen(camera, center)
          return (
            <button
              key={stair.id}
              type="button"
              data-stair-id={stair.id}
              className="pointer-events-auto absolute z-20 size-3 -translate-x-1/2 -translate-y-1/2 border border-slate-900 bg-white"
              style={{ left: screen.x, top: screen.y }}
              onPointerDown={(event) => {
                event.stopPropagation()
                useEditor.getState().toggleSelection({ kind: "stair", id: stair.id }, event.shiftKey)
              }}
            />
          )
        })}
        {level?.texts.map((text) => {
          const screen = planToScreen(camera, text)
          return (
            <button
              key={text.id}
              type="button"
              data-text-id={text.id}
              className="pointer-events-auto absolute z-20 -translate-x-1/2 -translate-y-1/2 bg-white px-1 text-xs"
              style={{ left: screen.x, top: screen.y }}
              onPointerDown={(event) => {
                event.stopPropagation()
                useEditor.getState().toggleSelection({ kind: "text", id: text.id }, event.shiftKey)
              }}
            >
              {text.text}
            </button>
          )
        })}
      {toolError ? <p className="absolute bottom-2 left-2 z-40 bg-white px-2 text-xs text-red-700">{toolError}</p> : null}
      {box ? (
        <div
          className="pointer-events-none absolute border border-blue-600 bg-blue-600/10"
          style={{
            left: Math.min(box.x0, box.x1),
            top: Math.min(box.y0, box.y1),
            width: Math.abs(box.x1 - box.x0),
            height: Math.abs(box.y1 - box.y0),
          }}
        />
      ) : null}
    </div>
  )

  function snappedPoint(screen: Point): Point {
    const state = useEditor.getState()
    const raw = screenToPlan(state.camera, screen)
    const current = state.history?.plan
    const levelNow = current ? shownLevel(current) : undefined
    if (!current || !levelNow) {
      return raw
    }
    return (
      snapPoint({
        plan: current,
        levelId: levelNow.id,
        cursor: raw,
        pixelsPerMeter: state.camera.pixelsPerMeter,
        gridM: state.gridM,
      })?.point ?? raw
    )
  }

  function placeAt(screen: Point) {
    const state = useEditor.getState()
    const current = state.history?.plan
    if (!current) {
      return
    }
    const point = snappedPoint(screen)
    try {
      if (state.symbol) {
        state.commit(placeFixture(current, state.symbol, point, state.activeLevelId))
        state.setTool("select")
        setToolError("")
        return
      }
      if (state.tool === "wall") {
        if (!state.wallChain) {
          const started = startWall(current, point, state.activeLevelId)
          state.commit(started.plan)
          state.setWallChain(started.chain)
        } else {
          const anchor = shownLevel(current)?.vertices.find((vertex) => vertex.id === state.wallChain?.anchorId)
          if (!anchor) {
            return
          }
          const dx = point.x - anchor.x
          const dy = point.y - anchor.y
          const length = Math.hypot(dx, dy)
          if (length <= 0.001) {
            return
          }
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI
          const drawn = extendWall(current, state.wallChain, length, angle, state.activeLevelId)
          state.commit(drawn.plan)
          state.setWallChain(drawn.chain)
        }
        setToolError("")
        return
      }
      if (state.tool === "column") {
        state.commit(placeColumn(current, point, state.activeLevelId))
      } else if (state.tool === "stair") {
        state.commit(placeStair(current, point, state.activeLevelId))
      } else if (state.tool === "text") {
        state.commit(placeText(current, point, state.activeLevelId))
      } else if (state.tool === "separator") {
        if (!state.separatorStart) {
          state.setSeparatorStart(point)
        } else {
          state.commit(placeSeparator(current, state.separatorStart, point, state.activeLevelId))
          state.setSeparatorStart(null)
        }
      } else if (state.tool === "room") {
        const levelNow = shownLevel(current)
        if (!levelNow) {
          return
        }
        const hit = pickAt(current, levelNow.id, point, editorTolerances.snap_px / state.camera.pixelsPerMeter).find((item) => item.kind === "room")
        if (hit) {
          state.setSelection([{ kind: "room", id: hit.id }])
        }
      }
      setToolError("")
    } catch (caught) {
      setToolError(caught instanceof Error ? caught.message : "That edit was not applied.")
    }
  }

  function onWallPointer(event: React.PointerEvent, wallId: string) {
    event.stopPropagation()
    const state = useEditor.getState()
    const current = state.history?.plan
    const levelNow = current ? shownLevel(current) : undefined
    const node = host.current
    if (!current || !levelNow || !node) {
      return
    }
    if (state.tool === "door" || state.tool === "window" || state.tool === "passage") {
      const wall = levelNow.walls.find((item) => item.id === wallId)
      const a = wall ? levelNow.vertices.find((vertex) => vertex.id === wall.a) : undefined
      const b = wall ? levelNow.vertices.find((vertex) => vertex.id === wall.b) : undefined
      if (!wall || !a || !b) {
        return
      }
      const point = screenToPlan(state.camera, localPoint(event, node))
      try {
        state.commit(placeOpening(current, wallId, state.tool, offsetAlongWall(a, b, point, 0.9), state.activeLevelId))
        setToolError("")
      } catch (caught) {
        setToolError(caught instanceof Error ? caught.message : "The opening was not placed.")
      }
      return
    }
    if (state.tool === "split") {
      const wall = levelNow.walls.find((item) => item.id === wallId)
      const a = wall ? levelNow.vertices.find((vertex) => vertex.id === wall.a) : undefined
      const b = wall ? levelNow.vertices.find((vertex) => vertex.id === wall.b) : undefined
      if (!a || !b) {
        return
      }
      const point = screenToPlan(state.camera, localPoint(event, node))
      const foot = footOnLine(point, a, b)
      try {
        state.commit(placeSplit(current, wallId, foot?.t ?? 0.5, state.activeLevelId))
        setToolError("")
      } catch (caught) {
        setToolError(caught instanceof Error ? caught.message : "The wall was not split.")
      }
      return
    }
    if (state.tool !== "select") {
      return
    }
    begin("wall", event, wallId)
  }

  function applyDimension(
    id: string,
    index: number,
    value: string,
    segment: { a: { type: "vertex"; id: string } | { type: "opening"; id: string; edge: "start" | "end" }; b: { type: "vertex"; id: string } | { type: "opening"; id: string; edge: "start" | "end" } },
  ) {
    const state = useEditor.getState()
    const current = state.history?.plan
    const levelNow = current ? shownLevel(current) : undefined
    const metres = metresFromDisplay(Number(value), state.dimensionUnit)
    if (!current || !levelNow || !(metres > 0)) {
      setDimensionEdit(null)
      return
    }
    try {
      state.commit(applyTypedDimension(current, levelNow.id, { a: segment.a, b: segment.b, lengthM: metres }))
      setToolError("")
    } catch (caught) {
      setToolError(caught instanceof Error ? caught.message : "The dimension was not applied.")
    }
    setDimensionEdit(null)
    void index
    void id
  }

  function applySession(session: Session, screen: Point) {
    const state = useEditor.getState()
    const levelNow = shownLevel(session.base)
    if (!levelNow) {
      return
    }
    const point = screenToPlan(state.camera, screen)
    if (session.kind === "pan") {
      state.panBy(screen.x - session.last.x, screen.y - session.last.y)
      session.last = screen
      return
    }
    if (session.kind === "box") {
      session.last = screen
      setBox({ x0: session.origin.x, y0: session.origin.y, x1: screen.x, y1: screen.y })
      return
    }
    if (session.kind === "vertex" && session.id) {
      const snapped = snapPoint({
        plan: session.base,
        levelId: levelNow.id,
        cursor: point,
        pixelsPerMeter: state.camera.pixelsPerMeter,
        gridM: state.gridM,
        excludeVertexIds: [session.id],
      })
      state.draft(moveVertex(session.base, levelNow.id, session.id, snapped?.point ?? point))
      return
    }
    if (session.kind === "wall" && session.id) {
      const origin = screenToPlan(state.camera, session.origin)
      state.draft(moveWall(session.base, levelNow.id, session.id, { x: point.x - origin.x, y: point.y - origin.y }))
      return
    }
    if (session.kind === "opening" && session.id) {
      const opening = levelNow.openings.find((item) => item.id === session.id)
      const wall = opening ? levelNow.walls.find((item) => item.id === opening.wall) : undefined
      const a = wall ? levelNow.vertices.find((vertex) => vertex.id === wall.a) : undefined
      const b = wall ? levelNow.vertices.find((vertex) => vertex.id === wall.b) : undefined
      if (!opening || !a || !b) {
        return
      }
      const offset = offsetAlongWall(a, b, point, opening.width)
      state.draft(setOpening(session.base, levelNow.id, opening.id, { offset }))
    }
  }

  function finishSession(session: Session) {
    setBox(null)
    const state = useEditor.getState()
    if (session.kind === "vertex" || session.kind === "wall" || session.kind === "opening") {
      if (!session.moved || !session.id) {
        if (session.id) {
          state.toggleSelection({ kind: session.kind, id: session.id }, session.shift)
        }
        return
      }
      const before = JSON.stringify(session.base)
      state.endTransaction()
      const after = JSON.stringify(useEditor.getState().history?.plan)
      if (before !== after) {
        state.saveNow()
      }
      return
    }
    if (session.kind !== "box") {
      return
    }
    const planNow = state.history?.plan
    const levelNow = planNow ? shownLevel(planNow) : undefined
    if (!planNow || !levelNow) {
      return
    }
    if (!session.moved) {
      const point = screenToPlan(state.camera, session.origin)
      const hits = pickAt(planNow, levelNow.id, point, editorTolerances.snap_px / state.camera.pixelsPerMeter)
      const hit = hits[0]
      if (!hit) {
        if (!session.shift) {
          state.setSelection([])
        }
        return
      }
      state.toggleSelection({ kind: hit.kind, id: hit.id }, session.shift)
      return
    }
    const origin = screenToPlan(state.camera, session.origin)
    const corner = screenToPlan(state.camera, session.last)
    const found = itemsInPlanRect(levelNow, {
      minX: Math.min(origin.x, corner.x),
      minY: Math.min(origin.y, corner.y),
      maxX: Math.max(origin.x, corner.x),
      maxY: Math.max(origin.y, corner.y),
    })
    if (session.shift) {
      const merged = [...state.selection]
      for (const item of found) {
        if (!merged.some((entry) => entry.kind === item.kind && entry.id === item.id)) {
          merged.push(item)
        }
      }
      state.setSelection(merged)
      return
    }
    state.setSelection(found)
  }
}

function rectanglePoints(width: number, depth: number): number[] {
  const x = width / 2
  const y = depth / 2
  return [-x, -y, x, -y, x, y, -x, y]
}

function stairCenter(outline: readonly Point[]): Point {
  if (outline.length === 0) {
    return { x: 0, y: 0 }
  }
  let x = 0
  let y = 0
  for (const point of outline) {
    x += point.x
    y += point.y
  }
  return { x: x / outline.length, y: y / outline.length }
}

function wallHandle(camera: { pixelsPerMeter: number; originX: number; originY: number }, a: Point, b: Point): Point {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy) || 1
  const scale = 18 / camera.pixelsPerMeter
  return planToScreen(camera, {
    x: mid.x + (-dy / length) * scale,
    y: mid.y + (dx / length) * scale,
  })
}
