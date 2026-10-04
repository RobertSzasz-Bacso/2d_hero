import { useState } from "react"
import { Button } from "@/components/ui/button.tsx"
import { Spinner } from "@/components/Busy.tsx"
import { compilePlan, type Scale } from "@/drawing/compile.ts"
import { describePdfError, savePdf } from "@/pdf/save.ts"
import { writePdf } from "@/pdf/write.ts"
import type { TitleBlock } from "@/core/plan-types.ts"
import { heroFetch } from "@/session.ts"
import { useEditor } from "./store.ts"

export default function ExportDialog() {
  const plan = useEditor((state) => state.history?.plan ?? null)
  const dimensionUnit = useEditor((state) => state.dimensionUnit)
  const hideFurniture = useEditor((state) => state.hideFurniture)
  const [open, setOpen] = useState(false)
  const [scale, setScale] = useState<Scale>(plan?.sheet.scale ?? 50)
  const [tile, setTile] = useState(false)
  const [levelId, setLevelId] = useState(plan?.levels[0]?.id ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  if (!plan) {
    return null
  }

  const compiled = compilePlan(plan, {
    scale,
    tile,
    dimensionUnit,
    levelId: levelId || undefined,
    hideFurniture,
  })
  const smaller = compiled.nextScale

  async function download() {
    setBusy(true)
    setError("")
    try {
      if (!plan) {
        return
      }
      const defaults = await loadTitleDefaults()
      const drawing = compilePlan(plan, {
        scale,
        tile,
        dimensionUnit,
        levelId: levelId || undefined,
        hideFurniture,
        titleDefaults: defaults,
      })
      const bytes = await writePdf(drawing)
      await savePdf(bytes, `${plan.project.name || "plan"}.pdf`)
      setOpen(false)
    } catch (caught) {
      const message = describePdfError(caught)
      if (message) {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button type="button" variant="outline" data-testid="export-pdf" onClick={() => {
        setScale(plan.sheet.scale)
        setTile(false)
        setLevelId(plan.levels[0]?.id ?? "")
        setError("")
        setOpen(true)
      }}>
        PDF
      </Button>
      {open ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-labelledby="export-title">
          <div className="w-full max-w-md rounded bg-white p-4 shadow">
            <h2 id="export-title" className="text-base font-medium">Export PDF</h2>
            <p className="mt-2 text-sm text-slate-600">A3 {plan.sheet.orientation}. Line weights are millimetres on the sheet.</p>
            {plan.levels.length > 1 ? (
              <label className="mt-3 flex flex-col gap-1 text-sm">
                Level
                <select className="h-8 rounded border border-slate-300 px-2" value={levelId} onChange={(event) => setLevelId(event.target.value)}>
                  {plan.levels.map((level) => (
                    <option key={level.id} value={level.id}>{level.name || level.id}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="mt-3 flex gap-2">
              {([50, 100, 200] as const).map((choice) => (
                <Button key={choice} type="button" size="sm" variant={scale === choice && !tile ? "default" : "outline"} onClick={() => { setScale(choice); setTile(false) }}>
                  1:{choice}
                </Button>
              ))}
            </div>
            {compiled.fits ? (
              <p className="mt-3 text-sm">The plan fits at 1:{scale}{tile ? " as tiles" : ""}.</p>
            ) : (
              <div className="mt-3 text-sm">
                <p>The plan does not fit at 1:{scale}.</p>
                <div className="mt-2 flex gap-2">
                  {smaller ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => { setScale(smaller); setTile(false) }}>
                      Use 1:{smaller}
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant={tile ? "default" : "outline"} onClick={() => setTile(true)}>
                    Tile sheets
                  </Button>
                </div>
              </div>
            )}
            {error ? (
              <p role="alert" className="mt-2 text-sm text-red-700" data-testid="export-error">
                {error}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="button" data-testid="export-download" disabled={busy || (!compiled.fits && !tile)} onClick={() => void download()}>
                {busy ? <Spinner /> : null}
                {busy ? "Writing" : "Download"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

async function loadTitleDefaults(): Promise<Partial<TitleBlock>> {
  try {
    const response = await heroFetch("/api/settings")
    if (!response.ok) {
      return {}
    }
    const body = (await response.json()) as { titleBlock?: TitleBlock }
    return body.titleBlock ?? {}
  } catch {
    return {}
  }
}
