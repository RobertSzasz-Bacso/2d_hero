// Trimble Connect Core API calls for the file picker. The editor never imports this module:
// only the hosted shell does. The access token is read from `token()` for each request and is
// never stored here. A signed download URL is returned to the caller and is not kept either.

export const MASTER_ORIGIN = "https://app.connect.trimble.com";
const API_PATH = "/tc/api/2.0";

/** The import types the API reads (`docs/plan-schema.md`, plus the USD variants). */
const SUPPORTED = new Set([
  ".obj",
  ".glb",
  ".gltf",
  ".usdz",
  ".usd",
  ".usda",
  ".usdc",
  ".ply",
  ".e57",
  ".las",
  ".laz",
  ".ifc",
]);

export type FilesErrorKind = "unauthorized" | "forbidden" | "not-found" | "error";

const MESSAGES: Record<FilesErrorKind, string> = {
  unauthorized: "Trimble Connect did not accept your session. Reload the page to sign in again.",
  forbidden: "You do not have access to this project's files.",
  "not-found": "That project or folder was not found in Trimble Connect.",
  error: "Trimble Connect could not list the files.",
};

/** A failure with a fixed message. Response text and URLs are never copied into it. */
export class TrimbleFilesError extends Error {
  readonly kind: FilesErrorKind;

  constructor(kind: FilesErrorKind) {
    super(MESSAGES[kind]);
    this.name = "TrimbleFilesError";
    this.kind = kind;
  }
}

export interface FolderItem {
  id: string;
  name: string;
}

export interface FileItem {
  id: string;
  versionId: string;
  name: string;
  size?: number;
}

export interface Listing {
  folderId: string;
  folders: FolderItem[];
  files: FileItem[];
  /** Files left out because the import cannot read their type, or they have no version. */
  hidden: number;
}

export interface FilesClientOptions {
  projectId: string;
  /** The project's `location` from the Workspace API, when known. */
  location?: string;
  token: () => string | null;
  fetch?: typeof fetch;
}

export interface FilesClient {
  listRoot(): Promise<Listing>;
  listFolder(folderId: string): Promise<Listing>;
  /** A short-lived signed URL for one file version. Send it to the backend. Do not store it. */
  downloadUrl(fileId: string, versionId: string): Promise<string>;
}

export function isSupportedName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && SUPPORTED.has(name.slice(dot).toLowerCase());
}

interface Region {
  location?: string;
  origin: string;
}

const KNOWN_ORIGINS: Region[] = [
  { location: "northamerica", origin: "https://app.connect.trimble.com" },
  { location: "europe", origin: "https://app21.connect.trimble.com" },
  { location: "asia", origin: "https://app31.connect.trimble.com" },
];

function isTrimbleOrigin(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.port === "" &&
      (url.hostname === "connect.trimble.com" || url.hostname.endsWith(".connect.trimble.com"))
    );
  } catch {
    return false;
  }
}

function kindOf(status: number): FilesErrorKind {
  if (status === 401) {
    return "unauthorized";
  }
  if (status === 403) {
    return "forbidden";
  }
  if (status === 404) {
    return "not-found";
  }
  return "error";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function byName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true });
}

export function createFilesClient(options: FilesClientOptions): FilesClient {
  const call = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  let origin: string | null = null;
  let rootId: string | null = null;

  async function get(base: string, path: string): Promise<unknown> {
    const token = options.token();
    if (!token) {
      throw new TrimbleFilesError("unauthorized");
    }
    let response: Response;
    try {
      response = await call(`${base}${API_PATH}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
      });
    } catch {
      throw new TrimbleFilesError("error");
    }
    // Host, path, and status only. No query string, no token.
    console.info("2D Hero: Trimble Core API", base.replace("https://", "") + API_PATH + path.split("?")[0], response.status);
    if (!response.ok) {
      throw new TrimbleFilesError(kindOf(response.status));
    }
    try {
      return await response.json();
    } catch {
      throw new TrimbleFilesError("error");
    }
  }

  async function regions(): Promise<Region[]> {
    const body = await get(MASTER_ORIGIN, "/regions");
    if (!Array.isArray(body)) {
      throw new TrimbleFilesError("error");
    }
    const found: Region[] = [];
    for (const entry of body) {
      const record = asRecord(entry);
      // The token is only ever sent to Trimble Connect hosts.
      if (record && isTrimbleOrigin(record.origin)) {
        found.push({
          origin: new URL(record.origin).origin,
          location: typeof record.location === "string" ? record.location : undefined,
        });
      }
    }
    return found;
  }

  async function openProject(): Promise<void> {
    if (origin && rootId) {
      return;
    }
    let all: Region[] = [];
    try {
      all = await regions();
    } catch (error) {
      if (error instanceof TrimbleFilesError && error.kind === "unauthorized") {
        throw error;
      }
    }
    // Regional hosts Trimble documents, tried when /regions gives nothing usable.
    for (const known of KNOWN_ORIGINS) {
      if (!all.some((region) => region.origin === known.origin)) {
        all.push(known);
      }
    }
    const wanted = options.location?.toLowerCase();
    const preferred = all.filter((region) => region.location?.toLowerCase() === wanted);
    const candidates = [...preferred, ...all.filter((region) => !preferred.includes(region))];
    let failure: TrimbleFilesError | null = null;
    for (const region of candidates) {
      try {
        const project = asRecord(await get(region.origin, `/projects/${encodeURIComponent(options.projectId)}`));
        if (project && typeof project.rootId === "string" && project.rootId.length > 0) {
          origin = region.origin;
          rootId = project.rootId;
          return;
        }
        failure = new TrimbleFilesError("error");
      } catch (error) {
        if (error instanceof TrimbleFilesError && error.kind === "unauthorized") {
          throw error;
        }
        // A project lives in one region. A 404 elsewhere is expected, so keep the most
        // useful failure and try the next region.
        if (error instanceof TrimbleFilesError && (!failure || failure.kind === "not-found")) {
          failure = error;
        }
      }
    }
    throw failure ?? new TrimbleFilesError("not-found");
  }

  async function list(folderId: string): Promise<Listing> {
    await openProject();
    const body = await get(origin as string, `/folders/${encodeURIComponent(folderId)}/items`);
    if (!Array.isArray(body)) {
      throw new TrimbleFilesError("error");
    }
    const folders: FolderItem[] = [];
    const files: FileItem[] = [];
    let hidden = 0;
    for (const entry of body) {
      const item = asRecord(entry);
      if (!item || typeof item.id !== "string" || typeof item.name !== "string") {
        continue;
      }
      if (item.type === "FOLDER") {
        folders.push({ id: item.id, name: item.name });
      } else if (item.type === "FILE") {
        if (isSupportedName(item.name) && typeof item.versionId === "string" && item.versionId) {
          files.push({
            id: item.id,
            versionId: item.versionId,
            name: item.name,
            ...(typeof item.size === "number" ? { size: item.size } : {}),
          });
        } else {
          hidden += 1;
        }
      }
    }
    folders.sort(byName);
    files.sort(byName);
    return { folderId, folders, files, hidden };
  }

  return {
    async listRoot() {
      await openProject();
      return list(rootId as string);
    },
    listFolder: list,
    async downloadUrl(fileId, versionId) {
      await openProject();
      const body = asRecord(
        await get(
          origin as string,
          `/files/fs/${encodeURIComponent(fileId)}/downloadurl?versionId=${encodeURIComponent(versionId)}`,
        ),
      );
      const url = body?.url;
      if (typeof url !== "string" || !url.startsWith("https://")) {
        throw new TrimbleFilesError("error");
      }
      return url;
    },
  };
}
