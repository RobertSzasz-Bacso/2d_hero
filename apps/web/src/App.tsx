import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import Editor from "./editor/Editor.tsx";
import ImportPanel from "./editor/ImportPanel.tsx";
import { heroFetch } from "./session.ts";
import Settings from "./settings.tsx";

type ProjectSummary = {
  id: string;
  name: string;
  revision: number;
};

function projectFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get("project");
}

export default function App() {
  const [projectId, setProjectId] = useState<string | null>(projectFromLocation);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [health, setHealth] = useState("checking");

  useEffect(() => {
    const onPop = () => setProjectId(projectFromLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (projectId) {
      return;
    }
    const controller = new AbortController();
    let active = true;
    heroFetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!active) {
          return;
        }
        if (!response.ok) {
          setHealth("unavailable");
          return;
        }
        const body = (await response.json()) as { ok?: boolean };
        setHealth(body.ok === true ? "ok" : "unavailable");
      })
      .catch(() => {
        if (active) {
          setHealth("unavailable");
        }
      });
    heroFetch("/api/projects", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || !active) {
          return;
        }
        setProjects((await response.json()) as ProjectSummary[]);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      controller.abort();
    };
  }, [projectId]);

  function openProject(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("project", id);
    window.history.pushState({}, "", url);
    setProjectId(id);
  }

  function closeProject() {
    const url = new URL(window.location.href);
    url.searchParams.delete("project");
    window.history.pushState({}, "", url);
    setProjectId(null);
  }

  if (projectId) {
    return <Editor projectId={projectId} onClose={closeProject} />;
  }

  return (
    <main className="flex min-h-svh flex-col items-start gap-4 p-8">
      <Button type="button">2D Hero</Button>
      <p>Health: {health}</p>
      <ImportPanel onOpen={openProject} />
      <section className="flex w-full max-w-lg flex-col gap-2">
        <h2 className="text-sm font-medium">Projects</h2>
        {projects.length === 0 ? <p className="text-sm text-slate-500">No recent projects.</p> : null}
        {projects.map((project) => (
          <Button key={project.id} type="button" variant="outline" onClick={() => openProject(project.id)}>
            {project.name || project.id}
          </Button>
        ))}
      </section>
      <Settings />
    </main>
  );
}
