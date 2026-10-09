import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button.tsx"
import { Spinner } from "@/components/Busy.tsx"
import Editor from "./editor/Editor.tsx"
import AssistantPanel from "./editor/AssistantPanel.tsx"
import ImportPanel from "./editor/ImportPanel.tsx"
import { heroFetch } from "./session.ts"
import Settings from "./settings.tsx"

type ProjectSummary = {
  id: string
  name: string
  revision: number
  importState?: string
  importError?: string
  importProgress?: number
  jobId?: string | null
}

function queryValue(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name)
}

/** `hostedImport` adds another way to start an import. The hosted shell passes one in. */
export default function App({
  hostedImport,
}: {
  hostedImport?: (onProject: (projectId: string) => void) => ReactNode
}) {
  const [projectId, setProjectId] = useState<string | null>(queryValue("project"))
  const [importId, setImportId] = useState<string | null>(queryValue("import"))
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectsState, setProjectsState] = useState<"loading" | "ready">("loading")
  const [health, setHealth] = useState("checking")
  const [deleting, setDeleting] = useState<string | null>(null)
  const [listError, setListError] = useState("")

  const showHome = !projectId && !importId

  useEffect(() => {
    const onPop = () => {
      setProjectId(queryValue("project"))
      setImportId(queryValue("import"))
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  useEffect(() => {
    if (!showHome) {
      return
    }
    const controller = new AbortController()
    let active = true
    setProjectsState("loading")
    heroFetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!active) {
          return
        }
        if (!response.ok) {
          setHealth("unavailable")
          return
        }
        const body = (await response.json()) as { ok?: boolean }
        setHealth(body.ok === true ? "ok" : "unavailable")
      })
      .catch(() => {
        if (active) {
          setHealth("unavailable")
        }
      })
    heroFetch("/api/projects", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || !active) {
          return
        }
        setProjects((await response.json()) as ProjectSummary[])
        setProjectsState("ready")
      })
      .catch(() => {
        if (active) {
          setProjectsState("ready")
        }
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [showHome])

  const openProject = useCallback((id: string) => {
    const url = new URL(window.location.href)
    url.searchParams.delete("import")
    url.searchParams.set("project", id)
    window.history.pushState({}, "", url)
    setImportId(null)
    setProjectId(id)
  }, [])

  function openImport(id: string) {
    const url = new URL(window.location.href)
    url.searchParams.delete("project")
    url.searchParams.set("import", id)
    window.history.pushState({}, "", url)
    setProjectId(null)
    setImportId(id)
  }

  function closeToList() {
    const url = new URL(window.location.href)
    url.searchParams.delete("project")
    url.searchParams.delete("import")
    window.history.pushState({}, "", url)
    setProjectId(null)
    setImportId(null)
  }

  async function removeProject(project: ProjectSummary) {
    const label = project.name || project.id
    if (!window.confirm(`Delete "${label}"? The project folder is removed. This cannot be undone.`)) {
      return
    }
    setDeleting(project.id)
    setListError("")
    try {
      const response = await heroFetch(`/api/projects/${project.id}`, { method: "DELETE" })
      if (!response.ok) {
        setListError(await readDetail(response))
        return
      }
      setProjects((current) => current.filter((item) => item.id !== project.id))
    } catch {
      setListError("Could not delete the project.")
    } finally {
      setDeleting(null)
    }
  }

  if (projectId) {
    return <Editor projectId={projectId} onClose={closeToList} onImport={() => openImport(projectId)} />
  }

  if (importId) {
    return (
      <main className="flex min-h-svh flex-col items-start gap-4 p-8">
        <Button type="button" variant="outline" onClick={closeToList}>
          Projects
        </Button>
        <ImportPanel projectId={importId} onOpen={openProject} />
      </main>
    )
  }

  return (
    <main className="flex min-h-svh flex-col items-start gap-4 p-8">
      <Button type="button">2D Hero</Button>
      <p>Health: {health}</p>
      <AssistantPanel />
      {hostedImport?.(openImport)}
      <ImportPanel onOpen={openProject} />
      <section className="flex w-full max-w-lg flex-col gap-2">
        <h2 className="text-sm font-medium">Projects</h2>
        {projectsState === "loading" ? (
          <p className="flex items-center gap-2 text-sm text-slate-500" data-testid="projects-loading">
            <Spinner /> Loading projects...
          </p>
        ) : null}
        {projectsState === "ready" && projects.length === 0 ? <p className="text-sm text-slate-500">No recent projects.</p> : null}
        {listError ? (
          <p role="alert" className="text-sm text-red-700">
            {listError}
          </p>
        ) : null}
        {projects.map((project) => {
          const status = statusLabel(project)
          const finished = project.importState === "done"
          return (
            <div key={project.id} data-testid="project-row" className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-w-0 flex-1 justify-start"
                data-testid="project-open"
                onClick={() => (finished ? openProject(project.id) : openImport(project.id))}
              >
                <span className="truncate">{project.name || project.id}</span>
              </Button>
              {status ? (
                <span className="shrink-0 text-xs text-slate-500" data-testid="project-status">
                  {deleting === project.id ? "Deleting..." : status}
                </span>
              ) : deleting === project.id ? (
                <span className="shrink-0 text-xs text-slate-500">Deleting...</span>
              ) : null}
              <Button
                type="button"
                variant="outline"
                data-testid="project-delete"
                disabled={deleting === project.id}
                onClick={() => void removeProject(project)}
              >
                Delete
              </Button>
            </div>
          )
        })}
      </section>
      <Settings />
    </main>
  )
}

function statusLabel(project: ProjectSummary): string | null {
  if (project.importState === "none") {
    return "Not imported"
  }
  if (project.importState === "running") {
    return `Importing ${project.importProgress ?? 0}%`
  }
  if (project.importState === "error") {
    return "Import failed"
  }
  if (project.importState === "cancelled") {
    return "Cancelled"
  }
  return null
}

async function readDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown }
    if (typeof body.detail === "string" && body.detail.length > 0) {
      return body.detail
    }
  } catch {
    return "Could not delete the project."
  }
  return "Could not delete the project."
}
