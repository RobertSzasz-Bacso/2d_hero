import type { Plan } from "./plan";

export type Project = {
  id: string;
  filename: string;
  plan: Plan | null;
};

async function fail(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as { detail?: string } | null;
  throw new Error(body?.detail ?? "Something went wrong. Try that again.");
}

export async function uploadProject(file: File): Promise<{ id: string; filename: string }> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/projects", { method: "POST", body });
  if (!response.ok) await fail(response);
  return response.json();
}

export async function generatePlan(projectId: string, sliceHeight: number): Promise<Plan> {
  const response = await fetch(`/api/projects/${projectId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slice_height: sliceHeight }),
  });
  if (!response.ok) await fail(response);
  return response.json();
}

export async function savePlan(projectId: string, plan: Plan): Promise<Plan> {
  const response = await fetch(`/api/projects/${projectId}/plan`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(plan),
  });
  if (!response.ok) await fail(response);
  return response.json();
}

export async function learnedCleanup(projectId: string): Promise<Plan> {
  const response = await fetch(`/api/projects/${projectId}/cleanup`, { method: "POST" });
  if (!response.ok) await fail(response);
  return response.json();
}

export async function cleanPlan(projectId: string, instruction: string): Promise<Plan> {
  const response = await fetch(`/api/projects/${projectId}/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction }),
  });
  if (!response.ok) await fail(response);
  return response.json();
}

export async function downloadPdf(projectId: string): Promise<void> {
  await downloadFile(projectId, "pdf", "floor-plan.pdf");
}

export async function downloadDxf(projectId: string): Promise<void> {
  await downloadFile(projectId, "dxf", "floor-plan.dxf");
}

export async function downloadSvg(projectId: string): Promise<void> {
  await downloadFile(projectId, "svg", "floor-plan.svg");
}

async function downloadFile(projectId: string, kind: string, filename: string): Promise<void> {
  const response = await fetch(`/api/projects/${projectId}/${kind}`);
  if (!response.ok) await fail(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
