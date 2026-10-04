import { snapFixtureToWall } from "@/core/grips.ts"
import type { Fixture, Plan, Point } from "@/core/plan-types.ts"
import { editorTolerances } from "@/core/tolerances.ts"
import { screenToPlan } from "@/view/camera.ts"
import { placeFixture } from "./draw-actions.ts"
import { SYMBOLS, symbolPolylines } from "./symbols.ts"
import { useEditor } from "./store.ts"

const LABELS: Record<Fixture["symbol"], string> = {
  toilet: "Toilet",
  sink: "Sink",
  bathtub: "Bathtub",
  shower: "Shower",
  "kitchen-counter": "Counter",
  stove: "Stove",
  "bed-double": "Double bed",
  sofa: "Sofa",
  table: "Table",
  wardrobe: "Wardrobe",
  block: "Block",
  chair: "Chair",
}

function Thumbnail({ symbol }: { symbol: Fixture["symbol"] }) {
  return (
    <svg viewBox="-0.6 -0.6 1.2 1.2" className="h-10 w-10" aria-hidden="true">
      <g transform="scale(1,-1)" fill="none" stroke="currentColor" strokeWidth={0.03} strokeDasharray={symbol === "block" ? "0.08 0.04" : undefined}>
        {symbolPolylines(symbol).map((line, index) => (
          <polyline key={index} points={line.map((point) => `${point.x},${point.y}`).join(" ")} />
        ))}
      </g>
    </svg>
  )
}

/** Place the armed symbol at a plan point, with its back snapped to a wall face within `snap_px`. */
export function placeArmedSymbol(point: Point): void {
  const state = useEditor.getState()
  const plan = state.history?.plan
  if (!plan || !state.symbol) {
    return
  }
  let next: Plan = placeFixture(plan, state.symbol, point, state.symbolRotation, state.activeLevelId)
  const level = next.levels.find((item) => item.id === state.activeLevelId) ?? next.levels[0]
  const added = level?.fixtures[level.fixtures.length - 1]
  if (level && added) {
    try {
      next = snapFixtureToWall(next, level.id, added.id, editorTolerances.snap_px / state.camera.pixelsPerMeter)
    } catch {
      // The fixture stays where it was dropped.
    }
  }
  state.commit(next)
}

function dropAt(clientX: number, clientY: number): void {
  const stage = document.querySelector<HTMLElement>('[data-testid="plan-stage"]')
  if (!stage) {
    return
  }
  const rect = stage.getBoundingClientRect()
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return
  }
  placeArmedSymbol(screenToPlan(useEditor.getState().camera, { x: clientX - rect.left, y: clientY - rect.top }))
}

export default function SymbolLibrary() {
  const armed = useEditor((state) => state.symbol)
  const rotation = useEditor((state) => state.symbolRotation)

  function onPointerDown(symbol: Fixture["symbol"], event: React.PointerEvent) {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    useEditor.getState().setSymbol(symbol)
    const origin = { x: event.clientX, y: event.clientY }
    let moved = false
    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) >= 4) {
        moved = true
      }
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      if (!moved) {
        return
      }
      dropAt(ev.clientX, ev.clientY)
      useEditor.getState().setTool("select")
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  return (
    <section className="flex flex-col gap-1">
      <h2 className="mt-2 font-medium">Symbols</h2>
      <p className="text-xs text-slate-500">{armed ? `Click or drop to place. R rotates (${rotation}°).` : "Drag onto the plan, or click then place."}</p>
      <div className="grid grid-cols-3 gap-1">
        {SYMBOLS.map((id) => (
          <button
            key={id}
            type="button"
            draggable={false}
            title={LABELS[id]}
            data-testid={`symbol-${id}`}
            className={`flex flex-col items-center rounded border px-0.5 py-1 text-[10px] leading-tight ${
              armed === id ? "border-blue-700 bg-blue-50 text-blue-800" : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
            }`}
            onPointerDown={(event) => onPointerDown(id, event)}
          >
            <Thumbnail symbol={id} />
            <span className="w-full truncate">{LABELS[id]}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
