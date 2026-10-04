import { useEffect } from "react"
import { Button } from "@/components/ui/button.tsx"
import type { Plan } from "@/core/plan-types.ts"
import { heroFetch } from "@/session.ts"
import PlanCanvas from "./PlanCanvas.tsx"
import PropertiesPanel from "./PropertiesPanel.tsx"
import Shortcuts from "./Shortcuts.tsx"
import Toolbar from "./Toolbar.tsx"
import { useEditor } from "./store.ts"

export default function Editor({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const ready = useEditor((state) => state.ready && state.projectId === projectId)
  const loadError = useEditor((state) => state.loadError)
  const saveStatus = useEditor((state) => state.saveStatus)
  const saveError = useEditor((state) => state.saveError)
  const planName = useEditor((state) => state.history?.plan.project.name ?? "")

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
        <Button type="button" variant="outline" data-testid="fit" onClick={() => useEditor.getState().fit()}>
          Fit
        </Button>
      </header>
      {saveError ? (
        <p role="alert" className="bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="save-error">
          {saveError}
        </p>
      ) : null}
      {loadError ? <p className="px-3 py-2 text-sm text-red-800">{loadError}</p> : null}
      <div className="relative flex min-h-0 flex-1">
        <Toolbar />
        <PlanCanvas />
        <PropertiesPanel />
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
