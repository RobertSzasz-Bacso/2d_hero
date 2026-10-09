// Save a PDF into a Trimble Connect project folder through the Core API. The editor and
// `src/pdf/` never import this module: only the hosted shell does. The access token is read
// from `token()` for each Trimble request and is never stored here. The signed upload URL is
// used once and never kept, logged, or put in an error. It is called with no Authorization.
//
// The flow is the one `trimble-connect-sdk` 4.0.11 uses in `TCPS.uploadFileContent`
// (`dist/es/tcps.js`): POST files/fs/initiate, PUT the bytes to `uploadURL`, POST files/fs/commit.
// The SDK has no step that deletes an upload that was not committed. An upload that is never
// committed creates no file, so a cancel stops after the initiate and does not commit.

import type { FilesClient, FolderItem } from "./files.ts";
import { TrimbleFilesError } from "./files.ts";

const API_PATH = "/tc/api/2.0";
const FOLDER_KEY = "hero.trimble.exportFolder.";

export type UploadErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "too-large"
  | "cancelled"
  | "error";

/** `fetch` gives no upload byte progress, so the dialog shows these stages. */
export type UploadStage = "preparing" | "sending" | "finishing";

const MESSAGES: Record<UploadErrorKind, string> = {
  unauthorized: "Trimble Connect did not accept your session. Reload the page to sign in again.",
  forbidden: "You do not have permission to add files to this folder.",
  "not-found": "That folder was not found in Trimble Connect.",
  "too-large": "Trimble Connect refused the file because it is too large.",
  cancelled: "The upload was cancelled.",
  error: "The PDF could not be saved to Trimble Connect.",
};

/** A failure with a fixed message. Response text and URLs are never copied into it. */
export class TrimbleUploadError extends Error {
  readonly kind: UploadErrorKind;

  constructor(kind: UploadErrorKind) {
    super(MESSAGES[kind]);
    this.name = "TrimbleUploadError";
    this.kind = kind;
  }
}

export interface ExistingFile {
  id: string;
  versionId?: string;
  name: string;
}

export interface UploadRequest {
  folderId: string;
  name: string;
  bytes: Uint8Array;
  signal?: AbortSignal;
  onStage?: (stage: UploadStage) => void;
}

export interface UploadResult {
  fileId: string;
  versionId?: string;
  name: string;
  folderId: string;
}

export interface FolderListing {
  folderId: string;
  folders: FolderItem[];
}

export interface Uploader {
  /** The sub-folders of a folder. `null` is the project root. Files are not listed. */
  folders(folderId: string | null): Promise<FolderListing>;
  /** The file with this name in the folder, ignoring case. Folders do not count. */
  findExisting(folderId: string, name: string): Promise<ExistingFile | null>;
  /** `Plan (2).pdf`, `Plan (3).pdf`, ... the first name the folder does not use. */
  numberedName(folderId: string, name: string): Promise<string>;
  /** Uploads under exactly `name`. The caller decides on a clash first. Never overwrites by itself. */
  upload(request: UploadRequest): Promise<UploadResult>;
}

export interface UploaderOptions {
  files: FilesClient;
  token: () => string | null;
  fetch?: typeof fetch;
}

function kindOf(status: number): UploadErrorKind {
  if (status === 401) {
    return "unauthorized";
  }
  if (status === 403) {
    return "forbidden";
  }
  if (status === 404) {
    return "not-found";
  }
  if (status === 413) {
    return "too-large";
  }
  return "error";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function splitName(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), extension: name.slice(dot) } : { stem: name, extension: "" };
}

