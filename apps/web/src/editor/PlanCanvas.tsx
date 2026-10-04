import { useEffect, useRef, useState } from "react"
import { changedWallIds } from "@/core/ai.ts"
import { dimensionLabelPoint } from "@/core/dimensions.ts"
import { displayFromMetres, metresFromDisplay } from "@/core/draw.ts"
import { footOnLine } from "@/core/geom.ts"
import { applyTypedDimension, moveVertex, moveWall, setOpening } from "@/core/ops.ts"
import { pickAt } from "@/core/pick.ts"
import type { Level, Plan, Point } from "@/core/plan-types.ts"
import { snapPoint } from "@/core/snap.ts"
import { editorTolerances } from "@/core/tolerances.ts"
import type { SceneElement } from "@/drawing/scene.ts"
import { screenToPlan } from "@/view/camera.ts"
import { extendWall, placeColumn, placeFixture, placeOpening, placeSeparator, placeSplit, placeStair, placeText, startWall } from "./draw-actions.ts"
import { offsetAlongWall } from "./metrics.ts"
import PlanSvg from "./PlanSvg.tsx"
import { itemsInPlanRect } from "./select.ts"
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

type DimensionSegment = Level["dimensions"][number]["segments"][number]

function shownLevel(plan: Plan): Level | undefined {
  const id = useEditor.getState().activeLevelId
  return plan.levels.find((level) => level.id === id) ?? plan.levels[0]
}

function localPoint(event: { clientX: number; clientY: number }, host: HTMLElement): Point {
  const rect = host.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function isPlacing(state: ReturnType<typeof useEditor.getState>): boolean {
  return state.symbol !== null || (state.tool !== "select" && state.tool !== "door" && state.tool !== "window" && state.tool !== "passage" && state.tool !== "split")
}

function isPan(event: React.PointerEvent): boolean {
  return event.button === 1 || (useEditor.getState().spaceDown && event.button === 0)
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
  const [dimensionEdit, setDimensionEdit] = useState<{ id: string; index: number; value: string; at: Point } | null>(null)
  const [hover, setHover] = useState<SceneElement | null>(null)
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
  const preview = useEditor((state) => state.aiPreview)
  const level = plan?.levels.find((item) => item.id === activeLevelId) ?? plan?.levels[0]
  const highlighted = plan && preview ? changedWallIds(plan, preview) : new Set<string>()

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
    if (isPan(event)) {
      begin("pan", event)
      return
    }
    if (event.button !== 0) {
      return
    }
    if (!isPlacing(useEditor.getState())) {
      begin("box", event)
      return
    }
    const node = host.current
    if (!node) {
      return
    }
    placeAt(localPoint(event, node))
  }

  function onElementDown(element: SceneElement, event: React.PointerEvent) {
    if (isPan(event) || event.button !== 0) {
      return
    }
    const node = host.current
    if (!node) {
      return
    }
    if (element.kind === "wall") {
      onWallPointer(event, element.id)
      return
    }
    event.stopPropagation()
    const state = useEditor.getState()
    if (isPlacing(state)) {
      placeAt(localPoint(event, node))
      return
    }
    if (state.tool !== "select") {
      return
    }
    if (element.kind === "opening") {
      begin("opening", event, element.id)
      return
    }
    state.toggleSelection({ kind: element.kind, id: element.id }, event.shiftKey)
  }

  function onVertexDown(vertexId: string, event: React.PointerEvent) {
    if (isPan(event) || event.button !== 0) {
      return
    }
    const node = host.current
    if (!node) {
      return
    }
    event.stopPropagation()
    const state = useEditor.getState()
    if (isPlacing(state)) {
      placeAt(localPoint(event, node))
      return
    }
    if (state.tool !== "select") {
      return
    }
    begin("vertex", event, vertexId)
  }

  function onDimensionText(dimensionId: string, segmentIndex: number, at: Point) {
    const current = useEditor.getState().history?.plan
    const levelNow = current ? shownLevel(current) : undefined
    const dimension = levelNow?.dimensions.find((item) => item.id === dimensionId)
    const label = levelNow && dimension ? dimensionLabelPoint(levelNow, dimension, segmentIndex) : null
    if (!label) {
      return
    }
    useEditor.getState().setSelection([{ kind: "dimension", id: dimensionId }])
    setDimensionEdit({ id: dimensionId, index: segmentIndex, value: String(displayFromMetres(label.length, dimensionUnit)), at })
  }

  const editingSegment = dimensionEdit ? level?.dimensions.find((item) => item.id === dimensionEdit.id)?.segments[dimensionEdit.index] : undefined

  return (
    <div
      ref={host}
      className="relative h-full w-full overflow-hidden bg-white"
      onPointerDown={onBackground}
      data-testid="plan-stage"
      data-tool={tool}
      data-symbol={symbol ?? ""}
    >
      {projectId && level ? <UnderlayLayer projectId={projectId} levelId={level.id} /> : null}
      {plan && level && stage.width > 0 && stage.height > 0 ? (
        <PlanSvg
          plan={plan}
          level={level}
          camera={camera}
          width={stage.width}
          height={stage.height}
          unit={dimensionUnit}
          hideFurniture={hideFurniture}
          selection={selection}
          hover={hover}
          preview={preview}
          aiChanged={highlighted}
          onElementDown={onElementDown}
          onVertexDown={onVertexDown}
          onDimensionText={onDimensionText}
          onHover={setHover}
        />
      ) : null}
      {dimensionEdit && editingSegment ? (
        <input
          className="absolute z-30 w-16 -translate-x-1/2 -translate-y-1/2 border border-blue-600 bg-white px-1 text-xs"
          style={{ left: dimensionEdit.at.x, top: dimensionEdit.at.y }}
          value={dimensionEdit.value}
          autoFocus
          data-testid="dimension-input"
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => setDimensionEdit({ ...dimensionEdit, value: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              applyDimension(dimensionEdit.value, editingSegment)
            } else if (event.key === "Escape") {
              setDimensionEdit(null)
            }
          }}
          onBlur={() => applyDimension(dimensionEdit.value, editingSegment)}
        />
      ) : null}
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
    if (isPlacing(state)) {
      placeAt(localPoint(event, node))
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

  function applyDimension(value: string, segment: DimensionSegment) {
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
