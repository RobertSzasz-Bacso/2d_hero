import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button.tsx"
import { BusyOverlay, Spinner } from "@/components/Busy.tsx"
import { hostBearer } from "@/hostAuth.ts"
import { heroFetch } from "@/session.ts"
import type { HostAdapter } from "./adapter.ts"
import {
  createFilesClient,
  TrimbleFilesError,
  type FileItem,
  type FilesClient,
  type Listing,
} from "./files.ts"
import type { LoadedModel } from "./models.ts"

type Crumb = { id: string; name: string }
type View =
  | { state: "loading" }
  | { state: "ready"; listing: Listing }
  | { state: "failed"; kind: TrimbleFilesError["kind"] }

type Transfer = { name: string; bytes: number; total: number | null }

const NOT_A_FILE = "This model is not available as a downloadable file."

function sizeLabel(size: number | undefined): string {
  if (size === undefined) {
    return ""
  }
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** Pick a point cloud or IFC from the Trimble Connect project. The browser lists files with the
 * parent token and asks for a download URL. Only that URL goes to the backend, never the token. */
export default function TrimblePicker({
  adapter,
  onProject,
}: {
  adapter: HostAdapter
  onProject: (projectId: string) => void
}) {
  const host = adapter.getState()
  const files: FilesClient | null = useMemo(
    () =>
      host.projectId
        ? createFilesClient({
            projectId: host.projectId,
            location: host.projectLocation,
            token: () => hostBearer.get(),
          })
        : null,
    [host.projectId, host.projectLocation],
  )
  const [view, setView] = useState<View>({ state: "loading" })
  const [trail, setTrail] = useState<Crumb[]>([{ id: "", name: "Project files" }])
  const [models, setModels] = useState<LoadedModel[]>([])
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [error, setError] = useState("")
  const transferId = useRef<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(
    async (folderId: string | null) => {
      if (!files) {
        return
      }
      setView({ state: "loading" })
      try {
        const listing = folderId === null ? await files.listRoot() : await files.listFolder(folderId)
        if (alive.current) {
          setView({ state: "ready", listing })
          if (folderId === null) {
            setTrail([{ id: listing.folderId, name: "Project files" }])
          }
        }
      } catch (reason) {
        if (alive.current) {
          setView({ state: "failed", kind: reason instanceof TrimbleFilesError ? reason.kind : "error" })
        }
      }
    },
    [files],
  )

  useEffect(() => {
    void load(null)
    void adapter.models().then((found) => {
      if (alive.current) {
        setModels(found)
      }
    })
  }, [adapter, load])

  async function open(file: { id: string; versionId: string; name: string }, fromModel: boolean) {
    if (!files || transfer) {
      return
    }
    setError("")
    const id = crypto.randomUUID().replaceAll("-", "")
    transferId.current = id
    setTransfer({ name: file.name, bytes: 0, total: null })
    const timer = window.setInterval(() => {
      void heroFetch(`/api/transfers/${id}`)
        .then(async (response) => {
          if (response.ok && alive.current) {
            const body = (await response.json()) as { bytes?: number; total?: number | null }
            setTransfer((current) =>
              current ? { ...current, bytes: body.bytes ?? 0, total: body.total ?? null } : current,
            )
          }
        })
        .catch(() => undefined)
    }, 500)
    try {
      let url: string
      try {
        url = await files.downloadUrl(file.id, file.versionId)
      } catch (reason) {
        const kind = reason instanceof TrimbleFilesError ? reason.kind : "error"
        setError(
          fromModel && (kind === "not-found" || kind === "error")
            ? NOT_A_FILE
            : reason instanceof TrimbleFilesError
              ? reason.message
              : "Trimble Connect did not give a download link.",
        )
        return
      }
      const response = await heroFetch("/api/projects/from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          fileName: file.name,
          fileId: file.id,
          versionId: file.versionId,
          name: file.name.replace(/\.[^.]+$/, ""),
          transferId: id,
        }),
      })
      if (!alive.current) {
        return
      }
      if (!response.ok) {
        setError(await readDetail(response))
        return
      }
      const project = (await response.json()) as { id: string }
      onProject(project.id)
    } catch {
      if (alive.current) {
        setError("Could not download the file.")
      }
    } finally {
      window.clearInterval(timer)
      transferId.current = null
      if (alive.current) {
        setTransfer(null)
      }
    }
  }

  async function cancel() {
    const id = transferId.current
    if (id) {
      await heroFetch(`/api/transfers/${id}/cancel`, { method: "POST" }).catch(() => undefined)
    }
  }

  function enter(folder: { id: string; name: string }) {
    setTrail((current) => [...current, folder])
    void load(folder.id)
  }

  function up() {
    const next = trail.slice(0, -1)
    setTrail(next)
    void load(next.length > 1 ? next[next.length - 1].id : null)
  }

  const message = transfer
    ? transfer.total
      ? `Downloading ${transfer.name} (${sizeLabel(transfer.bytes)} of ${sizeLabel(transfer.total)})`
      : `Downloading ${transfer.name} (${sizeLabel(transfer.bytes) || "0 KB"})`
    : ""
  const percent = transfer?.total ? Math.min(100, Math.round((transfer.bytes / transfer.total) * 100)) : undefined

  return (
    <section
      data-testid="trimble-picker"
      className="relative flex w-full max-w-lg flex-col gap-3 rounded border border-slate-200 p-4"
    >
      <h2 className="text-sm font-medium">Open from Trimble Connect</h2>
      {!files ? (
        <p data-testid="trimble-state" className="text-sm text-slate-600">
          No Trimble Connect project is open.
        </p>
      ) : null}
      {models.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-slate-500">Loaded in the viewer</h3>
          {models.map((model) => (
            <Button
              key={`${model.fileId}:${model.versionId}`}
              type="button"
              variant="outline"
              className="justify-start"
              data-testid="trimble-model"
              disabled={transfer !== null}
              onClick={() => void open({ id: model.fileId, versionId: model.versionId, name: model.name }, true)}
            >
              <span className="truncate">{model.name}</span>
            </Button>
          ))}
        </div>
      ) : null}
      {files ? (
        <>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {trail.length > 1 ? (
              <Button type="button" variant="outline" data-testid="trimble-up" onClick={up}>
                Up
              </Button>
            ) : null}
            <span data-testid="trimble-path" className="truncate">
              {trail.map((crumb) => crumb.name).join(" / ")}
            </span>
          </div>
          <Listed view={view} onFolder={enter} onFile={(file) => void open(file, false)} onRetry={() => void load(trail.length > 1 ? trail[trail.length - 1].id : null)} busy={transfer !== null} />
        </>
      ) : null}
      <p className="text-xs text-slate-500">
        Only files stored in the project can be imported. A point cloud that exists only inside the
        viewer cannot be downloaded.
      </p>
      {error ? (
        <p role="alert" data-testid="trimble-error" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {transfer ? (
        <BusyOverlay
          testId="trimble-overlay"
          message={message}
          progress={percent}
          onCancel={() => void cancel()}
        />
      ) : null}
    </section>
  )
}

