import { describe, expect, it, vi, type Mock } from "vitest";
import {
  createHostAdapter,
  type ConnectFn,
  type HostEvent,
  type HostState,
  type WorkspaceLike,
} from "./adapter.ts";
import { createBearerStore } from "../../hostAuth.ts";

const TOKEN = "aaaa.bbbb.cccc";
const NEXT_TOKEN = "dddd.eeee.ffff";

interface Harness {
  emit(event: HostEvent, data: unknown): void;
  requestPermission: ReturnType<typeof vi.fn>;
  getProject: ReturnType<typeof vi.fn>;
  setMenu: ReturnType<typeof vi.fn>;
  connect: Mock<ConnectFn>;
}

function harness(options: {
  permission?: string | Error;
  project?: { id: string; name?: string } | Error;
  connectError?: Error;
  menuError?: Error;
}): Harness & { onEvent: () => (event: HostEvent, arg: { data: unknown }) => void } {
  let listener: (event: HostEvent, arg: { data: unknown }) => void = () => undefined;
  const requestPermission = vi.fn(async () => {
    if (options.permission instanceof Error) {
      throw options.permission;
    }
    return options.permission ?? TOKEN;
  });
  const getProject = vi.fn(async () => {
    if (options.project instanceof Error) {
      throw options.project;
    }
    return options.project ?? { id: "proj-1", name: "Tower" };
  });
  const setMenu = vi.fn(async (_menu: unknown) => {
    if (options.menuError) {
      throw options.menuError;
    }
    return {};
  });
  const api: WorkspaceLike = {
    extension: { requestPermission },
    project: { getProject },
    ui: { setMenu },
  };
  const connect = vi.fn<ConnectFn>(async (onEvent) => {
    listener = onEvent;
    if (options.connectError) {
      throw options.connectError;
    }
    return api;
  });
  return {
    emit: (event, data) => listener(event, { data }),
    onEvent: () => listener,
    requestPermission,
    getProject,
    setMenu,
    connect,
  };
}

function states(adapter: { subscribe(fn: (state: HostState) => void): () => void }): string[] {
  const seen: string[] = [];
  adapter.subscribe((state) => seen.push(state.status));
  return seen;
}

