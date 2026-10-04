import { create } from "zustand"
import { suppressDimension, syncAutoDimensions } from "@/core/dimensions.ts"
import { copySelection as copyItems, pasteClipboard, type Clipboard } from "@/core/draw.ts"
import { PlanHistory } from "@/core/history.ts"
import { removeSelection } from "@/core/ops.ts"
import type { Fixture, Plan, Point } from "@/core/plan-types.ts"
import { boundsOfPoints, fitCamera, panCamera, zoomAtCursor, type Bounds, type Camera } from "@/view/camera.ts"
import { heroFetch } from "@/session.ts"
import type { WallChain } from "./draw-actions.ts"
import { toggleItem, type SelectionItem } from "./select.ts"

export type EditorTool =
  | "select"
  | "wall"
  | "door"
  | "window"
  | "passage"
  | "room"
  | "separator"
  | "column"
  | "stair"
  | "text"
  | "split"

export type SaveStatus = "Saved" | "Saving" | "Error"

const CONFLICT = "This plan was saved somewhere else. Reloaded."

type EditorState = {
  projectId: string
  history: PlanHistory | null
  tick: number
  selection: SelectionItem[]
  camera: Camera
  stage: { width: number; height: number }
  saveStatus: SaveStatus
  saveError: string
  loadError: string
  ready: boolean
  dragging: boolean
  spaceDown: boolean
  dimensionUnit: "cm" | "mm"
  gridM: number
  tool: EditorTool
  symbol: Fixture["symbol"] | null
  wallChain: WallChain | null
  separatorStart: Point | null
  clipboard: Clipboard | null
  shortcutsOpen: boolean
  hideFurniture: boolean
  activeLevelId: string
  underlayVisible: boolean
  underlayOpacity: number
  show3d: boolean
  underlayBounds: Bounds | null
  load: (projectId: string, plan: Plan) => void
  setLoadError: (message: string) => void
  setGrid: (gridM: number, unit: "cm" | "mm") => void
  touch: () => void
  setDragging: (dragging: boolean) => void
  setSpaceDown: (spaceDown: boolean) => void
  setStage: (width: number, height: number) => void
  setSelection: (selection: SelectionItem[]) => void
  toggleSelection: (item: SelectionItem, shift: boolean) => void
  fit: () => void
  zoomAt: (cursor: Point, factor: number) => void
  panBy: (dx: number, dy: number) => void
  commit: (next: Plan) => void
  beginTransaction: () => void
  draft: (next: Plan) => void
  endTransaction: () => void
  cancelTransaction: () => void
  undo: () => void
  redo: () => void
  deleteSelection: () => void
  scheduleSave: () => void
  saveNow: () => void
  setTool: (tool: EditorTool) => void
  setSymbol: (symbol: Fixture["symbol"]) => void
  setWallChain: (chain: WallChain | null) => void
  setSeparatorStart: (point: Point | null) => void
  setShortcutsOpen: (open: boolean) => void
  setHideFurniture: (hide: boolean) => void
  copy: () => void
  paste: () => void
  setActiveLevel: (id: string) => void
  setUnderlayVisible: (visible: boolean) => void
  setUnderlayOpacity: (opacity: number) => void
  setShow3d: (show: boolean) => void
  setUnderlayBounds: (bounds: Bounds | null) => void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saving = false
let pending = false

function levelId(plan: Plan, activeLevelId: string): string | null {
  return plan.levels.find((level) => level.id === activeLevelId)?.id ?? plan.levels[0]?.id ?? null
}

function decorate(plan: Plan): Plan {
  let next = plan
  for (const level of plan.levels) {
    next = syncAutoDimensions(next, level.id)
  }
  return next
}

export const useEditor = create<EditorState>((set, get) => ({
  projectId: "",
  history: null,
  tick: 0,
  selection: [],
  camera: { pixelsPerMeter: 40, originX: 80, originY: 240 },
  stage: { width: 0, height: 0 },
  saveStatus: "Saved",
  saveError: "",
  loadError: "",
  ready: false,
  dragging: false,
  spaceDown: false,
  dimensionUnit: "cm",
  gridM: 1,
  tool: "select",
  symbol: null,
  wallChain: null,
  separatorStart: null,
  clipboard: null,
  shortcutsOpen: false,
  hideFurniture: false,
  activeLevelId: "",
  underlayVisible: true,
  underlayOpacity: 0.55,
  show3d: false,
  underlayBounds: null,
  load: (projectId, plan) => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    pending = false
    set({
      projectId,
      history: new PlanHistory(plan),
      tick: 0,
      selection: [],
      saveStatus: "Saved",
      saveError: "",
      loadError: "",
      ready: true,
      dragging: false,
      activeLevelId: plan.levels[0]?.id ?? "",
      underlayBounds: null,
    })
    get().fit()
  },
  setLoadError: (message) => set({ loadError: message, ready: false }),
  setGrid: (gridM, unit) => set({ gridM, dimensionUnit: unit }),
  touch: () => set((state) => ({ tick: state.tick + 1 })),
  setDragging: (dragging) => {
    if (dragging && saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    set({ dragging })
  },
  setSpaceDown: (spaceDown) => set({ spaceDown }),
  setStage: (width, height) => {
    const previous = get().stage
    set({ stage: { width, height } })
    if (previous.width === 0 && width > 0 && get().history) {
      get().fit()
    }
  },
  setSelection: (selection) => set({ selection }),
  toggleSelection: (item, shift) => set((state) => ({ selection: toggleItem(state.selection, item, shift) })),
  fit: () => {
    const { history, stage, activeLevelId, underlayBounds } = get()
    const level = history?.plan.levels.find((item) => item.id === activeLevelId) ?? history?.plan.levels[0]
    if (!history || stage.width < 10 || stage.height < 10) {
      return
    }
    const bounds = (level ? boundsOfPoints(level.vertices) : null) ?? underlayBounds
    if (!bounds) {
      return
    }
    set({ camera: fitCamera(bounds, stage, 48) })
  },
  zoomAt: (cursor, factor) => {
    const camera = get().camera
    const pixelsPerMeter = Math.min(4000, Math.max(2, camera.pixelsPerMeter * factor))
    set({ camera: zoomAtCursor(camera, cursor, pixelsPerMeter / camera.pixelsPerMeter) })
  },
  panBy: (dx, dy) => set((state) => ({ camera: panCamera(state.camera, dx, dy) })),
  commit: (next) => {
    const history = get().history
    if (!history || get().dragging) {
      return
    }
    const synced = decorate(next)
    if (JSON.stringify(synced) === JSON.stringify(history.plan)) {
      return
    }
    history.commitPlan(synced)
    set((state) => ({ tick: state.tick + 1 }))
    get().scheduleSave()
  },
  beginTransaction: () => {
    get().history?.begin()
    get().setDragging(true)
  },
  draft: (next) => {
    const history = get().history
    if (!history) {
      return
    }
    history.commitPlan(next)
    set((state) => ({ tick: state.tick + 1 }))
  },
  endTransaction: () => {
    const history = get().history
    if (history) {
      history.commitPlan(decorate(history.plan))
      history.end()
    }
    set((state) => ({ tick: state.tick + 1, dragging: false }))
  },
  cancelTransaction: () => {
    get().history?.cancel()
    set((state) => ({ tick: state.tick + 1, dragging: false }))
  },
  undo: () => {
    const history = get().history
    if (!history) {
      return
    }
    history.undo()
    set((state) => ({ tick: state.tick + 1, selection: [] }))
    get().saveNow()
  },
  redo: () => {
    const history = get().history
    if (!history) {
      return
    }
    history.redo()
    set((state) => ({ tick: state.tick + 1, selection: [] }))
    get().saveNow()
  },
  deleteSelection: () => {
    const { history, selection, activeLevelId } = get()
    const id = history ? levelId(history.plan, activeLevelId) : null
    if (!history || !id || selection.length === 0) {
      return
    }
    const geometry = selection.filter((item) => item.kind !== "dimension").map((item) => item.id)
    let next = history.plan
    if (geometry.length > 0) {
      next = removeSelection(next, id, geometry)
    }
    for (const item of selection) {
      if (item.kind === "dimension") {
        next = suppressDimension(next, id, item.id)
      }
    }
    get().commit(next)
    set({ selection: [] })
  },
  setTool: (tool) =>
    set({
      tool,
      wallChain: tool === "wall" ? get().wallChain : null,
      separatorStart: null,
      symbol: null,
    }),
  setSymbol: (symbol) => set({ symbol, tool: "select", wallChain: null, separatorStart: null }),
  setWallChain: (wallChain) => set({ wallChain }),
  setSeparatorStart: (separatorStart) => set({ separatorStart }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setHideFurniture: (hideFurniture) => set({ hideFurniture }),
  setActiveLevel: (id) => {
    set({ activeLevelId: id, selection: [] })
    get().fit()
  },
  setUnderlayVisible: (underlayVisible) => set({ underlayVisible }),
  setUnderlayOpacity: (underlayOpacity) => set({ underlayOpacity }),
  setShow3d: (show3d) => set({ show3d }),
  setUnderlayBounds: (underlayBounds) => {
    set({ underlayBounds })
    const level = get().history?.plan.levels.find((item) => item.id === get().activeLevelId)
    if (!level || level.vertices.length === 0) {
      get().fit()
    }
  },
  copy: () => {
    const { history, selection, activeLevelId } = get()
    const id = history ? levelId(history.plan, activeLevelId) : null
    if (!history || !id || selection.length === 0) {
      return
    }
    set({ clipboard: copyItems(history.plan, id, selection.map((item) => item.id)) })
  },
  paste: () => {
    const { history, clipboard, activeLevelId } = get()
    const id = history ? levelId(history.plan, activeLevelId) : null
    if (!history || !id || !clipboard) {
      return
    }
    get().commit(pasteClipboard(history.plan, id, clipboard))
  },
  scheduleSave: () => {
    if (get().dragging) {
      return
    }
    if (saveTimer) {
      clearTimeout(saveTimer)
    }
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushSave(get, set)
    }, 400)
  },
  saveNow: () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    void flushSave(get, set)
  },
}))