function Listed({
  view,
  onFolder,
  onFile,
  onRetry,
  busy,
}: {
  view: View
  onFolder: (folder: { id: string; name: string }) => void
  onFile: (file: FileItem) => void
  onRetry: () => void
  busy: boolean
}) {
  if (view.state === "loading") {
    return (
      <p data-testid="trimble-state" className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner /> Loading files...
      </p>
    )
  }
  if (view.state === "failed") {
    const text =
      view.kind === "forbidden"
        ? "You do not have access to these files."
        : view.kind === "unauthorized"
          ? "Trimble Connect did not accept your session. Reload the page to sign in again."
          : view.kind === "not-found"
            ? "That folder was not found in Trimble Connect."
            : "Trimble Connect could not list the files."
    return (
      <div className="flex flex-col items-start gap-2">
        <p data-testid="trimble-state" role="alert" className="text-sm text-red-700">
          {text}
        </p>
        {view.kind === "unauthorized" ? null : (
          <Button type="button" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    )
  }
  const { listing } = view
  const empty = listing.folders.length === 0 && listing.files.length === 0
  return (
    <div className="flex flex-col gap-1">
      {empty ? (
        <p data-testid="trimble-state" className="text-sm text-slate-500">
          This folder has no supported files.
        </p>
      ) : null}
      {listing.folders.map((folder) => (
        <Button
          key={folder.id}
          type="button"
          variant="outline"
          className="justify-start"
          data-testid="trimble-folder"
          onClick={() => onFolder(folder)}
        >
          <span className="truncate">{folder.name}</span>
        </Button>
      ))}
      {listing.files.map((file) => (
        <Button
          key={`${file.id}:${file.versionId}`}
          type="button"
          variant="outline"
          className="justify-between"
          data-testid="trimble-file"
          disabled={busy}
          onClick={() => onFile(file)}
        >
          <span className="truncate">{file.name}</span>
          <span className="shrink-0 text-xs text-slate-500">{sizeLabel(file.size)}</span>
        </Button>
      ))}
      {listing.hidden > 0 ? (
        <p data-testid="trimble-hidden" className="text-xs text-slate-500">
          {listing.hidden} {listing.hidden === 1 ? "file is" : "files are"} hidden because 2D Hero cannot
          import that type.
        </p>
      ) : null}
    </div>
  )
}

async function readDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown }
    if (typeof body.detail === "string" && body.detail.length > 0) {
      return body.detail
    }
  } catch {
    return "Could not download the file."
  }
  return "Could not download the file."
}
