import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button.tsx"
import { BusyOverlay, Spinner } from "@/components/Busy.tsx"
import { hostBearer } from "@/hostAuth.ts"
import { heroFetch } from "@/session.ts"
import type { PdfSaveRequest } from "@/pdf/target.ts"
import type { HostAdapter } from "./adapter.ts"
import { createFilesClient, type FolderItem } from "./files.ts"
import {
  createUploader,
  forgetFolder,
  recallFolder,
  rememberFolder,
  TrimbleUploadError,
  type ExistingFile,
  type UploadErrorKind,
  type UploadStage,
  type Uploader,
} from "./upload.ts"

type Crumb = { id: string; name: string }
type Folders =
  | { state: "loading" }
  | { state: "ready"; folderId: string; folders: FolderItem[] }
  | { state: "failed"; kind: UploadErrorKind }

type Step =
  | { name: "choose" }
  | { name: "conflict"; folderId: string; folderName: string; existing: ExistingFile; numbered: string }
  | { name: "uploading"; stage: UploadStage }
  | { name: "done"; fileName: string; folderName: string }
  | { name: "failed"; kind: UploadErrorKind }

const STAGES: Record<UploadStage, string> = {
  preparing: "Preparing the upload",
  sending: "Sending the PDF",
  finishing: "Saving it in the project",
}

const ROOT: Crumb = { id: "", name: "Project files" }

/** Save the finished PDF into a Trimble Connect project folder. The browser uploads with the
 * parent token. The 2D Hero backend only hears where the file landed, never the PDF or a token. */
export default function TrimbleSavePanel({
  adapter,
  request,
}: {
  adapter: HostAdapter
  request: PdfSaveRequest
}) {
  const host = adapter.getState()
  const trimbleProject = host.projectId ?? ""
  const uploader: Uploader | null = useMemo(
    () =>
      trimbleProject
        ? createUploader({
            files: createFilesClient({
              projectId: trimbleProject,
              location: host.projectLocation,
              token: () => hostBearer.get(),
            }),
            token: () => hostBearer.get(),
          })
        : null,
    [trimbleProject, host.projectLocation],
  )
  const [trail, setTrail] = useState<Crumb[]>([ROOT])
  const [folders, setFolders] = useState<Folders>({ state: "loading" })
  const [step, setStep] = useState<Step>({ name: "choose" })
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const started = useRef(false)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      controller.current?.abort()
    }
  }, [])

  const load = useCallback(
    async (folderId: string | null) => {
      if (!uploader) {
        return false
      }
      setFolders({ state: "loading" })
      try {
        const listing = await uploader.folders(folderId)
        if (alive.current) {
          setFolders({ state: "ready", folderId: listing.folderId, folders: listing.folders })
        }
        return true
      } catch (reason) {
        if (alive.current) {
          setFolders({ state: "failed", kind: reason instanceof TrimbleUploadError ? reason.kind : "error" })
        }
        return false
      }
    },
    [uploader],
  )

  useEffect(() => {
    if (started.current) {
      return
    }
    started.current = true
    const remembered = trimbleProject ? recallFolder(trimbleProject) : null
    if (!remembered) {
      void load(null)
      return
    }
    // Start in the folder used last time. If it is gone, forget it and start at the root.
    void load(remembered.id).then((worked) => {
      if (!alive.current) {
        return
      }
      if (worked) {
        setTrail([ROOT, { id: remembered.id, name: remembered.name }])
      } else {
        forgetFolder(trimbleProject)
        void load(null)
      }
    })
  }, [load, trimbleProject])

  function enter(folder: Crumb) {
    setTrail((current) => [...current, folder])
    void load(folder.id)
  }

  function up() {
    const next = trail.slice(0, -1)
    setTrail(next)
    void load(next.length > 1 ? next[next.length - 1].id : null)
  }

  async function choose() {
    if (!uploader || folders.state !== "ready" || busy) {
      return
    }
    const folderId = folders.folderId
    const folderName = trail[trail.length - 1].name
    setBusy(true)
    try {
      const existing = await uploader.findExisting(folderId, request.filename)
      if (!alive.current) {
        return
      }
      if (existing) {
        const numbered = await uploader.numberedName(folderId, request.filename)
        if (alive.current) {
          setStep({ name: "conflict", folderId, folderName, existing, numbered })
        }
        return
      }
      await save(folderId, folderName, request.filename)
    } catch (reason) {
      fail(reason)
    } finally {
      if (alive.current) {
        setBusy(false)
      }
    }
  }

  async function save(folderId: string, folderName: string, name: string) {
    if (!uploader) {
      return
    }
    const abort = new AbortController()
    controller.current = abort
    setStep({ name: "uploading", stage: "preparing" })
    try {
      const result = await uploader.upload({
        folderId,
        name,
        bytes: request.bytes,
        signal: abort.signal,
        onStage: (stage) => {
          if (alive.current) {
            setStep({ name: "uploading", stage })
          }
        },
      })
      if (trimbleProject) {
        rememberFolder(trimbleProject, { id: folderId, name: folderName })
      }
      if (result.versionId) {
        await record(request.projectId, { ...result, versionId: result.versionId })
      }
      if (alive.current) {
        setStep({ name: "done", fileName: result.name, folderName })
      }
    } catch (reason) {
      fail(reason)
    } finally {
      controller.current = null
    }
  }

  function fail(reason: unknown) {
    if (!alive.current) {
      return
    }
    const kind = reason instanceof TrimbleUploadError ? reason.kind : "error"
    if (kind === "cancelled") {
      setStep({ name: "choose" })
      return
    }
    setStep({ name: "failed", kind })
  }

  if (!uploader) {
    return (
      <p data-testid="trimble-save-state" className="mt-3 text-sm text-slate-600">
        No Trimble Connect project is open.
      </p>
    )
  }

  if (step.name === "uploading") {
    return (
      <div className="relative mt-3 min-h-40" data-testid="trimble-save">
        <BusyOverlay
          testId="trimble-save-busy"
          message={STAGES[step.stage]}
          onCancel={() => controller.current?.abort()}
        />
      </div>
    )
  }

  if (step.name === "done") {
    return (
      <div className="mt-3 flex flex-col gap-3" data-testid="trimble-save">
        <p role="status" data-testid="trimble-save-done" className="text-sm">
          Saved {step.fileName} to Trimble Connect in {step.folderName}.
        </p>
        <div className="flex justify-end">
          <Button type="button" onClick={request.close}>Close</Button>
        </div>
      </div>
    )
  }

  if (step.name === "failed") {
    return (
      <div className="mt-3 flex flex-col gap-3" data-testid="trimble-save">
        <p role="alert" data-testid="trimble-save-error" className="text-sm text-red-700">
          {new TrimbleUploadError(step.kind).message} The PDF is still here: download it instead.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setStep({ name: "choose" })}>
            Back
          </Button>
          <Button type="button" data-testid="trimble-save-download" onClick={() => void request.download()}>
            Download
          </Button>
        </div>
      </div>
    )
  }

  if (step.name === "conflict") {
    return (
      <div className="mt-3 flex flex-col gap-3" data-testid="trimble-save">
        <p data-testid="trimble-save-conflict" className="text-sm">
          {step.folderName} already has a file named {step.existing.name}.
        </p>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            data-testid="trimble-save-version"
            onClick={() => void save(step.folderId, step.folderName, step.existing.name)}
          >
            Save as a new version of {step.existing.name}
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid="trimble-save-numbered"
            onClick={() => void save(step.folderId, step.folderName, step.numbered)}
          >
            Save as {step.numbered}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => setStep({ name: "choose" })}>
            Back
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="trimble-save">
      <h3 className="text-sm font-medium">Save {request.filename} to Trimble Connect</h3>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {trail.length > 1 ? (
          <Button type="button" variant="outline" data-testid="trimble-save-up" onClick={up}>
            Up
          </Button>
        ) : null}
        <span data-testid="trimble-save-path" className="truncate">
          {trail.map((crumb) => crumb.name).join(" / ")}
        </span>
      </div>
      <FolderList
        folders={folders}
        onFolder={enter}
        onRetry={() => void load(trail.length > 1 ? trail[trail.length - 1].id : null)}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={request.close}>Cancel</Button>
        <Button
          type="button"
          data-testid="trimble-save-here"
          disabled={folders.state !== "ready" || busy}
          onClick={() => void choose()}
        >
          {busy ? <Spinner /> : null}
          Save here
        </Button>
      </div>
    </div>
  )
}