type StoreGet = typeof useEditor.getState
type StoreSet = typeof useEditor.setState

async function flushSave(get: StoreGet, set: StoreSet): Promise<void> {
  pending = true
  if (saving) {
    return
  }
  saving = true
  set({ saveStatus: "Saving", saveError: "" })
  try {
    while (pending) {
      pending = false
      const state = get()
      const history = state.history
      if (!history || !state.projectId) {
        continue
      }
      const plan = history.plan
      const response = await heroFetch(`/api/projects/${state.projectId}/plan`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": String(plan.revision),
        },
        body: JSON.stringify(plan),
      })
      if (response.status === 409) {
        const body = (await response.json()) as { plan?: Plan }
        if (body.plan) {
          get().history?.reset(body.plan)
        }
        set((current) => ({
          tick: current.tick + 1,
          saveStatus: "Error",
          saveError: CONFLICT,
          selection: [],
        }))
        pending = false
        return
      }
      if (!response.ok) {
        const detail = await readDetail(response)
        set({ saveStatus: "Error", saveError: detail })
        return
      }
      const saved = (await response.json()) as Plan
      get().history?.setRevision(saved.revision)
      set({ saveStatus: "Saved", saveError: "" })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the plan."
    set({ saveStatus: "Error", saveError: message })
  } finally {
    saving = false
    if (pending) {
      void flushSave(get, set)
    }
  }
}

async function readDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown }
    if (typeof body.detail === "string" && body.detail.length > 0) {
      return body.detail
    }
  } catch {
    return "Could not save the plan."
  }
  return "Could not save the plan."
}
