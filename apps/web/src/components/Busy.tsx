import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button.tsx"

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden="true" />
}

export function BusyOverlay({
  message,
  elapsed,
  progress,
  onCancel,
  testId = "busy-overlay",
}: {
  message: string
  elapsed?: number
  progress?: number
  onCancel?: () => void
  testId?: string
}) {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-white/80"
      role="status"
      data-testid={testId}
    >
      <div className="flex w-72 flex-col items-center gap-3 rounded border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <Spinner className="size-6" />
        <p className="text-center text-sm">{message}</p>
        {progress !== undefined ? (
          <div className="h-2 w-full overflow-hidden rounded bg-slate-200">
            <div className="h-2 rounded bg-slate-900" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
          </div>
        ) : null}
        {elapsed !== undefined ? <p className="text-xs text-slate-500">{elapsed}s</p> : null}
        {onCancel ? (
          <Button type="button" variant="outline" data-testid="import-cancel" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  )
}
