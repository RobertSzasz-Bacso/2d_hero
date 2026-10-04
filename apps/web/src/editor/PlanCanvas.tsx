import { useEffect, useRef, useState } from "react"
import { Group, Layer, Line, Stage } from "react-konva"
import { moveVertex, moveWall, setOpening } from "@/core/ops.ts"
import { pickAt } from "@/core/pick.ts"
import type { Plan, Point } from "@/core/plan-types.ts"
import { snapPoint } from "@/core/snap.ts"
import { editorTolerances } from "@/core/tolerances.ts"
import { wallPolygons } from "@/core/wall-polygons.ts"
import { planToScreen, screenToPlan } from "@/view/camera.ts"
import { formatMetre, offsetAlongWall, openingEnds, segmentLength, wallAngleDeg } from "./metrics.ts"
import { itemsInPlanRect, type SelectionItem } from "./select.ts"
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
  const host = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Session | null>(null)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

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

  const level = plan?.levels[0]
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
    const space = useEditor.getState().spaceDown
    if (event.button === 1 || (space && event.button === 0)) {
      begin("pan", event)
      return
    }
    if (event.button !== 0) {
      return
    }
    begin("box", event)
  }

  return (
    <div ref={host} className="relative h-full w-full overflow-hidden bg-white" onPointerDown={onBackground} data-testid="plan-stage">
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
              onPointerDown={(event) => begin("wall", event, wall.id)}
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

  function applySession(session: Session, screen: Point) {
    const state = useEditor.getState()
    const levelNow = session.base.levels[0]
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
    const levelNow = planNow?.levels[0]
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
