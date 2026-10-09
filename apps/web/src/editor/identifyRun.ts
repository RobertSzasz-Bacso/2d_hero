/** Furniture detection runs as a background job so no single request is long. A tunnel cuts a
 * request at about 100 s and answers with an HTML page; the start call and each poll are short. */

export interface IdentifyPayload {
  cursorKeySet?: boolean
  plan?: unknown
  detail?: string
}

export interface IdentifyResult {
  status: number
  body: IdentifyPayload
}

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>

const POLL_MS = 1500
const MAX_BAD_POLLS = 5
const CUT = "The connection was cut before the server answered. Try again."

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json()
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function runIdentify(
  projectId: string,
  request: unknown,
  fetcher: Fetcher,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<IdentifyResult> {
  const started = await fetcher(`/api/projects/${projectId}/identify/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  })
  const first = await readJson(started)
  if (!started.ok || !first || typeof first.id !== "string") {
    const detail = first && typeof first.detail === "string" ? first.detail : CUT
    return { status: started.status, body: { detail } }
  }
  let bad = 0
  for (;;) {
    await wait(POLL_MS)
    let polled: Response | null = null
    try {
      polled = await fetcher(`/api/identify/${first.id}`)
    } catch {
      polled = null
    }
    const state = polled && polled.ok ? await readJson(polled) : null
    if (!state) {
      bad += 1
      if (bad >= MAX_BAD_POLLS) {
        return { status: polled?.status ?? 0, body: { detail: CUT } }
      }
      continue
    }
    bad = 0
    if (state.state === "done") {
      return { status: Number(state.status), body: (state.body ?? {}) as IdentifyPayload }
    }
  }
}
