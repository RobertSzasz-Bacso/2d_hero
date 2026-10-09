import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFilesClient,
  isSupportedName,
  TrimbleFilesError,
  type FilesClientOptions,
} from "./files.ts";
import { loadedModels } from "./models.ts";

const TOKEN = "header-part.payload-part.signature-part";
const SIGNED_URL = "https://files.example-cdn.test/blob/abc?X-Amz-Signature=SECRETSIG&Expires=9";
const API = "/tc/api/2.0";

type Route = (url: URL, init: RequestInit | undefined) => Response | undefined;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeFetch(routes: Route[]) {
  const calls: { url: URL; headers: Headers }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, headers: new Headers(init?.headers) });
    for (const route of routes) {
      const response = route(url, init);
      if (response) {
        return response;
      }
    }
    return json({ message: "not mocked" }, 404);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const regions: Route = (url) =>
  url.origin === "https://app.connect.trimble.com" && url.pathname === `${API}/regions`
    ? json([
        { location: "northAmerica", origin: "https://app.connect.trimble.com" },
        { location: "europe", origin: "https://app21.connect.trimble.com" },
      ])
    : undefined;

const project: Route = (url) =>
  url.origin === "https://app21.connect.trimble.com" && url.pathname === `${API}/projects/p1`
    ? json({ id: "p1", name: "Tower", rootId: "root-1", location: "europe" })
    : undefined;

function items(folderId: string, entries: unknown[], origin = "https://app21.connect.trimble.com"): Route {
  return (url) =>
    url.origin === origin && url.pathname === `${API}/folders/${folderId}/items`
      ? json(entries)
      : undefined;
}

function client(routes: Route[], overrides: Partial<FilesClientOptions> = {}) {
  const net = fakeFetch(routes);
  const files = createFilesClient({
    projectId: "p1",
    location: "europe",
    token: () => TOKEN,
    fetch: net.impl,
    ...overrides,
  });
  return { files, net };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isSupportedName", () => {
  it("accepts the import types and ignores case", () => {
    for (const name of ["a.las", "a.LAZ", "a.e57", "a.ifc", "a.obj", "a.glb", "a.gltf", "a.ply", "a.usdz", "a.USD"]) {
      expect(isSupportedName(name), name).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const name of ["a.pdf", "a.dwg", "a.rvt", "a.las.txt", "las", "", ".las"]) {
      expect(isSupportedName(name), name).toBe(false);
    }
  });
});

