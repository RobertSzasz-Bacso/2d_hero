import { useState } from "react"
import { Button } from "@/components/ui/button.tsx"
import { extendWall } from "./draw-actions.ts"
import { SYMBOLS } from "./symbols.ts"
import { useEditor, type EditorTool } from "./store.ts"

const TOOLS: { id: EditorTool; label: string }[] = [
  { id: "select", label: "Select" },
  { id: "wall", label: "Wall" },
  { id: "door", label: "Door" },
  { id: "window", label: "Window" },
  { id: "passage", label: "Passage" },
  { id: "room", label: "Room" },
  { id: "separator", label: "Separator" },
  { id: "column", label: "Column" },
  { id: "stair", label: "Stair" },
  { id: "text", label: "Text" },
  { id: "split", label: "Split" },
]

export default function Toolbar() {
  const tool = useEditor((state) => state.tool)
  const symbol = useEditor((state) => state.symbol)
  const chain = useEditor((state) => state.wallChain)
  const hideFurniture = useEditor((state) => state.hideFurniture)
  const [length, setLength] = useState("1")
  const [angle, setAngle] = useState("0")
  const [error, setError] = useState("")

  function applyWall() {
    const state = useEditor.getState()
    const plan = state.history?.plan
    if (!plan || !state.wallChain) {
      setError("Click a start point first.")
      return
    }
    const metres = Number(length)
    const degrees = Number(angle)
    if (!(metres > 0) || !Number.isFinite(degrees)) {
      setError("Length and angle must be numbers.")
      return
    }
    try {
      const drawn = extendWall(plan, state.wallChain, metres, degrees)
      state.commit(drawn.plan)
      state.setWallChain(drawn.chain)
      setError("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The wall was not created.")
    }
  }

  return (
    <aside className="flex w-44 shrink-0 flex-col gap-2 overflow-auto border-r border-slate-200 bg-slate-50 p-2 text-sm">
      <div className="grid grid-cols-2 gap-1">
        {TOOLS.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={tool === item.id ? "default" : "outline"}
            data-testid={`tool-${item.id}`}
            onClick={() => useEditor.getState().setTool(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {tool === "wall" ? (
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            Length (m)
            <input
              className="h-8 rounded border border-slate-300 bg-white px-2"
              data-testid="wall-length"
              value={length}
              onChange={(event) => setLength(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  applyWall()
                }
              }}
            />
          </label>
          <label className="flex flex-col gap-1">
            Angle (deg)
            <input
              className="h-8 rounded border border-slate-300 bg-white px-2"
              data-testid="wall-angle"
              value={angle}
              onChange={(event) => setAngle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  applyWall()
                }
              }}
            />
          </label>
          <Button type="button" size="sm" data-testid="wall-apply" disabled={!chain} onClick={applyWall}>
            Apply
          </Button>
          <p className="text-xs text-slate-500">{chain ? "Length continues from the last point." : "Click the plan to start."}</p>
          {error ? <p className="text-xs text-red-700">{error}</p> : null}
        </div>
      ) : null}
      <h2 className="mt-2 font-medium">Symbols</h2>
      <div className="grid grid-cols-1 gap-1">
        {SYMBOLS.map((id) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={symbol === id ? "default" : "outline"}
            data-testid={`symbol-${id}`}
            onClick={() => useEditor.getState().setSymbol(id)}
          >
            {id}
          </Button>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={hideFurniture}
          onChange={(event) => useEditor.getState().setHideFurniture(event.target.checked)}
        />
        Hide furniture
      </label>
      <Button type="button" size="sm" variant="outline" data-testid="shortcuts" onClick={() => useEditor.getState().setShortcutsOpen(true)}>
        Shortcuts
      </Button>
    </aside>
  )
}