function FolderList({
  folders,
  onFolder,
  onRetry,
}: {
  folders: Folders
  onFolder: (folder: Crumb) => void
  onRetry: () => void
}) {
  if (folders.state === "loading") {
    return (
      <p data-testid="trimble-save-state" className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner /> Loading folders...
      </p>
    )
  }
  if (folders.state === "failed") {
    return (
      <div className="flex flex-col items-start gap-2">
        <p data-testid="trimble-save-state" role="alert" className="text-sm text-red-700">
          {new TrimbleUploadError(folders.kind).message}
        </p>
        {folders.kind === "unauthorized" ? null : (
          <Button type="button" variant="outline" onClick={onRetry}>Try again</Button>
        )}
      </div>
    )
  }
  return (
    <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
      {folders.folders.length === 0 ? (
        <p data-testid="trimble-save-state" className="text-sm text-slate-500">
          No sub-folders here. Save in this folder, or go up.
        </p>
      ) : null}
      {folders.folders.map((folder) => (
        <Button
          key={folder.id}
          type="button"
          variant="outline"
          className="justify-start"
          data-testid="trimble-save-folder"
          onClick={() => onFolder(folder)}
        >
          <span className="truncate">{folder.name}</span>
        </Button>
      ))}
    </div>
  )
}

/** Tell the backend where the PDF landed. Ids and a name only. A failure here is not the user's
 * problem: the PDF is already in Trimble Connect. */
async function record(
  projectId: string,
  result: { fileId: string; versionId: string; name: string; folderId: string },
): Promise<void> {
  try {
    await heroFetch(`/api/projects/${projectId}/trimble-export`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileId: result.fileId,
        versionId: result.versionId,
        folderId: result.folderId,
        name: result.name,
        savedAt: new Date().toISOString(),
      }),
    })
  } catch {
    // Metadata only.
  }
}
