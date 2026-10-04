import { Button } from "@/components/ui/button.tsx"
import { useEditor } from "./store.ts"

const ROWS = [
  ["V", "Select"],
  ["W", "Wall"],
  ["D", "Door"],
  ["N", "Window"],
  ["R", "Room"],
  ["C", "Column"],
  ["S", "Stair"],
  ["T", "Text"],
  ["?", "This list"],
  ["Ctrl+C / Ctrl+V", "Copy and paste"],
  ["Ctrl+Z / Ctrl+Y", "Undo and redo"],
  ["Delete", "Delete the selection"],
  ["F", "Fit"],
  ["Esc", "Cancel"],
  ["Space", "Pan"],
]

export default function Shortcuts() {
  const open = useEditor((state) => state.shortcutsOpen)
  if (!open) {
    return null
  }
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30" data-testid="shortcuts-overlay">
      <div className="w-80 rounded bg-white p-4 shadow">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Shortcuts</h2>
          <Button type="button" size="sm" variant="outline" onClick={() => useEditor.getState().setShortcutsOpen(false)}>
            Close
          </Button>
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {ROWS.map(([key, label]) => (
            <li key={key} className="flex justify-between gap-4">
              <span>{label}</span>
              <kbd>{key}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
