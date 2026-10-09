import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { Spinner } from "@/components/Busy.tsx"
import { heroFetch } from "@/session.ts"
import type { HostAdapter } from "./adapter.ts"

type Check = "checking" | "ok" | "rejected" | "error"

/** Holds the editor back until Trimble Connect has shared a token and the server accepts it. */
export default function HostedGate({ adapter, children }: { adapter: HostAdapter; children: ReactNode }) {
  const state = useSyncExternalStore(adapter.subscribe, adapter.getState)
  const [check, setCheck] = useState<Check>("checking")

  useEffect(() => {
    void adapter.start()
  }, [adapter])

  const connected = state.status === "connected"
  useEffect(() => {
    if (!connected) {
      return
    }
    const controller = new AbortController()
    setCheck("checking")
    heroFetch("/api/hosted/session", { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) {
          return
        }
        setCheck(response.ok ? "ok" : response.status === 401 ? "rejected" : "error")
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCheck("error")
        }
      })
    return () => controller.abort()
  }, [connected])

  if (connected && check === "ok") {
    return (
      <>
        <p
          data-testid="hosted-status"
          className="border-b bg-slate-50 px-4 py-1 text-xs text-slate-600"
        >
          Connected to Trimble Connect{state.projectName ? ` \u2014 ${state.projectName}` : ""}
        </p>
        {children}
      </>
    )
  }

  const problem = connected
    ? check === "rejected"
      ? "The server rejected the Trimble Connect session. Reload the page to sign in again."
      : check === "error"
        ? "The 2D Hero server could not be reached."
        : null
    : state.status === "denied" || state.status === "unavailable" || state.status === "ended"
      ? (state.message ?? "Trimble Connect is not available.")
      : null

  return (
    <main className="flex min-h-svh flex-col items-start gap-3 p-8">
      <h1 className="text-lg font-medium">2D Hero</h1>
      {problem ? (
        <p role="alert" className="text-sm text-red-700">
          {problem}
        </p>
      ) : (
        <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
          <Spinner />
          {state.status === "awaiting-permission"
            ? "Waiting for Trimble Connect to share your session. Approve the request if one appears."
            : "Connecting to Trimble Connect..."}
        </p>
      )}
    </main>
  )
}
