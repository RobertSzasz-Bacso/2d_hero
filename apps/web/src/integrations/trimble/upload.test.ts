import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFilesClient } from "./files.ts";
import {
  createUploader,
  forgetFolder,
  recallFolder,
  rememberFolder,
  TrimbleUploadError,
  type UploadStage,
} from "./upload.ts";

const TOKEN = "header-part.payload-part.signature-part";
const SIGNED_URL = "https://upload.example-cdn.test/put/abc?X-Amz-Signature=SECRETSIG&Expires=9";
const ORIGIN = "https://app21.connect.trimble.com";
const API = "/tc/api/2.0";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

type Call = { url: URL; method: string; headers: Headers; body: unknown };
type Route = (call: Call) => Response | Promise<Response> | undefined;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function status(code: number): Response {
  return new Response("", { status: code });
}

const regions: Route = ({ url }) =>
  url.origin === "https://app.connect.trimble.com" && url.pathname === `${API}/regions`
    ? json([{ location: "europe", origin: ORIGIN }])
    : undefined;

const project: Route = ({ url }) =>
  url.origin === ORIGIN && url.pathname === `${API}/projects/p1`
    ? json({ id: "p1", name: "Tower", rootId: "root-1", location: "europe" })
    : undefined;

function folder(id: string, entries: unknown[]): Route {
  return ({ url }) =>
    url.origin === ORIGIN && url.pathname === `${API}/folders/${id}/items` ? json(entries) : undefined;
}

const initiate = (response: () => Response = () => json({ uploadId: "up-1", uploadURL: SIGNED_URL })): Route =>
  ({ url, method }) =>
    method === "POST" && url.origin === ORIGIN && url.pathname === `${API}/files/fs/initiate`
      ? response()
      : undefined;

const put = (response: () => Response = () => status(200)): Route =>
  ({ url, method }) =>
    method === "PUT" && url.origin === "https://upload.example-cdn.test" ? response() : undefined;

const commit = (
  response: () => Response = () => json({ id: "file-9", versionId: "ver-1", name: "Plan.pdf", type: "FILE" }),
): Route =>
  ({ url, method }) =>
    method === "POST" && url.origin === ORIGIN && url.pathname === `${API}/files/fs/commit`
      ? response()
      : undefined;

function harness(routes: Route[]) {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body,
    };
    calls.push(call);
    if (init?.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    for (const route of [regions, project, ...routes]) {
      const response = route(call);
      if (response) {
        return response;
      }
    }
    return json({ message: "not mocked" }, 404);
  }) as unknown as typeof fetch;
  const files = createFilesClient({
    projectId: "p1",
    location: "europe",
    token: () => TOKEN,
    fetch: impl,
  });
  const uploader = createUploader({ files, token: () => TOKEN, fetch: impl });
  return { calls, uploader, files };
}

