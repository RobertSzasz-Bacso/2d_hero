import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button.tsx"
import { BusyOverlay } from "@/components/Busy.tsx"
import { heroFetch } from "@/session.ts"

type Guess = { units: string; upAxis: string }

export default function ImportPanel({
  onOpen,
  projectId: resumeId = null,
}: {
  onOpen: (projectId: string) => void
  projectId?: string | null
}) {
  const [projectId, setProjectId] = useState<string | null>(resumeId)
  const [guess, setGuess] = useState<Guess | null>(null)
  const [units, setUnits] = useState("auto")
  const [upAxis, setUpAxis] = useState("auto")
  const [progress, setProgress] = useState("")
  const [percent, setPercent] = useState(0)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [elapsed, setElapsed] = useState(0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!jobId) {
      return
    }
    const startedAt = Date.now()
    setElapsed(0)
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [jobId])

  useEffect(() => {
    if (!resumeId) {
      return
    }
    let active = true
    setProjectId(resumeId)
    setBusy("Reading the file...")
    heroFetch(`/api/projects/${resumeId}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readDetail(response))
        }
        return (await response.json()) as { importState?: string; jobId?: string | null; importError?: string }
      })
      .then(async (project) => {
        if (!active) {
          return
        }
        if (project.importState === "running" && project.jobId) {
          setBusy("")
          await follow(resumeId, project.jobId)
          return
        }
        if (project.importError) {
          setError(project.importError)
        }
        await loadGuess(resumeId)
      })
      .catch((reason: unknown) => {
        if (!active) {
          return
        }
        setBusy("")
        setError(reason instanceof Error ? reason.message : "Could not open the project.")
      })
    return () => {
      active = false
    }
  }, [resumeId])

  async function loadGuess(id: string) {
    setBusy("Reading the file...")
    const guessed = await heroFetch(`/api/projects/${id}/guess`)
    if (!alive.current) {
      return
    }
    setBusy("")
    if (!guessed.ok) {
      setError(await readDetail(guessed))
      return
    }
    applyGuess((await guessed.json()) as Guess)
  }

  function applyGuess(next: Guess) {
    setGuess(next)
    setUnits(next.units === "m" || next.units === "mm" ? next.units : "auto")
    setUpAxis(next.upAxis === "x" || next.upAxis === "y" || next.upAxis === "z" ? next.upAxis : "auto")
  }

  async function follow(id: string, nextJobId: string) {
    setJobId(nextJobId)
    setError("")
    const done = await watch(nextJobId, (text, value) => {
      if (!alive.current) {
        return
      }
      setProgress(text)
      setPercent(value)
    })
    if (!alive.current) {
      return
    }
    setJobId(null)
    if (done === "done") {
      onOpen(id)
      return
    }
    setProgress("")
    setError(done)
    await loadGuess(id)
  }

  async function upload(file: File) {
    setError("")
    setGuess(null)
    setBusy("Copying file...")
    const body = new FormData()
    body.set("file", file)
    body.set("name", file.name.replace(/\.[^.]+$/, ""))
    const created = await heroFetch("/api/projects", { method: "POST", body })
    if (!alive.current) {
      return
    }
    if (!created.ok) {
      setBusy("")
      setError(await readDetail(created))
      return
    }
    const project = (await created.json()) as { id: string }
    setProjectId(project.id)
    await loadGuess(project.id)
  }

  async function browse() {
    setError("")
    setBusy("Waiting for the Windows file dialog (it may be behind this window)")
    const selected = await heroFetch("/api/dialogs/open-file", { method: "POST" })
    if (!alive.current) {
      return
    }
    if (!selected.ok) {
      setBusy("")
      setError(await readDetail(selected))
      return
    }
    const body = (await selected.json()) as { path?: string }
    if (!body.path) {
      setBusy("")
      setError("No file was selected.")
      return
    }
    setBusy("Reading the file...")
    const created = await heroFetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkPath: body.path }),
    })
    if (!alive.current) {
      return
    }
    if (!created.ok) {
      setBusy("")
      setError(await readDetail(created))
      return
    }
    const project = (await created.json()) as { id: string }
    setProjectId(project.id)
    await loadGuess(project.id)
  }

  async function start() {
    if (!projectId) {
      return
    }
    setError("")
    const response = await heroFetch(`/api/projects/${projectId}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "import", units, upAxis }),
    })
    if (!alive.current) {
      return
    }
    if (!response.ok) {
      setError(await readDetail(response))
      return
    }
    const job = (await response.json()) as { id: string }
    await follow(projectId, job.id)
  }

  async function cancel() {
    if (!jobId) {
      return
    }
    await heroFetch(`/api/jobs/${jobId}/cancel`, { method: "POST" })
  }

  const overlay = jobId
    ? progress || "Starting import..."
    : busy

  return (
    <section className="relative flex w-full max-w-lg flex-col gap-3 rounded border border-slate-200 p-4">
      <h2 className="text-sm font-medium">Import a scan</h2>
      <label className="flex cursor-pointer flex-col gap-2 rounded border border-dashed border-slate-300 p-4 text-sm">
        Drop a file or choose one
        <input
          data-testid="import-file"
          className="text-sm"
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              void upload(file)
            }
          }}
        />
      </label>
      <Button type="button" variant="outline" onClick={() => void browse()} disabled={busy.length > 0 || jobId !== null}>
        Browse
      </Button>
      {guess ? (
        <div className="flex flex-col gap-2 text-sm">
          <p data-testid="guess-units">Guessed units: {guess.units}</p>
          <p data-testid="guess-up">Guessed up axis: {guess.upAxis}</p>
          <label className="flex items-center gap-2">
            Units
            <select className="h-8 rounded border border-slate-300 px-2" value={units} onChange={(event) => setUnits(event.target.value)}>
              <option value="auto">auto</option>
              <option value="m">m</option>
              <option value="mm">mm</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            Up axis
            <select className="h-8 rounded border border-slate-300 px-2" value={upAxis} onChange={(event) => setUpAxis(event.target.value)}>
              <option value="auto">auto</option>
              <option value="x">x</option>
              <option value="y">y</option>
              <option value="z">z</option>
            </select>
          </label>
          <Button type="button" data-testid="import-start" onClick={() => void start()} disabled={jobId !== null}>
            Start import
          </Button>
        </div>
      ) : null}
      {progress && !jobId ? (
        <p data-testid="import-progress" className="text-sm">
          {progress}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700" data-testid="import-error">
          {error}
        </p>
      ) : null}
      {overlay ? (
        <BusyOverlay
          testId="import-overlay"
          message={jobId ? progress || "Starting import..." : busy}
          elapsed={jobId ? elapsed : undefined}
          progress={jobId ? percent : undefined}
          onCancel={jobId ? () => void cancel() : undefined}
        />
      ) : null}
    </section>
  )
}

async function watch(jobId: string, setProgress: (text: string, percent: number) => void): Promise<string> {
  for (;;) {
    const response = await heroFetch(`/api/jobs/${jobId}`)
    if (!response.ok) {
      return "The import job was not found."
    }
    const body = (await response.json()) as { state?: string; stage?: string; progress?: number; error?: string }
    const value = body.progress ?? 0
    setProgress(`${body.stage ?? "import"} ${value}%`, value)
    if (body.state === "done") {
      return "done"
    }
    if (body.state === "cancelled") {
      return body.error || "Import was cancelled. The plan was not changed."
    }
    if (body.state === "error") {
      return body.error || "The import failed."
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

async function readDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown }
    if (typeof body.detail === "string" && body.detail.length > 0) {
      return body.detail
    }
  } catch {
    return "The request failed."
  }
  return "The request failed."
}
