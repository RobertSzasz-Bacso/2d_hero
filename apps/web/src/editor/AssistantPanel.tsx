import { useState } from "react"
import { Spinner } from "@/components/Busy.tsx"
import { Button } from "@/components/ui/button.tsx"
import { heroFetch } from "@/session.ts"

export default function AssistantPanel() {
  const [message, setMessage] = useState("")
  const [reply, setReply] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function ask() {
    const text = message.trim()
    if (!text || busy) {
      return
    }
    setBusy(true)
    setError("")
    setReply("")
    try {
      const response = await heroFetch("/api/cursor/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      })
      const body = (await response.json()) as { cursorKeySet?: boolean; reply?: string; error?: string; detail?: string }
      if (body.cursorKeySet === false) {
        setError("No Cursor key is saved. Open Settings and save a key.")
        return
      }
      if (!response.ok || body.error) {
        setError(body.error || body.detail || "Cursor could not answer.")
        return
      }
      setReply(body.reply || "")
    } catch {
      setError("Cursor could not answer.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-testid="cursor-chat" className="flex w-full max-w-lg flex-col gap-2 border-t border-slate-200 p-3 text-sm">
      <h2 className="font-medium">Cursor</h2>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void ask()
        }}
      >
        <textarea
          data-testid="cursor-message"
          className="min-h-16 rounded border border-slate-300 px-2 py-1"
          value={message}
          placeholder="Ask Cursor anything"
          onChange={(event) => setMessage(event.target.value)}
        />
        <Button type="submit" data-testid="cursor-ask" disabled={busy || message.trim().length === 0}>
          {busy ? <Spinner /> : null}
          Ask
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-red-800" data-testid="cursor-error">
          {error}
        </p>
      ) : null}
      {reply ? (
        <p className="whitespace-pre-wrap" data-testid="cursor-reply">
          {reply}
        </p>
      ) : null}
    </section>
  )
}
