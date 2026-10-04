import { useState } from "react"
import { Button } from "@/components/ui/button.tsx"
import type { RectangleMode, WallLocation } from "@/core/draw.ts"
import SymbolLibrary from "./SymbolLibrary.tsx"
import { useEditor, type EditorTool } from "./store.ts"

const TOOLS: { id: EditorTool; label: string }[] = [
  { id: "select", label: "Select" },
  { id: "wall", label: "Wall" },
  { id: "rectangle", label: "Rectangle" },
  { id: "door", label: "Door" },
  { id: "window", label: "Window" },
  { id: "passage", label: "Passage" },
  { id: "dimension", label: "Dimension" },
  { id: "room", label: "Room" },
  { id: "separator", label: "Separator" },
  { id: "column", label: "Column" },
  { id: "stair", label: "Stair" },
  { id: "text", label: "Text" },
  { id: "split", label: "Split" },
]

const PRESETS_CM = [10, 12.5, 15, 20, 25, 30, 36.5]

function WallSettings({ showLocation }: { showLocation: boolean }) {
  const thickness = useEditor((state) => state.wallThickness)
  const location = useEditor((state) => state.wallLocation)
  const [custom, setCustom] = useState("")
  const thicknessCm = Math.round(thickness * 1000) / 10

  function applyCustom(value: string) {
    const cm = Number(value)
    if (cm > 0 && cm <= 150) {
      useEditor.getState().setWallThickness(Math.round(cm * 10) / 1000)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-slate-600">Thickness (cm)</span>
      <div className="grid grid-cols-4 gap-1">
        {PRESETS_CM.map((cm) => (
          <Button
            key={cm}
            type="button"
            size="sm"
            className="h-7 px-1 text-xs"
            variant={thicknessCm === cm ? "default" : "outline"}
            data-testid={`wall-thickness-${cm}`}
            onClick={() => useEditor.getState().setWallThickness(Math.round(cm * 10) / 1000)}
          >
            {cm}
          </Button>
        ))}
        <input
          className="h-7 rounded border border-slate-300 bg-white px-1 text-xs"
          placeholder={PRESETS_CM.includes(thicknessCm) ? "Other" : String(thicknessCm)}
          data-testid="wall-thickness-custom"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          onBlur={() => applyCustom(custom)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              applyCustom(custom)
            }
          }}
        />
      </div>
      {showLocation ? (
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Location line
          <select
            className="h-8 rounded border border-slate-300 bg-white px-1 text-sm text-slate-900"
            data-testid="wall-location"
            value={location}
            onChange={(event) => useEditor.getState().setWallLocation(event.target.value as WallLocation)}
          >
            <option value="center">Centerline</option>
            <option value="left">Left face</option>
            <option value="right">Right face</option>
          </select>
        </label>
      ) : null}
    </div>
  )
}

export default function Toolbar() {
  const tool = useEditor((state) => state.tool)
  const chain = useEditor((state) => state.wallChain)
  const rectangleMode = useEditor((state) => state.rectangleMode)
  const hideFurniture = useEditor((state) => state.hideFurniture)

  return (
    <aside className="flex w-48 shrink-0 flex-col gap-2 overflow-auto border-r border-slate-200 bg-slate-50 p-2 text-sm">
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
          <WallSettings showLocation />
          <p className="text-xs text-slate-500">
            {chain ? "Type a length at the cursor. Tab for the angle, Enter to draw. Shift locks to 0° or 90°." : "Click the plan to start."}
          </p>
        </div>
      ) : null}
      {tool === "rectangle" ? (
        <div className="flex flex-col gap-1">
          <WallSettings showLocation={false} />
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Box is
            <select
              className="h-8 rounded border border-slate-300 bg-white px-1 text-sm text-slate-900"
              data-testid="rect-mode"
              value={rectangleMode}
              onChange={(event) => useEditor.getState().setRectangleMode(event.target.value as RectangleMode)}
            >
              <option value="interior">Interior (clear room)</option>
              <option value="centerline">Centerline</option>
            </select>
          </label>
          <p className="text-xs text-slate-500">Drag two corners, or click a corner and type width, Tab, depth.</p>
        </div>
      ) : null}
      {tool === "door" || tool === "window" || tool === "passage" ? (
        <p className="text-xs text-slate-500">Hover a wall. Click to place, or type the distance from the nearer inner corner.</p>
      ) : null}
      {tool === "dimension" ? <p className="text-xs text-slate-500">Click two corners or opening edges, then where the line goes.</p> : null}
      <SymbolLibrary />
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
