import { create } from "zustand"
import { PlanHistory } from "@/core/history.ts"
import { removeSelection } from "@/core/ops.ts"
import type { Plan, Point } from "@/core/plan-types.ts"
import { boundsOfPoints, fitCamera, panCamera, zoomAtCursor, type Camera } from "@/view/camera.ts"
import { heroFetch } from "@/session.ts"
import { toggleItem, type SelectionItem } from "./select.ts"

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
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saving = false
let pending = false

function levelId(plan: Plan): string | null {
  return plan.levels[0]?.id ?? null
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
    const { history, stage } = get()
    const level = history?.plan.levels[0]
    if (!history || !level || stage.width < 10 || stage.height < 10) {
      return
    }
    const bounds = boundsOfPoints(level.vertices)
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
    history.commitPlan(next)
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
    get().history?.end()
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
    const { history, selection } = get()
    const id = history ? levelId(history.plan) : null
    if (!history || !id || selection.length === 0) {
      return
    }
    const next = removeSelection(
      history.plan,
      id,
      selection.map((item) => item.id),
    )
    history.commitPlan(next)
    set((state) => ({ tick: state.tick + 1, selection: [] }))
    get().scheduleSave()
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
