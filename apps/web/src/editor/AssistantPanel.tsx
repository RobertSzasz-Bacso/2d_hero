import { useEffect, useState } from "react"
import { applyAiOps, type AiOp } from "@/core/ai.ts"
import type { Plan } from "@/core/plan-types.ts"
import { heroFetch } from "@/session.ts"
import { Button } from "@/components/ui/button.tsx"
import { useEditor } from "./store.ts"

type ProposeBody = {
  cursorKeySet?: boolean
  ops?: AiOp[]
  error?: string
  detail?: string
}

export default function AssistantPanel({ projectId }: { projectId: string }) {
  const [keySet, setKeySet] = useState<boolean | null>(null)
  const [instruction, setInstruction] = useState("")
  const [ops, setOps] = useState<AiOp[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    heroFetch("/api/settings", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          return
        }
        const body = (await response.json()) as { cursorKeySet?: boolean }
        if (active) {
          setKeySet(body.cursorKeySet === true)
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
      controller.abort()
    }
  }, [projectId])

  async function ask() {
    const text = instruction.trim()
    if (!text || busy) {
      return
    }
    setBusy(true)
    setError("")
    try {
      const response = await heroFetch(`/api/projects/${projectId}/ai/propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: text }),
      })
      const body = (await response.json()) as ProposeBody
      if (body.cursorKeySet === false) {
        setKeySet(false)
        setOps([])
        useEditor.getState().setAiPreview(null)
        return
      }
      if (!response.ok) {
        setError(body.detail ?? "The assistant could not run.")
        return
      }
      if (body.error) {
        setError(body.error)
        setOps([])
        useEditor.getState().setAiPreview(null)
        return
      }
      const next = Array.isArray(body.ops) ? body.ops : []
      const current = useEditor.getState().history?.plan
      if (!current) {
        return
      }
      useEditor.getState().setAiPreview(applyAiOps(current, next))
      setOps(next)
    } catch {
      setError("The assistant could not run.")
    } finally {
      setBusy(false)
    }
  }

  async function accept() {
    setBusy(true)
    setError("")
    try {
      const response = await heroFetch(`/api/projects/${projectId}/ai/accept`, { method: "POST" })
      const body = (await response.json()) as Plan & { detail?: string }
      if (!response.ok) {
        setError(body.detail ?? "The proposal could not be accepted.")
        return
      }
      useEditor.getState().acceptServerPlan(body)
      setOps([])
    } catch {
      setError("The proposal could not be accepted.")
    } finally {
      setBusy(false)
    }
  }

  async function reject() {
    setBusy(true)
    setError("")
    try {
      await heroFetch(`/api/projects/${projectId}/ai/reject`, { method: "POST" })
      useEditor.getState().setAiPreview(null)
      setOps([])
    } catch {
      setError("The proposal could not be rejected.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-testid="ai-panel" className="border-t border-slate-200 p-3 text-sm">
      <h2 className="mb-2 font-medium">Assistant</h2>
      {keySet === false ? (
        <p data-testid="ai-key-missing">
          No Cursor key is saved. Go back to Projects and open Settings to save a key.
        </p>
      ) : null}
      {keySet ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void ask()
          }}
        >
          <textarea
            data-testid="ai-instruction"
            className="min-h-16 rounded border border-slate-300 px-2 py-1"
            value={instruction}
            placeholder="Ask for a plan change"
            onChange={(event) => setInstruction(event.target.value)}
          />
          <Button type="submit" data-testid="ai-ask" disabled={busy || instruction.trim().length === 0}>
            Ask
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-red-800" data-testid="ai-error">
          {error}
        </p>
      ) : null}
      {ops.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2" data-testid="ai-preview">
          <p className="font-medium">Preview</p>
          <ul className="space-y-1">
            {ops.map((op, index) => (
              <li key={`${op.op}-${index}`}>{describeOp(op)}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button type="button" data-testid="ai-accept" disabled={busy} onClick={() => void accept()}>
              Accept
            </Button>
            <Button type="button" variant="outline" data-testid="ai-reject" disabled={busy} onClick={() => void reject()}>
              Reject
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function describeOp(op: AiOp): string {
  if (op.op === "set_wall_thickness") {
    return `Wall ${op.wallId} thickness ${op.thickness} m`
  }
  if (op.op === "move_wall") {
    return `Move wall ${op.wallId}`
  }
  if (op.op === "set_room_name") {
    return `Room ${op.roomId} name ${op.name}`
  }
  return `Edit opening ${op.openingId}`
}