describe("listing", () => {
  it("lists the root folder in the project's region with the parent token", async () => {
    const { files, net } = client([
      regions,
      project,
      items("root-1", [
        { id: "f2", type: "FOLDER", name: "Scans" },
        { id: "f1", type: "FOLDER", name: "Archive" },
        { id: "a", versionId: "v1", type: "FILE", name: "Room.las", size: 5_242_880 },
        { id: "b", versionId: "v2", type: "FILE", name: "Drawing.pdf", size: 10 },
        { id: "c", versionId: "v3", type: "FILE", name: "Model.IFC", size: 99 },
      ]),
    ]);

    const listing = await files.listRoot();

    expect(listing.folderId).toBe("root-1");
    expect(listing.folders.map((folder) => folder.name)).toEqual(["Archive", "Scans"]);
    expect(listing.files).toEqual([
      { id: "a", versionId: "v1", name: "Room.las", size: 5_242_880 },
      { id: "c", versionId: "v3", name: "Model.IFC", size: 99 },
    ]);
    expect(listing.hidden).toBe(1);
    const sent = net.calls.filter((call) => call.url.origin === "https://app21.connect.trimble.com");
    expect(sent.length).toBeGreaterThan(0);
    for (const call of sent) {
      expect(call.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("lists a subfolder", async () => {
    const { files } = client([
      regions,
      project,
      items("f2", [{ id: "x", versionId: "v9", type: "FILE", name: "Floor 2.e57", size: 7 }]),
    ]);

    const listing = await files.listFolder("f2");

    expect(listing.folderId).toBe("f2");
    expect(listing.files.map((file) => file.name)).toEqual(["Floor 2.e57"]);
  });

  it("shows an empty folder as empty", async () => {
    const { files } = client([regions, project, items("f2", [])]);

    const listing = await files.listFolder("f2");

    expect(listing).toEqual({ folderId: "f2", folders: [], files: [], hidden: 0 });
  });

  it("skips files with no version id", async () => {
    const { files } = client([
      regions,
      project,
      items("f2", [{ id: "x", type: "FILE", name: "a.las", size: 1 }]),
    ]);

    const listing = await files.listFolder("f2");

    expect(listing.files).toEqual([]);
    expect(listing.hidden).toBe(1);
  });

  it("falls back to trying each region when the location is unknown", async () => {
    const { files } = client([regions, project, items("root-1", [])], { location: undefined });

    const listing = await files.listRoot();

    expect(listing.folderId).toBe("root-1");
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not-found"],
    [500, "error"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    const { files } = client([
      regions,
      project,
      (url) => (url.pathname.endsWith("/items") ? json({ message: "x" }, status) : undefined),
    ]);

    const failure = await files.listFolder("f2").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TrimbleFilesError);
    expect((failure as TrimbleFilesError).kind).toBe(kind);
  });

  it("reports a project it cannot open as no access", async () => {
    const { files } = client([
      regions,
      (url) => (url.pathname.endsWith("/projects/p1") ? json({}, 403) : undefined),
    ]);

    const failure = await files.listRoot().catch((error: unknown) => error);

    expect((failure as TrimbleFilesError).kind).toBe("forbidden");
  });

  it("fails as unauthorized without a token and sends nothing", async () => {
    const { files, net } = client([regions, project], { token: () => null });

    const failure = await files.listRoot().catch((error: unknown) => error);

    expect((failure as TrimbleFilesError).kind).toBe("unauthorized");
    expect(net.calls).toEqual([]);
  });

  it("never sends the token to an origin outside connect.trimble.com", async () => {
    const { files, net } = client([
      (url) =>
        url.pathname === `${API}/regions`
          ? json([{ location: "europe", origin: "https://evil.example" }])
          : undefined,
    ]);

    const failure = await files.listRoot().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TrimbleFilesError);
    expect(net.calls.every((call) => call.url.hostname.endsWith("connect.trimble.com"))).toBe(true);
    expect(net.calls.some((call) => call.url.hostname === "evil.example")).toBe(false);
  });

  it("does not leak the response text into the error", async () => {
    const { files } = client([
      regions,
      project,
      (url) => (url.pathname.endsWith("/items") ? json({ message: TOKEN }, 500) : undefined),
    ]);

    const failure = (await files.listFolder("f2").catch((error: unknown) => error)) as Error;

    expect(failure.message).not.toContain(TOKEN);
  });
});

describe("download URL", () => {
  const route: Route = (url) =>
    url.origin === "https://app21.connect.trimble.com" &&
    url.pathname === `${API}/files/fs/a/downloadurl`
      ? json({ url: SIGNED_URL })
      : undefined;

  it("asks for the chosen version and returns the URL", async () => {
    const { files, net } = client([regions, project, route]);

    const url = await files.downloadUrl("a", "v1");

    expect(url).toBe(SIGNED_URL);
    const asked = net.calls.find((call) => call.url.pathname.endsWith("/downloadurl"));
    expect(asked?.url.searchParams.get("versionId")).toBe("v1");
    expect(asked?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("rejects a reply with no https URL", async () => {
    for (const reply of [{}, { url: "http://files.example-cdn.test/x" }, { url: 5 }]) {
      const { files } = client([
        regions,
        project,
        (url) => (url.pathname.endsWith("/downloadurl") ? json(reply) : undefined),
      ]);

      const failure = await files.downloadUrl("a", "v1").catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(TrimbleFilesError);
      expect((failure as Error).message).not.toContain("example-cdn");
    }
  });

  it("maps 403 to forbidden", async () => {
    const { files } = client([
      regions,
      project,
      (url) => (url.pathname.endsWith("/downloadurl") ? json({}, 403) : undefined),
    ]);

    const failure = await files.downloadUrl("a", "v1").catch((error: unknown) => error);

    expect((failure as TrimbleFilesError).kind).toBe("forbidden");
  });
});

describe("storage", () => {
  it("never writes the token or a download URL to storage or cookies", async () => {
    const writes: string[] = [];
    const store = {
      getItem: () => null,
      setItem: (key: string, value: string) => writes.push(`${key}=${value}`),
      removeItem: () => undefined,
    };
    vi.stubGlobal("localStorage", store);
    vi.stubGlobal("sessionStorage", store);
    const cookie: string[] = [];
    vi.stubGlobal("document", {
      get cookie() {
        return "";
      },
      set cookie(value: string) {
        cookie.push(value);
      },
    });
    const { files } = client([
      regions,
      project,
      items("root-1", [{ id: "a", versionId: "v1", type: "FILE", name: "a.las", size: 1 }]),
      (url) =>
        url.pathname.endsWith("/downloadurl") ? json({ url: SIGNED_URL }) : undefined,
    ]);

    await files.listRoot();
    await files.downloadUrl("a", "v1");

    expect(writes).toEqual([]);
    expect(cookie).toEqual([]);
  });
});

describe("loaded models", () => {
  it("maps loaded viewer models to file and version ids", async () => {
    const getModels = vi.fn(async () => [
      { id: "file-1", versionId: "ver-1", name: "Room.las", type: "pointcloud", state: "loaded" },
      { id: "file-2", versionId: "ver-2", name: "Tower.ifc", type: "model", state: "loaded" },
      { id: "file-3", versionId: "ver-3", name: "Sheet.pdf", type: "model", state: "loaded" },
    ]);

    const models = await loadedModels({ viewer: { getModels } });

    expect(getModels).toHaveBeenCalledWith("loaded");
    expect(models).toEqual([
      { fileId: "file-1", versionId: "ver-1", name: "Room.las" },
      { fileId: "file-2", versionId: "ver-2", name: "Tower.ifc" },
    ]);
  });

  it("returns nothing when the viewer is missing or fails", async () => {
    expect(await loadedModels({})).toEqual([]);
    expect(
      await loadedModels({
        viewer: {
          getModels: async () => {
            throw new Error(TOKEN);
          },
        },
      }),
    ).toEqual([]);
  });
});