function sameName(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

export function createUploader(options: UploaderOptions): Uploader {
  const { files } = options;
  const call = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  function mapFilesError(error: unknown): TrimbleUploadError {
    if (error instanceof TrimbleUploadError) {
      return error;
    }
    if (error instanceof TrimbleFilesError) {
      return new TrimbleUploadError(error.kind === "error" ? "error" : error.kind);
    }
    return new TrimbleUploadError("error");
  }

  async function post(origin: string, path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const token = options.token();
    if (!token) {
      throw new TrimbleUploadError("unauthorized");
    }
    let response: Response;
    try {
      response = await call(`${origin}${API_PATH}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        signal,
      });
    } catch (error) {
      throw new TrimbleUploadError(isAbort(error) ? "cancelled" : "error");
    }
    // Host, path, and status only. No query string, no token.
    console.info("2D Hero: Trimble Core API", origin.replace("https://", "") + API_PATH + path, response.status);
    if (!response.ok) {
      throw new TrimbleUploadError(kindOf(response.status));
    }
    try {
      return await response.json();
    } catch {
      throw new TrimbleUploadError("error");
    }
  }

  async function send(url: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    let response: Response;
    try {
      // The signed URL carries its own permission. No Authorization header, no cookies.
      response = await call(url, {
        method: "PUT",
        body: new Blob([copy], { type: "application/pdf" }),
        credentials: "omit",
        cache: "no-store",
        signal,
      });
    } catch (error) {
      throw new TrimbleUploadError(isAbort(error) ? "cancelled" : "error");
    }
    if (!response.ok) {
      throw new TrimbleUploadError(kindOf(response.status));
    }
  }

  async function folderEntries(folderId: string | null) {
    try {
      return await files.entries(folderId);
    } catch (error) {
      throw mapFilesError(error);
    }
  }

  return {
    async folders(folderId) {
      const listing = await folderEntries(folderId);
      return { folderId: listing.folderId, folders: listing.folders };
    },

    async findExisting(folderId, name) {
      const listing = await folderEntries(folderId);
      const found = listing.files.find((file) => sameName(file.name, name));
      return found ? { id: found.id, versionId: found.versionId, name: found.name } : null;
    },

    async numberedName(folderId, name) {
      const listing = await folderEntries(folderId);
      const { stem, extension } = splitName(name);
      for (let number = 2; ; number += 1) {
        const candidate = `${stem} (${number})${extension}`;
        if (!listing.files.some((file) => sameName(file.name, candidate))) {
          return candidate;
        }
      }
    },

    async upload(request) {
      const { folderId, name, bytes, signal, onStage } = request;
      const stop = () => {
        if (signal?.aborted) {
          throw new TrimbleUploadError("cancelled");
        }
      };
      stop();
      onStage?.("preparing");
      let origin: string;
      try {
        origin = await files.apiOrigin();
      } catch (error) {
        throw mapFilesError(error);
      }
      stop();

      const started = asRecord(
        await post(origin, "/files/fs/initiate", { parentId: folderId, parentType: "FOLDER", name }, signal),
      );
      const uploadId = started?.uploadId;
      const uploadUrl = started?.uploadURL;
      if (typeof uploadId !== "string" || typeof uploadUrl !== "string" || !uploadUrl.startsWith("https://")) {
        throw new TrimbleUploadError("error");
      }
      stop();

      onStage?.("sending");
      stop();
      await send(uploadUrl, bytes, signal);
      stop();

      onStage?.("finishing");
      const done = asRecord(await post(origin, "/files/fs/commit", { uploadId }, signal));
      if (!done || typeof done.id !== "string" || done.id.length === 0) {
        throw new TrimbleUploadError("error");
      }
      let versionId = typeof done.versionId === "string" && done.versionId ? done.versionId : undefined;
      if (versionId === undefined) {
        // The commit reply did not say which version it made. Ask the folder.
        try {
          const listing = await files.entries(folderId);
          versionId = listing.files.find((file) => file.id === done.id)?.versionId;
        } catch {
          versionId = undefined;
        }
      }
      return {
        fileId: done.id,
        ...(versionId ? { versionId } : {}),
        name: typeof done.name === "string" && done.name ? done.name : name,
        folderId,
      };
    },
  };
}

export interface RememberedFolder {
  id: string;
  name: string;
}

/** Remember the last export folder per Trimble project. Folder id and name only. */
export function rememberFolder(projectId: string, folder: RememberedFolder): void {
  try {
    localStorage.setItem(FOLDER_KEY + projectId, JSON.stringify({ id: folder.id, name: folder.name }));
  } catch {
    // Storage can be blocked inside an iframe. The folder is a convenience.
  }
}

export function recallFolder(projectId: string): RememberedFolder | null {
  try {
    const raw = localStorage.getItem(FOLDER_KEY + projectId);
    if (raw === null) {
      return null;
    }
    const value = asRecord(JSON.parse(raw));
    if (value && typeof value.id === "string" && value.id && typeof value.name === "string") {
      return { id: value.id, name: value.name };
    }
  } catch {
    return null;
  }
  return null;
}

export function forgetFolder(projectId: string): void {
  try {
    localStorage.removeItem(FOLDER_KEY + projectId);
  } catch {
    // Nothing to forget.
  }
}
