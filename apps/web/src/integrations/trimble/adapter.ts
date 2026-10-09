import type { BearerStore } from "../../hostAuth.ts";

/** What the editor knows about the host. It never holds the access token. */
export type HostStatus =
  | "idle"
  | "connecting"
  | "awaiting-permission"
  | "connected"
  | "denied"
  | "unavailable"
  | "ended";

export interface HostState {
  status: HostStatus;
  projectId?: string;
  projectName?: string;
  message?: string;
}

export type HostEvent = string;

/** The part of the Trimble Workspace API this app uses. */
export interface WorkspaceLike {
  extension: { requestPermission(permission: "accesstoken"): Promise<string> };
  project: { getProject(): Promise<{ id: string; name?: string }> };
  /** Optional: the left navigation entry. Trimble Connect shows no entry unless we add one. */
  ui?: { setMenu(menu: { title: string; command: string; icon?: string }): Promise<unknown> };
}

const MENU = {
  title: "2D Hero",
  command: "hero_open",
  // Trimble Connect needs an absolute icon URL on our own origin.
  icon: new URL("/icon.png", globalThis.location?.href ?? "http://localhost/").href,
};

export type ConnectFn = (
  onEvent: (event: HostEvent, arg: { data: unknown }) => void,
  timeoutMs: number,
) => Promise<WorkspaceLike>;

export interface HostAdapter {
  start(): Promise<void>;
  stop(): void;
  getState(): HostState;
  subscribe(listener: (state: HostState) => void): () => void;
}

export interface HostAdapterOptions {
  connect: ConnectFn;
  tokens: BearerStore;
  /** How long to wait for the parent to answer the handshake. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const MESSAGES = {
  unavailable:
    "Trimble Connect did not answer. Open 2D Hero from a Trimble Connect project extension.",
  noToken: "Trimble Connect did not share a session token.",
  denied:
    "Trimble Connect denied access to your session token. Allow it in the extension settings, then reload.",
  ended: "Your Trimble Connect session ended. Reload the page to sign in again.",
};

type Parsed =
  | { kind: "token"; token: string }
  | { kind: "pending" }
  | { kind: "denied" }
  | { kind: "unknown" };

/** The parent answers with a token or a status word. A token looks like a JWT. */
function parse(value: unknown): Parsed {
  if (typeof value !== "string") {
    return { kind: "unknown" };
  }
  if (value === "pending") {
    return { kind: "pending" };
  }
  if (value === "denied") {
    return { kind: "denied" };
  }
  return JWT_SHAPE.test(value) ? { kind: "token", token: value } : { kind: "unknown" };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("failed"));
      },
    );
  });
}

/** Connects to the Trimble Connect parent and keeps its access token in `tokens`, in memory.
 * Error text from the parent is never copied into state or logs: it can echo a token. */
export function createHostAdapter(options: HostAdapterOptions): HostAdapter {
  const { connect, tokens } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const listeners = new Set<(state: HostState) => void>();
  let state: HostState = { status: "idle" };
  let api: WorkspaceLike | null = null;
  let started = false;
  let stopped = false;
  let finishing: Promise<void> | null = null;

  function set(next: HostState): void {
    state = next;
    for (const listener of [...listeners]) {
      listener(state);
    }
  }

  async function loadProject(): Promise<{ projectId?: string; projectName?: string }> {
    try {
      const project = await api?.project.getProject();
      if (project && typeof project.id === "string" && project.id.length > 0) {
        return { projectId: project.id, projectName: project.name };
      }
    } catch {
      // The project is context only. The editor works without it.
    }
    return {};
  }

  async function accept(value: unknown, fromRequest: boolean): Promise<void> {
    if (stopped) {
      return;
    }
    const parsed = parse(value);
    if (parsed.kind === "token") {
      tokens.set(parsed.token);
      if (state.status === "connected" || finishing) {
        return;
      }
      finishing = (async () => {
        const project = await loadProject();
        if (!stopped) {
          set({ status: "connected", ...project });
        }
      })();
      await finishing;
      return;
    }
    if (state.status === "connected") {
      if (parsed.kind === "denied") {
        tokens.clear();
        set({ status: "denied", message: MESSAGES.denied });
      }
      return;
    }
    if (parsed.kind === "pending") {
      set({ status: "awaiting-permission" });
    } else if (parsed.kind === "denied") {
      tokens.clear();
      set({ status: "denied", message: MESSAGES.denied });
    } else if (fromRequest) {
      set({ status: "unavailable", message: MESSAGES.noToken });
    }
  }

  function onEvent(event: HostEvent, arg: { data: unknown }): void {
    if (stopped) {
      return;
    }
    if (event === "extension.accessToken" || event === "embed.session.refreshed") {
      void accept(arg?.data, false);
      return;
    }
    if (
      event === "extension.sessionInvalid" ||
      event === "extension.sessionLogOut" ||
      event === "extension.closing"
    ) {
      tokens.clear();
      set({ status: "ended", message: MESSAGES.ended });
    }
  }

  return {
    async start() {
      if (started) {
        return;
      }
      started = true;
      set({ status: "connecting" });
      try {
        api = await withTimeout(connect(onEvent, timeoutMs), timeoutMs);
      } catch {
        if (!stopped) {
          set({ status: "unavailable", message: MESSAGES.unavailable });
        }
        return;
      }
      if (stopped) {
        return;
      }
      try {
        await api.ui?.setMenu(MENU);
        console.info("2D Hero: Trimble Connect accepted the menu entry.");
      } catch (error) {
        // The entry is a convenience. The editor still works without it.
        // The text is from our own menu request, so it cannot hold a token.
        console.warn(
          "2D Hero: Trimble Connect did not accept the menu entry:",
          error instanceof Error ? error.message : String(error),
        );
      }
      let answer: unknown;
      try {
        answer = await api.extension.requestPermission("accesstoken");
      } catch {
        if (!stopped) {
          set({ status: "unavailable", message: MESSAGES.noToken });
        }
        return;
      }
      await accept(answer, true);
    },
    stop() {
      stopped = true;
      tokens.clear();
      listeners.clear();
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
