import { create } from "zustand";
import type { Plan } from "./plan";

export type Tool = "select" | "connect" | "annotate" | "delete" | "door" | "window" | "dimension";

type Workspace = {
  projectId: string | null;
  filename: string | null;
  plan: Plan | null;
  tool: Tool;
  error: string | null;
  busy: boolean;
  setTool: (tool: Tool) => void;
  setPlan: (plan: Plan | null) => void;
  setError: (error: string | null) => void;
  setBusy: (busy: boolean) => void;
  openProject: (projectId: string, filename: string, plan: Plan) => void;
  closeProject: () => void;
};

export const useWorkspace = create<Workspace>((set) => ({
  projectId: null,
  filename: null,
  plan: null,
  tool: "select",
  error: null,
  busy: false,
  setTool: (tool) => set({ tool }),
  setPlan: (plan) => set({ plan }),
  setError: (error) => set({ error }),
  setBusy: (busy) => set({ busy }),
  openProject: (projectId, filename, plan) =>
    set({ projectId, filename, plan, error: null, tool: "select" }),
  closeProject: () => set({ projectId: null, filename: null, plan: null, error: null }),
}));
