import { useEffect, useRef, useState } from "react"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu.tsx"
import { changedWallIds } from "@/core/ai.ts"
import { dimensionLabelPoint, roomLabelPoint } from "@/core/dimensions.ts"
import { displayFromMetres, mergeCollinearWall, metresFromDisplay, pointAtAngle } from "@/core/draw.ts"
import { dot, footOnLine, rotate, sub } from "@/core/geom.ts"
import { moveSelection, rehostOpening, setClearDistance, setOpeningEdge, setWallThicknessFromFace, snapFixtureToWall, wallFrame } from "@/core/grips.ts"
import { applyTypedDimension, moveVertex, moveWall, setFixtureRotation, setFixtureSize, setOpening, setRoomName } from "@/core/ops.ts"
import { pickAt } from "@/core/pick.ts"
import type { Level, Plan, Point } from "@/core/plan-types.ts"
import { extractRooms } from "@/core/rooms.ts"
import { snapPoint, type SnapHit } from "@/core/snap.ts"
import { editorTolerances } from "@/core/tolerances.ts"
import type { SceneElement } from "@/drawing/scene.ts"
import { planToScreen, screenToPlan } from "@/view/camera.ts"
import CursorInput, { type CursorEntry, type CursorField } from "./CursorInput.tsx"
import {
  extendWallTo,
  placeColumn,
  placeDimension,
  placeOpeningAt,
  placeRectangle,
  placeSeparator,
  placeSplit,
  placeStair,
  placeText,
  startWall,
} from "./draw-actions.ts"
import { faceDragThickness, rotationFromGrip } from "./grip-math.ts"
import Grips, { type GripSpec, type SnapGlyph, type TempDimension } from "./Grips.tsx"
import { offsetAlongWall, openingEnds } from "./metrics.ts"
import PlanSvg from "./PlanSvg.tsx"
import { itemsInBox, type SelectionItem } from "./select.ts"
import { placeArmedSymbol } from "./SymbolLibrary.tsx"
import { dimensionOffset, dimensionRefAt, lengthAngle, openingGhost, orthoLock, rectangleCorner, type OpeningGhost } from "./tool-math.ts"
import ToolOverlay, { type ToolPreview } from "./ToolOverlay.tsx"
import UnderlayLayer from "./UnderlayLayer.tsx"
import { useEditor, type EditorTool } from "./store.ts"

type SessionKind = "vertex" | "wall" | "opening" | "box" | "pan" | "grip" | "item" | "rect"

type Session = {
  kind: SessionKind
  id?: string
  grip?: GripSpec
  items?: SelectionItem[]
  anchor?: Point
  base: Plan
  origin: Point
  last: Point
  moved: boolean
  shift: boolean
  alt: boolean
  stop: () => void
}

type DimensionSegment = Level["dimensions"][number]["segments"][number]

type MenuTarget = { hit: SelectionItem | null; point: Point }

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

const MOVABLE: ReadonlySet<SelectionItem["kind"]> = new Set(["fixture", "column", "text", "stair"])

const OPENING_WIDTH_M = 0.9

type OpeningTool = Extract<EditorTool, "door" | "window" | "passage">

function isOpeningTool(tool: EditorTool): tool is OpeningTool {
  return tool === "door" || tool === "window" || tool === "passage"
}

type DimensionPick = NonNullable<ReturnType<typeof dimensionRefAt>>

