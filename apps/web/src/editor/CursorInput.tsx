import { useEffect, useRef } from "react"
import type { Point } from "@/core/plan-types.ts"

export type CursorField = { key: string; label: string; value: string }

export type CursorEntry = { fields: CursorField[]; active: number; at: Point }

/** Typed values next to the cursor. Tab moves to the next field, Enter applies, Escape cancels. */
export default function CursorInput({
  entry,
  onChange,
  onApply,
  onCancel,
}: {
  entry: CursorEntry
  onChange: (entry: CursorEntry) => void
  onApply: (entry: CursorEntry) => void
  onCancel: () => void
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const shown = useRef<number | null>(null)

  useEffect(() => {
    const input = refs.current[entry.active]
    if (!input) {
      return
    }
    if (document.activeElement !== input) {
      input.focus()
    }
    if (shown.current !== null && shown.current !== entry.active) {
      input.select()
    } else if (shown.current === null) {
      const end = input.value.length
      input.setSelectionRange(end, end)
    }
    shown.current = entry.active
  }, [entry.active])

  return (
    <div
      className="absolute z-30 flex gap-1 rounded border border-blue-600 bg-white/95 p-1 text-xs shadow"
      style={{ left: entry.at.x + 16, top: entry.at.y + 16 }}
      data-testid="cursor-input"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {entry.fields.map((field, index) => (
        <label key={field.key} className={`flex items-center gap-1 ${index === entry.active ? "text-blue-700" : "text-slate-500"}`}>
          {field.label}
          <input
            ref={(node) => {
              refs.current[index] = node
            }}
            className="w-14 border border-slate-300 px-1 text-right text-slate-900 focus:border-blue-600 focus:outline-none"
            data-testid={`cursor-input-${field.key}`}
            value={field.value}
            onFocus={() => {
              if (entry.active !== index) {
                onChange({ ...entry, active: index })
              }
            }}
            onChange={(event) =>
              onChange({ ...entry, fields: entry.fields.map((item, at) => (at === index ? { ...item, value: event.target.value } : item)) })
            }
            onKeyDown={(event) => {
              if (event.key === "Tab") {
                event.preventDefault()
                const step = event.shiftKey ? -1 : 1
                onChange({ ...entry, active: (entry.active + step + entry.fields.length) % entry.fields.length })
              } else if (event.key === "Enter") {
                event.preventDefault()
                onApply(entry)
              } else if (event.key === "Escape") {
                event.preventDefault()
                event.stopPropagation()
                onCancel()
              }
            }}
          />
        </label>
      ))}
    </div>
  )
}