async function sha256(data: BodyInit | Uint8Array | unknown): Promise<string> {
  let bytes: Uint8Array;
  if (data instanceof Blob) {
    bytes = new Uint8Array(await data.arrayBuffer());
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else {
    throw new Error("unexpected body type");
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The test environment is Node. This stands in for the browser's Storage. */
class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  clear(): void {
    this.items.clear();
  }
  dump(): Record<string, string> {
    return Object.fromEntries(this.items);
  }
}

let local: MemoryStorage;
let session: MemoryStorage;

beforeEach(() => {
  local = new MemoryStorage();
  session = new MemoryStorage();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("upload", () => {
  it("initiates, sends the bytes, then commits, in that order", async () => {
    const { calls, uploader } = harness([initiate(), put(), commit()]);

    const result = await uploader.upload({ folderId: "f7", name: "Plan.pdf", bytes: PDF });

    const steps = calls.filter((call) => call.url.pathname.includes("/files/fs/") || call.method === "PUT");
    expect(steps.map((call) => `${call.method} ${call.url.pathname}`)).toEqual([
      `POST ${API}/files/fs/initiate`,
      "PUT /put/abc",
      `POST ${API}/files/fs/commit`,
    ]);
    expect(JSON.parse(steps[0].body as string)).toEqual({
      parentId: "f7",
      parentType: "FOLDER",
      name: "Plan.pdf",
    });
    expect(JSON.parse(steps[2].body as string)).toEqual({ uploadId: "up-1" });
    expect(result).toEqual({ fileId: "file-9", versionId: "ver-1", name: "Plan.pdf", folderId: "f7" });
  });

  it("sends exactly the PDF bytes", async () => {
    const { calls, uploader } = harness([initiate(), put(), commit()]);

    await uploader.upload({ folderId: "f7", name: "Plan.pdf", bytes: PDF });

    const sent = calls.find((call) => call.method === "PUT");
    expect(await sha256(sent?.body)).toBe(await sha256(PDF));
    expect(new TextDecoder().decode(new Uint8Array(await (sent?.body as Blob).arrayBuffer())).startsWith("%PDF-")).toBe(true);
  });

  it("sends the bearer to Trimble Connect only, never to the signed upload host", async () => {
    const { calls, uploader } = harness([initiate(), put(), commit()]);

    await uploader.upload({ folderId: "f7", name: "Plan.pdf", bytes: PDF });

    for (const call of calls) {
      const trimble = call.url.hostname === "connect.trimble.com" || call.url.hostname.endsWith(".connect.trimble.com");
      if (trimble) {
        expect(call.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
      } else {
        expect(call.headers.get("authorization"), call.url.hostname).toBeNull();
      }
    }
    expect(calls.some((call) => call.url.hostname === "upload.example-cdn.test")).toBe(true);
  });

  it("never writes the token or the signed URL to storage, the console, or an error", async () => {
    const logs: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
    }
    const failing = harness([initiate(), put(() => status(500))]);
    const error = await failing.uploader
      .upload({ folderId: "f7", name: "Plan.pdf", bytes: PDF })
      .catch((caught: unknown) => caught);
    const ok = harness([initiate(), put(), commit()]);
    await ok.uploader.upload({ folderId: "f7", name: "Plan.pdf", bytes: PDF });
    rememberFolder("p1", { id: "f7", name: "Drawings" });

    expect(error).toBeInstanceOf(TrimbleUploadError);
    const everything = [
      ...logs,
      (error as Error).message,
      JSON.stringify(local.dump()),
      JSON.stringify(session.dump()),
    ].join("\n");
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain("SECRETSIG");
    expect(everything).not.toContain("upload.example-cdn.test");
  });

  it("reports the stages in order", async () => {
    const { uploader } = harness([initiate(), put(), commit()]);
    const stages: UploadStage[] = [];

    await uploader.upload({
      folderId: "f7",
      name: "Plan.pdf",
      bytes: PDF,
      onStage: (stage) => stages.push(stage),
    });

    expect(stages).toEqual(["preparing", "sending", "finishing"]);
  });

  it("uploads under the same name when asked for a new version", async () => {
    const { calls, uploader } = harness([initiate(), put(), commit(() => json({ id: "file-9", versionId: "ver-2", name: "Plan.pdf" }))]);

    const result = await uploader.upload({ folderId: "f7", name: "Plan.pdf", bytes: PDF });

    const body = JSON.parse(calls.find((call) => call.url.pathname.endsWith("/initiate"))?.body as string);
    expect(body.name).toBe("Plan.pdf");
    expect(result.versionId).toBe("ver-2");
  });
});

describe("failures keep the caller's bytes and end in the matching kind", () => {
  const cases: [string, Route[], string][] = [
    ["401 on initiate", [initiate(() => status(401))], "unauthorized"],
    ["403 on initiate", [initiate(() => status(403))], "forbidden"],
    ["404 on initiate (folder gone)", [initiate(() => status(404))], "not-found"],
    ["413 on initiate", [initiate(() => status(413))], "too-large"],
    ["413 on the send", [initiate(), put(() => status(413))], "too-large"],
    ["500 on the send", [initiate(), put(() => status(500))], "error"],
    ["403 on commit", [initiate(), put(), commit(() => status(403))], "forbidden"],
    ["401 on commit", [initiate(), put(), commit(() => status(401))], "unauthorized"],
    ["a commit with no file id", [initiate(), put(), commit(() => json({ nope: true }))], "error"],
    ["an upload URL that is not https", [initiate(() => json({ uploadId: "u", uploadURL: "http://x.test/p" }))], "error"],
  ];

  for (const [label, routes, kind] of cases) {
    it(label, async () => {
      const { uploader } = harness(routes);
      const bytes = PDF.slice();

      const error = await uploader
        .upload({ folderId: "f7", name: "Plan.pdf", bytes })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(TrimbleUploadError);
      expect((error as TrimbleUploadError).kind).toBe(kind);
      expect(Array.from(bytes)).toEqual(Array.from(PDF));
    });
  }

  it("a network failure is an error", async () => {
    const { files } = harness([]);
    const uploader = createUploader({
      files,
      token: () => TOKEN,
      fetch: (() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch,
    });

    const error = await uploader
      .upload({ folderId: "f7", name: "Plan.pdf", bytes: PDF })
      .catch((caught: unknown) => caught);

    expect((error as TrimbleUploadError).kind).toBe("error");
  });

  it("a missing token is unauthorized and sends nothing", async () => {
    const { files, calls } = harness([initiate(), put(), commit()]);
    const uploader = createUploader({ files, token: () => null, fetch: vi.fn() as unknown as typeof fetch });

    const error = await uploader
      .upload({ folderId: "f7", name: "Plan.pdf", bytes: PDF })
      .catch((caught: unknown) => caught);

    expect((error as TrimbleUploadError).kind).toBe("unauthorized");
    expect(calls.filter((call) => call.url.pathname.includes("/files/fs/"))).toHaveLength(0);
  });
});

describe("cancel", () => {
  it("a cancel before the send does not commit and ends cancelled", async () => {
    const { calls, uploader } = harness([initiate(), put(), commit()]);
    const controller = new AbortController();

    const pending = uploader.upload({
      folderId: "f7",
      name: "Plan.pdf",
      bytes: PDF,
      signal: controller.signal,
      onStage: (stage) => {
        if (stage === "sending") {
          controller.abort();
        }
      },
    });
    const error = await pending.catch((caught: unknown) => caught);

    expect((error as TrimbleUploadError).kind).toBe("cancelled");
    expect(calls.some((call) => call.url.pathname.endsWith("/commit"))).toBe(false);
  });

  it("an already-aborted signal sends nothing", async () => {
    const { calls, uploader } = harness([initiate(), put(), commit()]);
    const controller = new AbortController();
    controller.abort();

    const error = await uploader
      .upload({ folderId: "f7", name: "Plan.pdf", bytes: PDF, signal: controller.signal })
      .catch((caught: unknown) => caught);

    expect((error as TrimbleUploadError).kind).toBe("cancelled");
    expect(calls.filter((call) => call.url.pathname.includes("/files/fs/"))).toHaveLength(0);
  });
});

describe("name conflicts", () => {
  const entries = [
    { id: "d1", type: "FOLDER", name: "Drawings" },
    { id: "a", versionId: "v1", type: "FILE", name: "Plan.pdf", size: 10 },
    { id: "b", versionId: "v1", type: "FILE", name: "Plan (2).pdf", size: 10 },
    { id: "c", versionId: "v4", type: "FILE", name: "Other.pdf", size: 10 },
  ];

  it("finds a file with the same name, ignoring case", async () => {
    const { uploader } = harness([folder("f7", entries)]);

    const found = await uploader.findExisting("f7", "plan.PDF");

    expect(found).toEqual({ id: "a", versionId: "v1", name: "Plan.pdf" });
  });

  it("finds nothing when the name is free", async () => {
    const { uploader } = harness([folder("f7", entries)]);

    expect(await uploader.findExisting("f7", "Fresh.pdf")).toBeNull();
  });

  it("a folder with the same name is not a file conflict", async () => {
    const { uploader } = harness([folder("f7", entries)]);

    expect(await uploader.findExisting("f7", "Drawings")).toBeNull();
  });

  it("numbers past names that are taken", async () => {
    const { uploader } = harness([folder("f7", entries)]);

    expect(await uploader.numberedName("f7", "Plan.pdf")).toBe("Plan (3).pdf");
  });

  it("numbers from 2 when only the plain name exists", async () => {
    const { uploader } = harness([folder("f7", [entries[1]])]);

    expect(await uploader.numberedName("f7", "Plan.pdf")).toBe("Plan (2).pdf");
  });

  it("an upload never overwrites silently: the plain upload step does not look up or delete files", async () => {
    const { calls, uploader } = harness([folder("f7", entries), initiate(), put(), commit()]);

    await uploader.upload({ folderId: "f7", name: "Plan (3).pdf", bytes: PDF });

    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("listing folders for the picker returns folders only, sorted", async () => {
    const { uploader } = harness([
      folder("root-1", [
        { id: "z", type: "FOLDER", name: "Zeta" },
        { id: "a", type: "FOLDER", name: "Alpha" },
        { id: "f", versionId: "v", type: "FILE", name: "Plan.pdf" },
      ]),
    ]);

    const listing = await uploader.folders(null);

    expect(listing.folderId).toBe("root-1");
    expect(listing.folders.map((item) => item.name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("remembered folder", () => {
  it("stores only the folder id and name", () => {
    rememberFolder("p1", { id: "f7", name: "Drawings" });

    const stored = Object.values(local.dump());
    expect(stored).toHaveLength(1);
    expect(JSON.parse(stored[0])).toEqual({ id: "f7", name: "Drawings" });
    expect(recallFolder("p1")).toEqual({ id: "f7", name: "Drawings" });
  });

  it("is kept per Trimble project", () => {
    rememberFolder("p1", { id: "f7", name: "Drawings" });

    expect(recallFolder("p2")).toBeNull();
  });

  it("can be forgotten", () => {
    rememberFolder("p1", { id: "f7", name: "Drawings" });
    forgetFolder("p1");

    expect(recallFolder("p1")).toBeNull();
  });

  it("ignores a stored value that has other fields or the wrong shape", () => {
    localStorage.setItem("hero.trimble.exportFolder.p1", JSON.stringify({ id: "f7", name: "D", token: "x" }));
    localStorage.setItem("hero.trimble.exportFolder.p2", "not json");

    expect(recallFolder("p1")).toEqual({ id: "f7", name: "D" });
    expect(recallFolder("p2")).toBeNull();
  });
});