describe("createHostAdapter", () => {
  it("requests the parent token once and keeps it only in the bearer store", async () => {
    const parent = harness({});
    const tokens = createBearerStore();
    const adapter = createHostAdapter({ connect: parent.connect, tokens });
    const seen = states(adapter);

    await adapter.start();

    expect(parent.connect).toHaveBeenCalledTimes(1);
    expect(parent.requestPermission).toHaveBeenCalledTimes(1);
    expect(parent.requestPermission).toHaveBeenCalledWith("accesstoken");
    expect(tokens.get()).toBe(TOKEN);
    expect(adapter.getState()).toMatchObject({
      status: "connected",
      projectId: "proj-1",
      projectName: "Tower",
    });
    expect(seen).toContain("connected");
    expect(JSON.stringify(adapter.getState())).not.toContain(TOKEN);
  });

  it("does not write the token to any browser storage", async () => {
    const calls: string[] = [];
    const storage = {
      setItem: vi.fn((key: string) => calls.push(key)),
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    try {
      const parent = harness({});
      const adapter = createHostAdapter({ connect: parent.connect, tokens: createBearerStore() });
      await adapter.start();
      parent.emit("extension.accessToken", NEXT_TOKEN);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("does not call requestPermission again when the parent sends a fresh token", async () => {
    const parent = harness({});
    const tokens = createBearerStore();
    const adapter = createHostAdapter({ connect: parent.connect, tokens });
    await adapter.start();

    parent.emit("extension.accessToken", NEXT_TOKEN);

    expect(parent.requestPermission).toHaveBeenCalledTimes(1);
    expect(tokens.get()).toBe(NEXT_TOKEN);
    expect(adapter.getState().status).toBe("connected");
  });

  it("waits while the parent says pending, then connects on the token event", async () => {
    const parent = harness({ permission: "pending" });
    const tokens = createBearerStore();
    const adapter = createHostAdapter({ connect: parent.connect, tokens });
    const seen = states(adapter);

    await adapter.start();
    expect(adapter.getState().status).toBe("awaiting-permission");
    expect(tokens.get()).toBeNull();

    parent.emit("extension.accessToken", TOKEN);
    await vi.waitFor(() => expect(adapter.getState().status).toBe("connected"));

    expect(tokens.get()).toBe(TOKEN);
    expect(parent.requestPermission).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(expect.arrayContaining(["awaiting-permission", "connected"]));
  });

  it("ignores a pending status that arrives as an event", async () => {
    const parent = harness({ permission: "pending" });
    const tokens = createBearerStore();
    const adapter = createHostAdapter({ connect: parent.connect, tokens });
    await adapter.start();

    parent.emit("extension.accessToken", "pending");

    expect(adapter.getState().status).toBe("awaiting-permission");
    expect(tokens.get()).toBeNull();
  });

  it("reports denied and stores no token", async () => {
    const parent = harness({ permission: "denied" });
    const tokens = createBearerStore();
    const adapter = createHostAdapter({ connect: parent.connect, tokens });

    await adapter.start();

    expect(adapter.getState().status).toBe("denied");
    expect(tokens.get()).toBeNull();
  });

  it("treats an unexpected status word as unavailable, not as a token", async () => {
    const parent = harness({ permission: "banana" });
    const tokens = createBearerStore();
    const adapter = createHostAdapter({ connect: parent.connect, tokens });

    await adapter.start();

    expect(adapter.getState().status).toBe("unavailable");
    expect(tokens.get()).toBeNull();
  });

  it("handles an unavailable parent API without throwing", async () => {
    const parent = harness({ connectError: new Error("Operation timed out.") });
    const tokens = createBearerStore();
    const adapter = createHostAdapter({ connect: parent.connect, tokens });

    await expect(adapter.start()).resolves.toBeUndefined();

    expect(adapter.getState().status).toBe("unavailable");
    expect(adapter.getState().message).toMatch(/Trimble Connect/);
    expect(tokens.get()).toBeNull();
    expect(parent.requestPermission).not.toHaveBeenCalled();
  });

  it("gives up when the parent never answers the handshake", async () => {
    const tokens = createBearerStore();
    const connect = vi.fn<ConnectFn>(() => new Promise<WorkspaceLike>(() => undefined));
    const adapter = createHostAdapter({ connect, tokens, timeoutMs: 20 });

    await adapter.start();

    expect(adapter.getState().status).toBe("unavailable");
    expect(tokens.get()).toBeNull();
  });

  it("adds a 2D Hero entry to the Trimble Connect navigation once", async () => {
    const parent = harness({});
    const adapter = createHostAdapter({ connect: parent.connect, tokens: createBearerStore() });

    await adapter.start();

    expect(parent.setMenu).toHaveBeenCalledTimes(1);
    expect(parent.setMenu).toHaveBeenCalledWith(
      expect.objectContaining({ title: "2D Hero", command: "hero_open" }),
    );
  });

  it("adds the menu even while the token permission is pending or denied", async () => {
    for (const permission of ["pending", "denied"]) {
      const parent = harness({ permission });
      const adapter = createHostAdapter({ connect: parent.connect, tokens: createBearerStore() });

      await adapter.start();

      expect(parent.setMenu).toHaveBeenCalledTimes(1);
    }
  });

  it("still connects when the menu cannot be set", async () => {
    const parent = harness({ menuError: new Error("Not supported") });
    const tokens = createBearerStore();
    const adapter = createHostAdapter({ connect: parent.connect, tokens });

    await adapter.start();

    expect(adapter.getState().status).toBe("connected");
    expect(tokens.get()).toBe(TOKEN);
  });

  it("starts only once", async () => {
    const parent = harness({});
    const adapter = createHostAdapter({ connect: parent.connect, tokens: createBearerStore() });

    await adapter.start();
    await adapter.start();

    expect(parent.connect).toHaveBeenCalledTimes(1);
    expect(parent.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("handles a parent that rejects the permission request", async () => {
    const parent = harness({ permission: new Error("Not supported") });
    const tokens = createBearerStore();
    const adapter = createHostAdapter({ connect: parent.connect, tokens });

    await expect(adapter.start()).resolves.toBeUndefined();

    expect(adapter.getState().status).toBe("unavailable");
    expect(tokens.get()).toBeNull();
  });

  it("still connects when the project cannot be read", async () => {
    const parent = harness({ project: new Error("Not supported") });
    const tokens = createBearerStore();
    const adapter = createHostAdapter({ connect: parent.connect, tokens });

    await adapter.start();

    expect(adapter.getState().status).toBe("connected");
    expect(adapter.getState().projectId).toBeUndefined();
    expect(tokens.get()).toBe(TOKEN);
  });

  it.each(["extension.sessionInvalid", "extension.sessionLogOut", "extension.closing"] as const)(
    "drops the token on %s",
    async (event) => {
      const parent = harness({});
      const tokens = createBearerStore();
      const adapter = createHostAdapter({ connect: parent.connect, tokens });
      await adapter.start();

      parent.emit(event, true);

      expect(tokens.get()).toBeNull();
      expect(adapter.getState().status).toBe("ended");
    },
  );

  it("never puts the token in an error message or state", async () => {
    const parent = harness({ permission: new Error(`failed for ${TOKEN}`) });
    const tokens = createBearerStore();
    tokens.set(TOKEN);
    const adapter = createHostAdapter({ connect: parent.connect, tokens });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await adapter.start();
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }

    expect(JSON.stringify(adapter.getState())).not.toContain(TOKEN);
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
  });

  it("stop removes the token and stops reacting to events", async () => {
    const parent = harness({});
    const tokens = createBearerStore();
    const adapter = createHostAdapter({ connect: parent.connect, tokens });
    await adapter.start();

    adapter.stop();
    parent.emit("extension.accessToken", NEXT_TOKEN);

    expect(tokens.get()).toBeNull();
  });
});
