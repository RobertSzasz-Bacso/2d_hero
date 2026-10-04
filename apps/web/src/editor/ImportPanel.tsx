import { useState } from "react"
import { Button } from "@/components/ui/button.tsx"
import { heroFetch } from "@/session.ts"

type Guess = { units: string; upAxis: string }

export default function ImportPanel({ onOpen }: { onOpen: (projectId: string) => void }) {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [guess, setGuess] = useState<Guess | null>(null)
  const [units, setUnits] = useState("auto")
  const [upAxis, setUpAxis] = useState("auto")
  const [progress, setProgress] = useState("")
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState("")

  async function upload(file: File) {
    setError("")
    setGuess(null)
    const body = new FormData()
    body.set("file", file)
    body.set("name", file.name.replace(/\.[^.]+$/, ""))
    const created = await heroFetch("/api/projects", { method: "POST", body })
    if (!created.ok) {
      setError(await readDetail(created))
      return
    }
    const project = (await created.json()) as { id: string }
    setProjectId(project.id)
    const guessed = await heroFetch(`/api/projects/${project.id}/guess`)
    if (!guessed.ok) {
      setError(await readDetail(guessed))
      return
    }
    const next = (await guessed.json()) as Guess
    setGuess(next)
    setUnits(next.units === "m" || next.units === "mm" ? next.units : "auto")
    setUpAxis(next.upAxis === "x" || next.upAxis === "y" || next.upAxis === "z" ? next.upAxis : "auto")
  }

  async function browse() {
    setError("")
    const selected = await heroFetch("/api/dialogs/open-file", { method: "POST" })
    if (!selected.ok) {
      setError(await readDetail(selected))
      return
    }
    const body = (await selected.json()) as { path?: string }
    if (!body.path) {
      setError("No file was selected.")
      return
    }
    const created = await heroFetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkPath: body.path }),
    })
    if (!created.ok) {
      setError(await readDetail(created))
      return
    }
    const project = (await created.json()) as { id: string }
    setProjectId(project.id)
    const guessed = await heroFetch(`/api/projects/${project.id}/guess`)
    if (!guessed.ok) {
      setError(await readDetail(guessed))
      return
    }
    const next = (await guessed.json()) as Guess
    setGuess(next)
    setUnits(next.units === "m" || next.units === "mm" ? next.units : "auto")
    setUpAxis(next.upAxis === "x" || next.upAxis === "y" || next.upAxis === "z" ? next.upAxis : "auto")
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
    if (!response.ok) {
      setError(await readDetail(response))
      return
    }
    const job = (await response.json()) as { id: string }
    setJobId(job.id)
    const done = await watch(job.id, setProgress)
    setJobId(null)
    if (done === "done") {
      onOpen(projectId)
      return
    }
    setProgress("")
    setError(done)
  }

  async function cancel() {
    if (!jobId) {
      return
    }
    await heroFetch(`/api/jobs/${jobId}/cancel`, { method: "POST" })
  }

  return (
    <section className="flex w-full max-w-lg flex-col gap-3 rounded border border-slate-200 p-4">
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
      <Button type="button" variant="outline" onClick={() => void browse()}>
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
      {progress ? (
        <p data-testid="import-progress" className="text-sm">
          {progress}
        </p>
      ) : null}
      {jobId ? (
        <Button type="button" variant="outline" data-testid="import-cancel" onClick={() => void cancel()}>
          Cancel
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700" data-testid="import-error">
          {error}
        </p>
      ) : null}
    </section>
  )
}

async function watch(jobId: string, setProgress: (text: string) => void): Promise<string> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await heroFetch(`/api/jobs/${jobId}`)
    if (!response.ok) {
      return "The import job was not found."
    }
    const body = (await response.json()) as { state?: string; stage?: string; progress?: number; error?: string }
    setProgress(`${body.stage ?? "import"} ${body.progress ?? 0}%`)
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
  return "The import took too long."
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
