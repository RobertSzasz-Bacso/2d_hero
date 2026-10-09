import { useEffect } from "react"
import { Button } from "@/components/ui/button.tsx"
import { BusyOverlay } from "@/components/Busy.tsx"
import type { Level, Plan } from "@/core/plan-types.ts"
import { heroFetch } from "@/session.ts"
import ExportDialog from "./ExportDialog.tsx"
import IssuesPanel from "./IssuesPanel.tsx"
import PlanCanvas from "./PlanCanvas.tsx"
import PropertiesPanel from "./PropertiesPanel.tsx"
import Shortcuts from "./Shortcuts.tsx"
import Toolbar from "./Toolbar.tsx"
import View3D from "./View3D.tsx"
import { useEditor } from "./store.ts"

const noLevels: Level[] = []

export default function Editor({
  projectId,
  onClose,
  onImport,
}: {
  projectId: string
  onClose: () => void
  onImport: () => void
}) {
  const ready = useEditor((state) => state.ready && state.projectId === projectId)
  const loadError = useEditor((state) => state.loadError)
  const saveStatus = useEditor((state) => state.saveStatus)
  const saveError = useEditor((state) => state.saveError)
  const planName = useEditor((state) => state.history?.plan.project.name ?? "")
  const levels = useEditor((state) => state.history?.plan.levels ?? noLevels)
  const imported = useEditor((state) => state.history?.plan.detection.source != null)
  const activeLevelId = useEditor((state) => state.activeLevelId)
  const underlayVisible = useEditor((state) => state.underlayVisible)
  const underlayOpacity = useEditor((state) => state.underlayOpacity)
  const show3d = useEditor((state) => state.show3d)
  const elevation = levels.find((level) => level.id === activeLevelId)?.elevation ?? levels[0]?.elevation ?? 0

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    heroFetch(`/api/projects/${projectId}/plan`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readDetail(response))
        }
        return (await response.json()) as Plan
      })
      .then((plan) => {
        if (active) {
          useEditor.getState().load(projectId, plan)
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return
        }
        useEditor.getState().setLoadError(error instanceof Error ? error.message : "Could not load the plan.")
      })
    heroFetch("/api/settings", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          return
        }
        const body = (await response.json()) as { dimensionUnit?: "cm" | "mm"; gridSpacingM?: number }
        if (!active) {
          return
        }
        if ((body.dimensionUnit === "cm" || body.dimensionUnit === "mm") && typeof body.gridSpacingM === "number") {
          useEditor.getState().setGrid(body.gridSpacingM, body.dimensionUnit)
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
      controller.abort()
    }
  }, [projectId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
      if (event.key === "Escape") {
        useEditor.getState().setSelection([])
        useEditor.getState().setWallChain(null)
        useEditor.getState().setShortcutsOpen(false)
        return
      }
      if (typing) {
        return
      }
      if (event.key === "?") {
        event.preventDefault()
        useEditor.getState().setShortcutsOpen(true)
      }
      if (event.key.toLowerCase() === "r" && useEditor.getState().symbol && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        useEditor.getState().rotateSymbol()
        return
      }
      const toolKey: Record<string, "select" | "wall" | "door" | "window" | "room" | "column" | "stair" | "text"> = {
        v: "select",
        w: "wall",
        d: "door",
        n: "window",
        r: "room",
        c: "column",
        s: "stair",
        t: "text",
      }
      const nextTool = toolKey[event.key.toLowerCase()]
      if (nextTool && !event.ctrlKey && !event.metaKey && !event.altKey) {
        useEditor.getState().setTool(nextTool)
      }
      if (event.key === "f" || event.key === "F") {
        event.preventDefault()
        useEditor.getState().fit()
      }
      if (event.code === "Space") {
        event.preventDefault()
        useEditor.getState().setSpaceDown(true)
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault()
        useEditor.getState().deleteSelection()
      }
      const arrows: Record<string, { x: number; y: number }> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: 1 },
        ArrowDown: { x: 0, y: -1 },
      }
      const arrow = arrows[event.key]
      if (arrow) {
        event.preventDefault()
        useEditor.getState().nudge(arrow, event.shiftKey ? 10 : 1)
      }
      const meta = event.ctrlKey || event.metaKey
      if (meta && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault()
        useEditor.getState().undo()
      }
      if (meta && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey))) {
        event.preventDefault()
        useEditor.getState().redo()
      }
      if (meta && event.key.toLowerCase() === "c") {
        event.preventDefault()
        useEditor.getState().copy()
      }
      if (meta && event.key.toLowerCase() === "v") {
        event.preventDefault()
        useEditor.getState().paste()
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        useEditor.getState().setSpaceDown(false)
      }
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [])

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-12 items-center gap-3 border-b border-slate-200 px-3">
        <Button type="button" variant="outline" onClick={onClose}>
          Projects
        </Button>
        <strong className="truncate">{planName || "Plan"}</strong>
        <span className="ml-auto text-sm" data-testid="save-status">
          {ready ? saveStatus : "Loading"}
        </span>
        {levels.length > 1 ? (
          <select
            data-testid="level-switcher"
            className="h-8 rounded border border-slate-300 px-2 text-sm"
            value={activeLevelId}
            onChange={(event) => useEditor.getState().setActiveLevel(event.target.value)}
          >
            {levels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name}
              </option>
            ))}
          </select>
        ) : null}
        {ready && imported ? (
          <Button type="button" variant="outline" data-testid="reimport" onClick={onImport}>
            Re-import
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          data-testid="underlay-toggle"
          onClick={() => useEditor.getState().setUnderlayVisible(!underlayVisible)}
        >
          {underlayVisible ? "Hide underlay" : "Show underlay"}
        </Button>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          Fade
          <input
            data-testid="underlay-fade"
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={underlayOpacity}
            onChange={(event) => useEditor.getState().setUnderlayOpacity(Number(event.target.value))}
          />
        </label>
        <Button type="button" variant="outline" data-testid="toggle-3d" onClick={() => useEditor.getState().setShow3d(!show3d)}>
          3D
        </Button>
        <Button type="button" variant="outline" data-testid="fit" onClick={() => useEditor.getState().fit()}>
          Fit
        </Button>
        <ExportDialog />
      </header>
      {saveError ? (
        <p role="alert" className="bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="save-error">
          {saveError}
        </p>
      ) : null}
      {loadError ? <p className="px-3 py-2 text-sm text-red-800">{loadError}</p> : null}
      <div className="relative flex min-h-0 flex-1">
        {!ready && !loadError ? <BusyOverlay message="Loading plan..." /> : null}
        {ready && imported && levels.length === 0 ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/90" data-testid="no-storey">
            <p className="text-sm">This project has no storey yet.</p>
            <Button type="button" onClick={onImport}>
              Back to import
            </Button>
          </div>
        ) : null}
        <Toolbar />
        <PlanCanvas />
        {show3d ? (
          <View3D
            projectId={projectId}
            elevation={elevation}
            onPlan={(plan) => useEditor.getState().load(projectId, plan)}
          />
        ) : null}
        <aside className="flex w-72 shrink-0 flex-col border-l border-slate-200 bg-slate-50">
          <div className="min-h-0 flex-1 overflow-auto">
            <PropertiesPanel />
          </div>
        </aside>
        <IssuesPanel />
        <Shortcuts />
      </div>
    </div>
  )
}

async function readDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown }
    if (typeof body.detail === "string" && body.detail.length > 0) {
      return body.detail
    }
  } catch {
    return "Could not load the plan."
  }
  return "Could not load the plan."
}