function typedMetres(value: string, unit: "cm" | "mm"): number {
  return metresFromDisplay(Number(value.trim().replace(",", ".")), unit)
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
  const [tempEdit, setTempEdit] = useState<{ dimension: TempDimension; value: string } | null>(null)
  const [roomEdit, setRoomEdit] = useState<{ roomId: string; value: string; at: Point } | null>(null)
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [hover, setHover] = useState<SceneElement | null>(null)
  const [snap, setSnap] = useState<SnapGlyph | null>(null)
  const [toolError, setToolError] = useState("")
  const [cursor, setCursor] = useState<{ plan: Point; screen: Point } | null>(null)
  const [guides, setGuides] = useState<{ from: Point; to: Point }[]>([])
  const [rectStart, setRectStart] = useState<Point | null>(null)
  const [dimPicks, setDimPicks] = useState<DimensionPick[]>([])
  const [ghost, setGhost] = useState<(OpeningGhost & { kind: OpeningTool }) | null>(null)
  const [entry, setEntry] = useState<CursorEntry | null>(null)
  const wallChain = useEditor((state) => state.wallChain)
  const wallThickness = useEditor((state) => state.wallThickness)
  const wallLocation = useEditor((state) => state.wallLocation)
  const rectangleMode = useEditor((state) => state.rectangleMode)
  const symbolRotation = useEditor((state) => state.symbolRotation)
  const live = useRef({ cursor, rectStart, ghost, entry })
  live.current = { cursor, rectStart, ghost, entry }

  useEffect(() => {
    setRectStart(null)
    setDimPicks([])
    setGhost(null)
    setEntry(null)
    setGuides([])
    setCursor(null)
  }, [tool, symbol])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return
      }
      if (event.key === "Escape") {
        setRectStart(null)
        setDimPicks([])
        setEntry(null)
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey || !/^[0-9.,]$/.test(event.key)) {
        return
      }
      const state = useEditor.getState()
      const now = live.current
      let fields: CursorField[] | null = null
      if (state.tool === "wall" && state.wallChain) {
        const angle = now.cursor ? Math.round(lengthAngle(state.wallChain.anchorFace, now.cursor.plan).angleDeg) % 360 : 0
        fields = [
          { key: "length", label: "L", value: event.key },
          { key: "angle", label: "∠", value: String(angle) },
        ]
      } else if (state.tool === "rectangle" && now.rectStart) {
        fields = [
          { key: "width", label: "W", value: event.key },
          { key: "depth", label: "D", value: "" },
        ]
      } else if (isOpeningTool(state.tool) && now.ghost) {
        fields = [{ key: "distance", label: "Dist", value: event.key }]
      }
      if (!fields) {
        return
      }
      event.preventDefault()
      const at = now.cursor?.screen ?? (now.ghost ? planToScreen(state.camera, now.ghost.start) : { x: 40, y: 40 })
      setEntry({ fields, active: 0, at })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

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
      setSnap(null)
      if (session.kind === "rect") {
        setRectStart(null)
      }
      if (session.moved && session.kind !== "box" && session.kind !== "pan" && session.kind !== "rect") {
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

  function begin(kind: SessionKind, event: React.PointerEvent, id?: string, extra: Partial<Session> = {}) {
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
      alt: event.altKey,
      stop: () => undefined,
      ...extra,
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
      if (!session.moved && session.kind !== "box" && session.kind !== "pan" && session.kind !== "rect") {
        useEditor.getState().beginTransaction()
      }
      session.moved = true
      session.alt = ev.altKey
      session.shift = ev.shiftKey
      applySession(session, screen)
    }
    const onUp = (ev: PointerEvent) => {
      if (dragRef.current !== session) {
        session.stop()
        return
      }
      session.stop()
      dragRef.current = null
      finishSession(session, localPoint(ev, node))
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
    const node = host.current
    const state = useEditor.getState()
    if (!node) {
      return
    }
    if (isOpeningTool(state.tool)) {
      if (ghost) {
        placeGhost(ghost)
      }
      return
    }
    if (!isPlacing(state)) {
      begin("box", event)
      return
    }
    if (state.tool === "rectangle" && !state.symbol && !rectStart) {
      const anchor = toolPoint(localPoint(event, node), event.shiftKey).point
      setRectStart(anchor)
      begin("rect", event, undefined, { anchor })
      return
    }
    placeAt(localPoint(event, node), event.shiftKey)
  }

  function onHostMove(event: React.PointerEvent) {
    const node = host.current
    if (!node || dragRef.current) {
      return
    }
    const state = useEditor.getState()
    const screen = localPoint(event, node)
    if (isOpeningTool(state.tool)) {
      if (!entry) {
        setGhost(ghostAt(screen, state.tool))
      }
      return
    }
    if (!isPlacing(state)) {
      if (snap) {
        setSnap(null)
      }
      return
    }
    if (state.tool === "dimension" && !state.symbol) {
      const current = state.history?.plan
      const levelNow = current ? shownLevel(current) : undefined
      const raw = screenToPlan(state.camera, screen)
      const found = levelNow ? dimensionRefAt(levelNow, raw, editorTolerances.snap_px / state.camera.pixelsPerMeter) : null
      setSnap(found ? { at: planToScreen(state.camera, found.point), kind: found.ref.type === "vertex" ? "vertex" : "opening-edge" } : null)
      setCursor({ plan: raw, screen })
      return
    }
    const { point, hit } = toolPoint(screen, event.shiftKey)
    setSnap(hit ? { at: planToScreen(state.camera, hit.point), kind: hit.kind } : null)
    setGuides(hit?.kind === "alignment" ? (hit.guides ?? []).map((from) => ({ from, to: point })) : [])
    setCursor({ plan: point, screen })
  }

  /** The tool point under the cursor: snapped, then locked to 0° or 90° from the anchor while Shift is down. */
  function toolPoint(screen: Point, shift: boolean): { point: Point; hit: SnapHit | null } {
    const state = useEditor.getState()
    const raw = screenToPlan(state.camera, screen)
    const current = state.history?.plan
    const levelNow = current ? shownLevel(current) : undefined
    const chain = state.tool === "wall" ? state.wallChain : null
    const anchor = chain ? chain.anchorFace : state.tool === "rectangle" ? rectStart : null
    const previous = chain?.previous
      ? { x: chain.anchorFace.x, y: chain.anchorFace.y, dirX: chain.previous.to.x - chain.previous.from.x, dirY: chain.previous.to.y - chain.previous.from.y }
      : undefined
    const hit =
      current && levelNow
        ? snapPoint({ plan: current, levelId: levelNow.id, cursor: raw, pixelsPerMeter: state.camera.pixelsPerMeter, gridM: state.gridM, previous })
        : null
    const point = hit?.point ?? raw
    return { point: shift && anchor ? orthoLock(anchor, point) : point, hit }
  }

  function ghostAt(screen: Point, kind: OpeningTool): (OpeningGhost & { kind: OpeningTool }) | null {
    const state = useEditor.getState()
    const current = state.history?.plan
    const levelNow = current ? shownLevel(current) : undefined
    if (!current || !levelNow) {
      return null
    }
    const raw = screenToPlan(state.camera, screen)
    const wall = pickAt(current, levelNow.id, raw, editorTolerances.snap_px / state.camera.pixelsPerMeter).find((item) => item.kind === "wall")
    const found = wall ? openingGhost(levelNow, wall.id, raw, OPENING_WIDTH_M) : null
    return found ? { ...found, kind } : null
  }

  function placeGhost(target: OpeningGhost & { kind: OpeningTool }, distance?: number) {
    const state = useEditor.getState()
    const current = state.history?.plan
    if (!current) {
      return
    }
    const along = distance ?? (target.end === "a" ? target.distStart : target.distEnd)
    run(
      () => placeOpeningAt(current, target.wallId, target.kind, target.end, along, target.width, target.swingSide, state.activeLevelId),
      "The opening was not placed.",
    )
  }

  function applyEntry(typed: CursorEntry) {
    const state = useEditor.getState()
    const current = state.history?.plan
    const value = (key: string) => typed.fields.find((field) => field.key === key)?.value ?? ""
    setEntry(null)
    if (!current) {
      return
    }
    if (state.tool === "wall" && state.wallChain) {
      const metres = typedMetres(value("length"), state.dimensionUnit)
      const degrees = Number(value("angle").trim().replace(",", ".") || "0")
      if (!(metres > 0) || !Number.isFinite(degrees)) {
        setToolError("Type a length greater than 0 and an angle in degrees.")
        return
      }
      const chain = state.wallChain
      try {
        const drawn = extendWallTo(current, chain, pointAtAngle(chain.anchorFace, metres, degrees), state.wallThickness, state.wallLocation, state.activeLevelId)
        state.commit(drawn.plan)
        state.setWallChain(drawn.chain)
        setToolError("")
      } catch (caught) {
        setToolError(caught instanceof Error ? caught.message : "The wall was not drawn.")
      }
      return
    }
    if (state.tool === "rectangle" && rectStart) {
      const width = typedMetres(value("width"), state.dimensionUnit)
      const depth = typedMetres(value("depth"), state.dimensionUnit)
      if (!(width > 0) || !(depth > 0)) {
        setToolError("Type a width and a depth greater than 0.")
        return
      }
      const from = rectStart
      const to = rectangleCorner(from, cursor?.plan ?? from, width, depth)
      run(() => placeRectangle(current, from, to, state.wallThickness, state.rectangleMode, state.activeLevelId), "The rectangle was not drawn.")
      setRectStart(null)
      return
    }
    if (isOpeningTool(state.tool) && ghost) {
      const distance = typedMetres(value("distance"), state.dimensionUnit)
      if (!(distance >= 0)) {
        setToolError("Type a distance of 0 or more.")
        return
      }
      placeGhost(ghost, distance)
    }
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
      placeAt(localPoint(event, node), event.shiftKey)
      return
    }
    if (isOpeningTool(state.tool)) {
      const target = ghostAt(localPoint(event, node), state.tool)
      if (target) {
        placeGhost(target)
      }
      return
    }
    if (state.tool !== "select") {
      return
    }
    if (element.kind === "opening") {
      begin("opening", event, element.id)
      return
    }
    if (MOVABLE.has(element.kind)) {
      const item = { kind: element.kind, id: element.id }
      const inSelection = state.selection.some((entry) => entry.kind === item.kind && entry.id === item.id)
      const items = inSelection ? state.selection.filter((entry) => MOVABLE.has(entry.kind)) : [item]
      begin("item", event, element.id, { items })
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
      placeAt(localPoint(event, node), event.shiftKey)
      return
    }
    if (state.tool !== "select") {
      return
    }
    begin("vertex", event, vertexId)
  }

  function onGripDown(grip: GripSpec, event: React.PointerEvent) {
    if (event.button !== 0) {
      return
    }
    begin("grip", event, undefined, { grip })
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

  function onTempDimension(dimension: TempDimension) {
    setTempEdit({ dimension, value: String(displayFromMetres(dimension.valueM, useEditor.getState().dimensionUnit)) })
  }

  function onFlip(openingId: string, which: "hinge" | "side") {
    const state = useEditor.getState()
    const current = state.history?.plan
    const levelNow = current ? shownLevel(current) : undefined
    const opening = levelNow?.openings.find((item) => item.id === openingId)
    if (!current || !levelNow || !opening) {
      return
    }
    const patch =
      which === "side"
        ? { swingSide: opening.swingSide === "positive" ? ("negative" as const) : ("positive" as const) }
        : { swing: opening.swing === "left" ? ("right" as const) : ("left" as const) }
    run(() => setOpening(current, levelNow.id, openingId, patch), "The opening was not flipped.")
  }

  function onDoubleClick(event: React.MouseEvent) {
    const node = host.current
    const state = useEditor.getState()
    const current = state.history?.plan
    const levelNow = current ? shownLevel(current) : undefined
    if (!node || !current || !levelNow || state.tool !== "select") {
      return
    }
    const point = screenToPlan(state.camera, localPoint(event, node))
    const hit = pickAt(current, levelNow.id, point, editorTolerances.snap_px / state.camera.pixelsPerMeter).find((item) => item.kind === "room")
    const room = hit ? extractRooms(current, levelNow.id).rooms.find((item) => item.id === hit.id) : undefined
    if (!room) {
      return
    }
    state.setSelection([{ kind: "room", id: room.id }])
    setRoomEdit({ roomId: room.id, value: room.name, at: planToScreen(state.camera, roomLabelPoint(room.polygon)) })
  }

  function onContextMenuCapture(event: React.MouseEvent) {
    const node = host.current
    const state = useEditor.getState()
    const current = state.history?.plan
    const levelNow = current ? shownLevel(current) : undefined
    if (!node || !current || !levelNow) {
      return
    }
    const point = screenToPlan(state.camera, localPoint(event, node))
    const hit = pickAt(current, levelNow.id, point, editorTolerances.snap_px / state.camera.pixelsPerMeter)[0]
    const item = hit ? ({ kind: hit.kind, id: hit.id } as SelectionItem) : null
    if (item && !state.selection.some((entry) => entry.kind === item.kind && entry.id === item.id)) {
      state.setSelection([item])
    }
    setMenu({ hit: item, point })
  }

  function run(edit: () => Plan, failure: string) {
    try {
      useEditor.getState().commit(edit())
      setToolError("")
    } catch (caught) {
      setToolError(caught instanceof Error ? caught.message : failure)
    }
  }

  const editingSegment = dimensionEdit ? level?.dimensions.find((item) => item.id === dimensionEdit.id)?.segments[dimensionEdit.index] : undefined
  const menuOpening = menu?.hit?.kind === "opening" ? level?.openings.find((item) => item.id === menu.hit?.id) : undefined
  const menuWall = menu?.hit?.kind === "wall" ? menu.hit.id : null

  const toolPreview: ToolPreview = { guides }
  if (symbol && cursor) {
    toolPreview.symbol = { symbol, at: cursor.plan, rotationDeg: symbolRotation }
  } else if (tool === "wall" && wallChain && cursor) {
    toolPreview.wall = { from: wallChain.anchorFace, to: cursor.plan, thickness: wallThickness, location: wallLocation }
  } else if (tool === "rectangle" && rectStart && cursor) {
    toolPreview.rect = { from: rectStart, to: cursor.plan, thickness: wallThickness, mode: rectangleMode }
  } else if (tool === "dimension" && dimPicks.length > 0 && cursor) {
    toolPreview.dimension = { points: dimPicks.map((pick) => pick.point), cursor: cursor.plan }
  } else if (isOpeningTool(tool) && ghost) {
    toolPreview.ghost = ghost
  }

  return (
    <ContextMenu onOpenChange={(open) => (open ? undefined : setMenu(null))}>
      <ContextMenuTrigger asChild>
        <div
          ref={host}
          className="relative h-full w-full overflow-hidden bg-white"
          onPointerDown={onBackground}
          onPointerMove={onHostMove}
          onDoubleClick={onDoubleClick}
          onContextMenuCapture={onContextMenuCapture}
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
            >
              <Grips
                level={level}
                camera={camera}
                selection={tool === "select" ? selection : []}
                unit={dimensionUnit}
                snap={snap}
                onGripDown={onGripDown}
                onTempDimension={onTempDimension}
                onFlip={onFlip}
              />
              <ToolOverlay preview={toolPreview} camera={camera} unit={dimensionUnit} />
            </PlanSvg>
          ) : null}
          {entry ? <CursorInput entry={entry} onChange={setEntry} onApply={applyEntry} onCancel={() => setEntry(null)} /> : null}
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
          {tempEdit ? (
            <input
              className="absolute z-30 w-16 -translate-x-1/2 -translate-y-1/2 border border-blue-600 bg-white px-1 text-center text-xs text-blue-700"
              style={{ left: tempEdit.dimension.at.x, top: tempEdit.dimension.at.y }}
              value={tempEdit.value}
              autoFocus
              data-testid="temp-dim-input"
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => setTempEdit({ ...tempEdit, value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  applyTempDimension(tempEdit.dimension, tempEdit.value)
                } else if (event.key === "Escape") {
                  setTempEdit(null)
                }
              }}
              onBlur={() => setTempEdit(null)}
            />
          ) : null}
          {roomEdit ? (
            <input
              className="absolute z-30 w-32 -translate-x-1/2 -translate-y-1/2 border border-blue-600 bg-white px-1 text-center text-sm"
              style={{ left: roomEdit.at.x, top: roomEdit.at.y }}
              value={roomEdit.value}
              autoFocus
              data-testid="room-name-inline"
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => setRoomEdit({ ...roomEdit, value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  applyRoomName(roomEdit.roomId, roomEdit.value)
                } else if (event.key === "Escape") {
                  setRoomEdit(null)
                }
              }}
              onBlur={() => applyRoomName(roomEdit.roomId, roomEdit.value)}
            />
          ) : null}
          {toolError ? <p className="absolute bottom-2 left-2 z-40 bg-white px-2 text-xs text-red-700">{toolError}</p> : null}
          {box ? (
            <div
              className={
                box.x1 >= box.x0
                  ? "pointer-events-none absolute border border-blue-600 bg-blue-600/10"
                  : "pointer-events-none absolute border border-dashed border-green-600 bg-green-600/10"
              }
              data-testid="selection-box"
              data-mode={box.x1 >= box.x0 ? "window" : "crossing"}
              style={{
                left: Math.min(box.x0, box.x1),
                top: Math.min(box.y0, box.y1),
                width: Math.abs(box.x1 - box.x0),
                height: Math.abs(box.y1 - box.y0),
              }}
            />
          ) : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem data-testid="menu-delete" disabled={selection.length === 0} onSelect={() => useEditor.getState().deleteSelection()}>
          Delete
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem data-testid="menu-split" disabled={!menuWall} onSelect={() => menuWall && menu && splitHere(menuWall, menu.point)}>
          Split wall here
        </ContextMenuItem>
        <ContextMenuItem data-testid="menu-merge" disabled={!menuWall} onSelect={() => menuWall && mergeWall(menuWall)}>
          Merge collinear
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          data-testid="menu-flip-hinge"
          disabled={!menuOpening || (menuOpening.swing !== "left" && menuOpening.swing !== "right")}
          onSelect={() => menuOpening && onFlip(menuOpening.id, "hinge")}
        >
          Flip hinge
        </ContextMenuItem>
        <ContextMenuItem data-testid="menu-flip-side" disabled={!menuOpening || menuOpening.kind !== "door"} onSelect={() => menuOpening && onFlip(menuOpening.id, "side")}>
          Flip side
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )

  function splitHere(wallId: string, point: Point) {
    const state = useEditor.getState()
    const current = state.history?.plan
    const levelNow = current ? shownLevel(current) : undefined
    const wall = levelNow?.walls.find((item) => item.id === wallId)
    const a = wall ? levelNow?.vertices.find((vertex) => vertex.id === wall.a) : undefined
    const b = wall ? levelNow?.vertices.find((vertex) => vertex.id === wall.b) : undefined
    if (!current || !levelNow || !a || !b) {
      return
    }
    const foot = footOnLine(point, a, b)
    run(() => placeSplit(current, wallId, foot?.t ?? 0.5, levelNow.id), "The wall was not split.")
  }

  function mergeWall(wallId: string) {
    const current = useEditor.getState().history?.plan
    const levelNow = current ? shownLevel(current) : undefined
    if (!current || !levelNow) {
      return
    }
    run(() => mergeCollinearWall(current, levelNow.id, wallId), "The walls were not merged.")
  }

  function applyRoomName(roomId: string, value: string) {
    setRoomEdit(null)
    const current = useEditor.getState().history?.plan
    const levelNow = current ? shownLevel(current) : undefined
    const room = levelNow?.rooms.find((item) => item.id === roomId)
    if (!current || !levelNow || !room || room.name === value) {
      return
    }
    run(() => setRoomName(current, levelNow.id, roomId, value), "The room was not renamed.")
  }

  function applyTempDimension(dimension: TempDimension, value: string) {
    setTempEdit(null)
    const state = useEditor.getState()
    const current = state.history?.plan
    const levelNow = current ? shownLevel(current) : undefined
    const metres = metresFromDisplay(Number(value), state.dimensionUnit)
    const wall = levelNow?.walls.find((item) => item.id === dimension.wallId)
    if (!current || !levelNow || !wall || !(metres > 0)) {
      return
    }
    if (dimension.id === "length") {
      run(
        () => applyTypedDimension(current, levelNow.id, { a: { type: "vertex", id: wall.a }, b: { type: "vertex", id: wall.b }, lengthM: metres }),
        "The length was not applied.",
      )
      return
    }
    if (dimension.otherId) {
      const otherId = dimension.otherId
      run(() => setClearDistance(current, levelNow.id, wall.id, otherId, metres), "The clear distance was not applied.")
    }
  }

  function placeAt(screen: Point, shift = false) {
    const state = useEditor.getState()
    const current = state.history?.plan
    if (!current) {
      return
    }
    const point = toolPoint(screen, shift).point
    try {
      if (state.symbol) {
        placeArmedSymbol(point)
        state.setTool("select")
        setSnap(null)
        setToolError("")
        return
      }
      if (state.tool === "wall") {
        if (!state.wallChain) {
          const started = startWall(current, point, state.activeLevelId)
          state.commit(started.plan)
          state.setWallChain(started.chain)
        } else {
          if (Math.hypot(point.x - state.wallChain.anchorFace.x, point.y - state.wallChain.anchorFace.y) <= 0.001) {
            return
          }
          const drawn = extendWallTo(current, state.wallChain, point, state.wallThickness, state.wallLocation, state.activeLevelId)
          state.commit(drawn.plan)
          state.setWallChain(drawn.chain)
        }
        setToolError("")
        return
      }
      if (state.tool === "rectangle") {
        if (!rectStart) {
          setRectStart(point)
        } else {
          state.commit(placeRectangle(current, rectStart, point, state.wallThickness, state.rectangleMode, state.activeLevelId))
          setRectStart(null)
        }
        setToolError("")
        return
      }
      if (state.tool === "dimension") {
        const levelNow = shownLevel(current)
        if (!levelNow) {
          return
        }
        const raw = screenToPlan(state.camera, screen)
        const [first, second] = dimPicks
        if (first && second) {
          const offset = Math.round(dimensionOffset(first.point, second.point, raw) * 1000) / 1000
          state.commit(placeDimension(current, [first.ref, second.ref], offset, levelNow.id))
          setDimPicks([])
          setToolError("")
          return
        }
        const found = dimensionRefAt(levelNow, raw, editorTolerances.snap_px / state.camera.pixelsPerMeter)
        if (!found) {
          setToolError("Click a corner or an opening edge.")
          return
        }
        if (first && JSON.stringify(first.ref) === JSON.stringify(found.ref)) {
          return
        }
        setDimPicks([...dimPicks, found])
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
      placeAt(localPoint(event, node), event.shiftKey)
      return
    }
    if (isOpeningTool(state.tool)) {
      const point = screenToPlan(state.camera, localPoint(event, node))
      const target = openingGhost(levelNow, wallId, point, OPENING_WIDTH_M)
      if (target) {
        placeGhost({ ...target, kind: state.tool })
      } else {
        setToolError("The opening does not fit on this wall.")
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
      run(() => placeSplit(current, wallId, foot?.t ?? 0.5, state.activeLevelId), "The wall was not split.")
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
    setDimensionEdit(null)
    if (!current || !levelNow || !(metres > 0)) {
      return
    }
    run(() => applyTypedDimension(current, levelNow.id, { a: segment.a, b: segment.b, lengthM: metres }), "The dimension was not applied.")
  }

  function tryDraft(edit: () => Plan) {
    try {
      useEditor.getState().draft(edit())
    } catch {
      return
    }
  }

  function applySession(session: Session, screen: Point) {
    const state = useEditor.getState()
    const levelNow = shownLevel(session.base)
    if (!levelNow) {
      return
    }
    const point = screenToPlan(state.camera, screen)
    const origin = screenToPlan(state.camera, session.origin)
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
    if (session.kind === "rect") {
      session.last = screen
      const { point, hit } = toolPoint(screen, false)
      setSnap(hit ? { at: planToScreen(state.camera, hit.point), kind: hit.kind } : null)
      setCursor({ plan: point, screen })
      return
    }
    session.last = screen
    const vertexId = session.kind === "vertex" ? session.id : session.grip?.kind === "wall-end" ? session.grip.vertexId : undefined
    if (vertexId) {
      const snapped = snapPoint({
        plan: session.base,
        levelId: levelNow.id,
        cursor: point,
        pixelsPerMeter: state.camera.pixelsPerMeter,
        gridM: state.gridM,
        excludeVertexIds: [vertexId],
      })
      setSnap(snapped ? { at: planToScreen(state.camera, snapped.point), kind: snapped.kind } : null)
      tryDraft(() => moveVertex(session.base, levelNow.id, vertexId, snapped?.point ?? point))
      return
    }
    const wallId = session.kind === "wall" ? session.id : session.grip?.kind === "wall-middle" ? session.grip.wallId : undefined
    if (wallId) {
      tryDraft(() => moveWall(session.base, levelNow.id, wallId, sub(point, origin)))
      return
    }
    const openingId = session.kind === "opening" ? session.id : session.grip?.kind === "opening-center" ? session.grip.openingId : undefined
    if (openingId) {
      const opening = levelNow.openings.find((item) => item.id === openingId)
      const wall = opening ? levelNow.walls.find((item) => item.id === opening.wall) : undefined
      const a = wall ? levelNow.vertices.find((vertex) => vertex.id === wall.a) : undefined
      const b = wall ? levelNow.vertices.find((vertex) => vertex.id === wall.b) : undefined
      if (!opening || !a || !b) {
        return
      }
      const offset = offsetAlongWall(a, b, point, opening.width)
      tryDraft(() => setOpening(session.base, levelNow.id, opening.id, { offset }))
      return
    }
    if (session.kind === "item" && session.items) {
      const items = session.items
      tryDraft(() => moveSelection(session.base, levelNow.id, items, sub(point, origin)))
      return
    }
    const grip = session.grip
    if (!grip) {
      return
    }
    if (grip.kind === "wall-face") {
      const frame = wallFrame(levelNow, grip.wallId)
      const { thickness, keep } = faceDragThickness(frame, point, grip.face, session.alt)
      tryDraft(() => setWallThicknessFromFace(session.base, levelNow.id, grip.wallId, thickness, keep))
      return
    }
    if (grip.kind === "opening-edge") {
      const opening = levelNow.openings.find((item) => item.id === grip.openingId)
      const ends = opening ? openingEnds(levelNow, opening) : null
      if (!opening || !ends) {
        return
      }
      const edgePoint = grip.edge === "start" ? ends.a : ends.b
      const along = sub(ends.b, ends.a)
      const length = Math.hypot(along.x, along.y) || 1
      const outward = grip.edge === "end" ? { x: along.x / length, y: along.y / length } : { x: -along.x / length, y: -along.y / length }
      const amount = Math.round(dot(sub(point, edgePoint), outward) * 1000) / 1000
      tryDraft(() => setOpeningEdge(session.base, levelNow.id, opening.id, grip.edge, amount))
      return
    }
    const fixture = "fixtureId" in grip ? levelNow.fixtures.find((item) => item.id === grip.fixtureId) : undefined
    if (!fixture) {
      return
    }
    const center = { x: fixture.x, y: fixture.y }
    if (grip.kind === "fixture-rotate") {
      tryDraft(() => setFixtureRotation(session.base, levelNow.id, fixture.id, rotationFromGrip(center, point, session.shift)))
      return
    }
    const axis = rotate(grip.kind === "fixture-width" ? { x: 1, y: 0 } : { x: 0, y: 1 }, fixture.rotationDeg)
    const size = Math.min(3, Math.max(0.1, Math.round(2 * Math.abs(dot(sub(point, center), axis)) * 100) / 100))
    tryDraft(() =>
      setFixtureSize(session.base, levelNow.id, fixture.id, grip.kind === "fixture-width" ? size : fixture.width, grip.kind === "fixture-depth" ? size : fixture.depth),
    )
  }

  function finishSession(session: Session, screen: Point) {
    setBox(null)
    setSnap(null)
    const state = useEditor.getState()
    if (session.kind === "rect") {
      const current = state.history?.plan
      if (session.moved && session.anchor && current) {
        const from = session.anchor
        const to = toolPoint(screen, false).point
        run(() => placeRectangle(current, from, to, state.wallThickness, state.rectangleMode, state.activeLevelId), "The rectangle was not drawn.")
        setRectStart(null)
      }
      return
    }
    if (session.kind === "vertex" || session.kind === "wall" || session.kind === "opening" || session.kind === "grip" || session.kind === "item") {
      if (!session.moved) {
        if (session.kind === "grip") {
          const planNow = state.history?.plan
          const levelNow = planNow ? shownLevel(planNow) : undefined
          const point = screenToPlan(state.camera, session.origin)
          const hit = planNow && levelNow ? pickAt(planNow, levelNow.id, point, editorTolerances.snap_px / state.camera.pixelsPerMeter)[0] : undefined
          if (hit) {
            state.toggleSelection({ kind: hit.kind, id: hit.id }, session.shift)
          }
          return
        }
        if (session.id) {
          const kind = session.kind === "item" ? (session.items?.find((item) => item.id === session.id)?.kind ?? "fixture") : session.kind
          state.toggleSelection({ kind, id: session.id }, session.shift)
        }
        return
      }
      const levelNow = shownLevel(state.history?.plan ?? session.base)
      const current = state.history?.plan
      if (current && levelNow) {
        const point = screenToPlan(state.camera, screen)
        const openingId = session.kind === "opening" ? session.id : session.grip?.kind === "opening-center" ? session.grip.openingId : undefined
        const opening = openingId ? levelNow.openings.find((item) => item.id === openingId) : undefined
        if (opening) {
          const target = pickAt(session.base, levelNow.id, point, editorTolerances.snap_px / state.camera.pixelsPerMeter).find((item) => item.kind === "wall")
          if (target && target.id !== opening.wall) {
            const targetId = target.id
            try {
              state.draft(rehostOpening(session.base, levelNow.id, opening.id, targetId, point))
            } catch (caught) {
              setToolError(caught instanceof Error ? caught.message : "The opening was not moved.")
            }
          }
        }
        const fixtureId = session.kind === "item" && session.items?.length === 1 && session.items[0]?.kind === "fixture" ? session.items[0].id : undefined
        if (fixtureId) {
          tryDraft(() => snapFixtureToWall(current, levelNow.id, fixtureId, editorTolerances.snap_px / state.camera.pixelsPerMeter))
        }
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
    const mode = session.last.x >= session.origin.x ? "window" : "crossing"
    const found = itemsInBox(
      planNow,
      levelNow.id,
      {
        minX: Math.min(origin.x, corner.x),
        minY: Math.min(origin.y, corner.y),
        maxX: Math.max(origin.x, corner.x),
        maxY: Math.max(origin.y, corner.y),
      },
      mode,
    )
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
