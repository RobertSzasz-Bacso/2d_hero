import { afterEach, describe, expect, it, vi } from "vitest";
import { createBearerStore, hostBearer } from "./hostAuth.ts";
import { heroFetch } from "./session.ts";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("createBearerStore", () => {
  it("holds a token in memory and clears it", () => {
    const store = createBearerStore();
    expect(store.get()).toBeNull();

    store.set("a.b.c");
    expect(store.get()).toBe("a.b.c");

    store.clear();
    expect(store.get()).toBeNull();
  });

  it("ignores an empty token", () => {
    const store = createBearerStore();
    store.set("");
    expect(store.get()).toBeNull();
  });
});

describe("heroFetch", () => {
  afterEach(() => {
    hostBearer.clear();
    vi.unstubAllGlobals();
  });

  function stubFetch(session: Record<string, string>) {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("sessionStorage", memoryStorage(session));
    return fetchMock;
  }

  function sentHeaders(fetchMock: ReturnType<typeof stubFetch>): Headers {
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    return new Headers(call[1].headers);
  }

  it("local mode keeps sending only the session token", async () => {
    const fetchMock = stubFetch({ "hero.sessionToken": "local-secret" });

    await heroFetch("/api/projects");

    const headers = sentHeaders(fetchMock);
    expect(headers.get("X-Hero-Token")).toBe("local-secret");
    expect(headers.get("Authorization")).toBeNull();
  });

  it("local mode without any token sends neither header", async () => {
    const fetchMock = stubFetch({});

    await heroFetch("/api/projects");

    const headers = sentHeaders(fetchMock);
    expect(headers.get("X-Hero-Token")).toBeNull();
    expect(headers.get("Authorization")).toBeNull();
  });

  it("hosted mode sends the bearer token and no session header", async () => {
    const fetchMock = stubFetch({});
    hostBearer.set("aaa.bbb.ccc");

    await heroFetch("/api/projects");

    const headers = sentHeaders(fetchMock);
    expect(headers.get("Authorization")).toBe("Bearer aaa.bbb.ccc");
    expect(headers.get("X-Hero-Token")).toBeNull();
  });

  it("does not override an Authorization header the caller set", async () => {
    const fetchMock = stubFetch({});
    hostBearer.set("aaa.bbb.ccc");

    await heroFetch("/api/projects", { headers: { Authorization: "Bearer custom" } });

    expect(sentHeaders(fetchMock).get("Authorization")).toBe("Bearer custom");
  });
});
