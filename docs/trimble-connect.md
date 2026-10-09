# Trimble Connect hosted integration

Phase 21. The editor runs as a Trimble Connect project extension in an iframe. Phase 21 is the shell only: connect, get a token, call the backend. Phase 22 adds the file picker and the download (see "Files and download"). Nothing is uploaded back to Trimble Connect.

## Verified package

| Item | Value |
| --- | --- |
| Package | `trimble-connect-workspace-api` |
| Version | `0.3.38` (published 2026-10-06), pinned exactly in `apps/web/package.json` |
| Not used | `trimble-connect-project-workspace-api` 0.1.5. Trimble's own docs say that API "will stop working after the end of 2023 Q1" and name `trimble-connect-workspace-api` as the replacement. Decision in `docs/decisions.md`. |

Read in the installed package (`dist/Workspace/*.d.ts` and `dist/es/*.js`):

- `connect(target, onEvent?, timeout?)` posts to `window.parent` and resolves to the exposed API. The handshake (`.connect_api_client_v1`) has no timeout, so the adapter adds its own (15 s).
- `api.extension.requestPermission("accesstoken")` returns a string. The adapter reads `"pending"`, `"denied"`, or a JWT-shaped string. Any other value is treated as unavailable.
- `extension.accessToken` delivers the token when permission was pending, and again on refresh. `embed.session.refreshed` is handled the same way. `extension.sessionInvalid`, `extension.sessionLogOut`, and `extension.closing` drop the token.
- `api.project.getProject()` returns `{ id, name?, ... }`. It is context only. A failure does not block the editor.
- `getPermission` is deprecated in this package. We call `requestPermission`.
- The package does not check who sent a message, and it posts with target origin `*`. `origins.ts` compensates: the shell only starts when the parent origin (`location.ancestorOrigins`, else the referrer) is allowed, and a capture-phase listener drops Workspace API messages from any other window or origin before the package sees them.
- Allowed parent origins: `https://web.connect.trimble.com` (from the package's `getConnectEmbedUrl("prod")`) plus any `https` origins in the build-time variable `VITE_TRIMBLE_PARENT_ORIGINS` (comma list). `http` is accepted only for `localhost`, `127.0.0.1`, and `*.test`.

Not verified against a live Trimble Connect session: the exact claims in a real access token, the exact manifest fields Trimble Connect requires beyond `title`, `url`, and `extensionType`, and regional parent origins other than `web.connect.trimble.com`. Check these on the first real run (see Test below).

## Manifest

`GET /trimble/manifest.json` on the hosted app returns:

```json
{
  "title": "2D Hero",
  "description": "Editable metric floor plans from 3D scans and IFC models.",
  "url": "https://<public host>/",
  "icon": "https://<public host>/favicon.svg",
  "enabled": true,
  "extensionType": ["project"]
}
```

The package's `ExtensionSetting` says `extensionType` is required in every manifest. Trimble's docs also say the manifest URL must send CORS headers, so the route sends `Access-Control-Allow-Origin: *`. It is public and holds no secret. A project admin adds it in Trimble Connect under Project Settings, Extensions.

## Token handling

- Browser: the token is in the `hostBearer` store (memory). It is never put in `localStorage`, `sessionStorage`, a cookie, the URL, `plan.json`, or a log. Error text from the parent is not copied anywhere, because it can echo a token.
- API: `HostedSecurityMiddleware` reads `Authorization: Bearer`, checks it, and drops it. The token and its signature are not logged and not in any response. `tests/test_hosted.py` asserts this with `caplog`, the response bodies and headers, and a scan of every file written under the config and project folders.
- Checks: signature (RS256 only, key from the issuer's JWKS, cached for an hour), `iss`, `aud`, and `exp`. All three claims are required. 30 s of clock leeway. `alg: none`, HS256, and tokens over 8 KB are rejected.
- Not checked yet: per-user project ownership. See "Deployment assumptions".

## Settings

All names. None is a secret. Hosted mode refuses to start with a missing or unsafe value, and the error names the setting, never the value.

| Variable | Meaning |
| --- | --- |
| `HERO_HOSTED_PUBLIC_URL` | `https` origin users reach, for example `https://hero.example.com`. |
| `HERO_HOSTED_ALLOWED_HOSTS` | Comma list of exact `Host` values. |
| `HERO_TRIMBLE_ISSUER` | Expected `iss`. Must be an `https` URL. |
| `HERO_TRIMBLE_AUDIENCE` | Expected `aud`: the OAuth client id registered with Trimble. |
| `HERO_TRIMBLE_JWKS_URL` | `https` URL of the issuer's signing keys. |
| `HERO_HOSTED_CORS_ORIGINS` | Optional. `https` origins, no wildcard. Empty means same-origin only. |
| `HERO_HOSTED_FRAME_ANCESTORS` | Optional. Default `https://web.connect.trimble.com`. |

The values for issuer, audience, and JWKS come from the owner's Trimble developer registration. They are not defaults, because they were not verified.

## Deployment assumptions

- HTTPS is terminated by a reverse proxy in front of `uv run hero --hosted --host 127.0.0.1 --port 8000`. Do not expose uvicorn directly.
- The web build (`npm run build`) is served by the same process from `apps/web/dist`, so the page and API share an origin. Build with `VITE_TRIMBLE_PARENT_ORIGINS` set if you need more parent origins than the production one.
- Storage is still one shared `Documents\2D Hero` folder for the process. There is no per-user separation yet. Run it for one trusted team, or wait for the phase that adds ownership. The Cursor AI features have no key in hosted mode because the key routes are closed.
- Local mode is unchanged: `uv run hero` binds `127.0.0.1` and uses the session token.

## Test

Automated: `powershell -File scripts\test.ps1`. The pieces:

- `apps/api/tests/test_hosted.py`: token path, rejection cases, host, CORS, framing, closed routes, secret leaks, configuration.
- `apps/web/src/integrations/trimble/*.test.ts` and `src/hostAuth.test.ts`: the adapter, the origin checks, and `heroFetch` in both modes.
- `apps/web/e2e/trimble-host.spec.ts`: a stand-in parent page (`e2e/fixtures/trimble-host.html`) runs the host side of the real package and embeds the app in an iframe.

The e2e script uses API port 8091. If another program holds it, set `HERO_E2E_API_PORT` to a free port first.

## Menu entry

The adapter calls ui.setMenu({ title, command, icon }) once, after the handshake. The icon must be an absolute URL to a real PNG on our origin (/icon.png, also the manifest icon). With no icon the call is accepted but Trimble Connect draws no entry. The adapter logs whether Trimble accepted the entry (no token in the message).


## Files and download (Phase 22)

The hosted shell has a file picker. The browser lists the project's files with the parent token, asks Trimble for a download URL, and sends only that URL to `POST /api/projects/from-url`. The backend streams the URL to a new project and the normal import flow runs. Nothing is uploaded to Trimble Connect, and nothing is converted.

### What was verified, and where

| Item | Source | Status |
| --- | --- | --- |
| Regional base URLs come from `GET https://app.connect.trimble.com/tc/api/2.0/regions`. Each region has an `origin`. | Trimble Connect reference, "Regions can be discovered by calling the /regions endpoint of the master region. Use the origin field value to determine the base URL". | Doc read. Field names `origin` and `location` not seen in a live reply. |
| Project root: `GET {origin}/tc/api/2.0/projects/{projectId}` has `rootId`. | `trimble-connect-sdk` 4.0.11 typings (`FileSystemEntry`), forum threads on walking the tree from the root. | Not seen live. |
| Folder contents: `GET {origin}/tc/api/2.0/folders/{id}/items`. Items have `id`, `name`, `type` (`FILE` or `FOLDER`), `versionId`, `size`. | `trimble-connect-sdk` 4.0.11 typings. | Not seen live. |
| Download URL: `GET {origin}/tc/api/2.0/files/fs/{fileId}/downloadurl?versionId={versionId}` returns `{ "url": "https://..." }`. The URL is signed and short-lived and needs no `Authorization` header. | Trimble Connect Core API reference, `UrlResponse` in the SDK typings, forum thread "API - File download URL". | Not seen live. The forum thread reports HTTP 403 from non-browser clients for some URLs. See Left open in the handoff. |
| `api.viewer.getModels("loaded")` returns `ModelSpec[]` with `id`, `versionId`, `name`, `type`, `state`. | `trimble-connect-workspace-api` 0.3.38, `dist/Workspace/ViewerAPI.d.ts` and `common.d.ts`. | Types read. That a model's `id` is the Core API file id is not verified live. |
| `api.project.getProject()` returns `{ id, name?, location?, ... }`. | `dist/Workspace/ProjectAPI.d.ts`. | `location` is used only to try the right region first. |

The picker only sends the token to `https` hosts that are `connect.trimble.com` or end in `.connect.trimble.com`. A region origin outside that set is ignored.

### Download rules

The backend enforces these in `apps/api/src/hero/download.py`.

- `https` only. No credentials in the URL. Port 443 only.
- The host must be in `HERO_TRIMBLE_DOWNLOAD_HOSTS`, or be a Trimble file-service host: exactly one label plus `.fileservice.trimblecloud.com` (for example `eu-aws-ro.fileservice.trimblecloud.com`). The setting has no default list, so any other host gets 400.
- Every address the host resolves to must be public (`ipaddress.is_global`). A literal IP in the URL is checked the same way.
- Redirects are followed by hand, at most 3, and only to the same host. Each hop passes the same checks. A redirect to another host is 400.
- The file name from the request must end in a type the import reads (`.obj .glb .gltf .usdz .usd .usda .usdc .ply .e57 .las .laz .ifc`). Otherwise 400.
- Size: `HERO_TRIMBLE_MAX_DOWNLOAD_MB` (default 2048). A `Content-Length` over the limit is 413 before any byte is stored. A stream that passes the limit is 413 and removed. The 200 MB copy limit for local uploads is unchanged.
- The download writes `source.<ext>.part` in the new project folder and `os.replace`s it. Any failure or cancel removes the whole project folder.
- Logs carry no URL. `httpx` and `httpcore` log every request URL at INFO, query string included, so `hero.download` raises both loggers to WARNING.
- The handler never reads the `Authorization` header. The hosted middleware checks it as for every `/api` route and drops it. The request to the download host carries no `Authorization` and no cookie.

The project records `trimbleSource` (`fileId`, `versionId`, `name`) in `project.json`. It holds no URL and no token.

### Settings added

| Variable | Meaning |
| --- | --- |
| `HERO_TRIMBLE_DOWNLOAD_HOSTS` | Comma list of exact host names the signed download URL may use. No default. Not verified against a live project yet: read the host from a real URL and set it. |
| `HERO_TRIMBLE_MAX_DOWNLOAD_MB` | Optional. Whole number of megabytes. Default 2048. |

### Progress and cancel

The browser picks a 32-character hex transfer id and sends it as `transferId`. `GET /api/transfers/{id}` returns `{ "state": "running", "bytes": n, "total": n or null }` while the download runs. `POST /api/transfers/{id}/cancel` stops it; the original request then returns 409 `The download was cancelled.` A finished transfer is forgotten, so its id returns 404.

### Point clouds that are not files

A point cloud that exists only in the viewer cannot be downloaded. If the Core API answers 404 for a loaded model's file id, the picker says `This model is not available as a downloadable file.` and stops. No conversion is attempted.

### Live check (owner)

Not automated. In a real project: list files, download a real `.las` or `.e57`, and record here (a) the token scope result, (b) the download host, (c) whether `getModels("loaded")` ids are file ids, (d) the exact `/regions`, `/projects/{id}`, and `/folders/{id}/items` field names.


## Saving the PDF (Phase 23)

In the hosted shell the export dialog offers "Save to Trimble Connect" next to "Download". The browser builds the PDF with `pdf-lib`, lists the project's folders, and uploads with the parent token. The 2D Hero backend never receives the PDF, the token, or the signed upload URL.

### What was verified, and where

| Item | Source | Status |
| --- | --- | --- |
| Upload is three calls: `POST {origin}/tc/api/2.0/files/fs/initiate` with `{ parentId, parentType: "FOLDER", name }` returns `{ uploadId, uploadURL }`; `PUT uploadURL` with the bytes; `POST files/fs/commit` with `{ uploadId }` returns the file entry. | `trimble-connect-sdk` 4.0.11 `dist/es/tcps.js`, `TCPS.uploadFileContent`, and `InitUploadResponse` in `tcps_interfaces.d.ts`. | Read in the package. Not seen live. |
| The PUT to `uploadURL` carries no `Authorization` header. | The same SDK code calls `fetch(uploadURL, { method: "PUT", body: file })`. | Read in the package. The app sends no Authorization and no cookies there. |
| The commit reply has `id` and, per `FileEntry`, an optional `versionId`. | SDK typings. | If `versionId` is missing the app reads it from the folder listing. If it is still missing, `trimbleExport` is not recorded. |
| A name that already exists in the folder. | Not documented in the SDK or the pages read. | **Not verified.** The app never relies on it: it lists the folder first and asks. "New version" uploads under the same name. Whether that creates version 2 of the file or a second file is a live check (below). |
| Deleting an upload that was not committed. | No such call in the SDK. | None is used. A cancel stops before the commit, and an upload that is never committed makes no file. |
| Size limit. | Trimble help: 5 GB per file for the browser app. | A 413 from either call shows "too large". |

`fetch` gives no upload byte progress, so the dialog shows three stages: preparing, sending, finishing. Cancel aborts the request in flight and skips the commit.

### Rules in the code (`integrations/trimble/upload.ts`)

- The bearer goes only to Trimble Connect hosts. The signed upload URL must be `https` and is called with no Authorization header and `credentials: "omit"`.
- The console log for a Core API call is host, path, and status. The signed URL is never logged. Error text is fixed, never copied from a response.
- The editor and `src/pdf/` see only `PdfSaveTarget` (`src/pdf/target.ts`). `main.tsx` provides it in the hosted shell only. Local mode has no target and the dialog is unchanged.
- The last folder is remembered per Trimble project in `localStorage` as `{ id, name }`. Nothing else.
- A failed upload keeps the PDF bytes in the dialog. "Download" saves them without a second export. When the browser blocks the save dialog inside the iframe (`SecurityError`), `savePdf` falls back to a normal download.

### Project record

`PUT /api/projects/{id}/trimble-export` stores `trimbleExport` (`fileId`, `versionId`, `folderId`, `name`, `savedAt`) in `project.json`. A URL-like or token-shaped value is refused with 400. Hosted only.

### Live check (owner)

Not automated. In a real project: save a PDF into a folder and open it in Trimble Connect; save again with the same name, choose "new version", and see whether the file shows version 2 or a second file appears; record (a) the token scope result for uploads (a 403 means the extension token cannot write), (b) the upload host, (c) the size limit, (d) the version behaviour. If the host is blocked by the extension's content security policy, record the host.

## Running it on your own PC behind a Dev Tunnel

Use this when your network blocks Cloudflare Tunnel. `cloudflared` connects out on port 7844 and has no flag to change that. A Microsoft Dev Tunnel connects out over HTTPS (443). No admin rights are needed on Windows. This path was written from Microsoft's documentation and has **not** been run against Trimble Connect yet.

1. Install: `winget install Microsoft.devtunnel`, `uv`, Node.js, and Git. Clone the repo.
2. Build: `cd apps\web ; npm install ; npm run build`, then `cd apps\api ; uv sync`.
3. Create `%APPDATA%\2D Hero\hosted.env` (never in the repo) with `HERO_TRIMBLE_ISSUER`, `HERO_TRIMBLE_AUDIENCE`, `HERO_TRIMBLE_JWKS_URL`, and `HERO_TRIMBLE_DOWNLOAD_HOSTS`. The values come from the Trimble registration.
4. Run `powershell -File scripts\hosted-devtunnel.ps1`. The first run asks you to sign in with a Microsoft or GitHub account and creates a persistent tunnel, so the public address is the same on every run. The script prints the manifest URL.
5. A project admin adds that manifest URL in Trimble Connect under Project Settings, Extensions. Admin rights are needed only on the Trimble Connect project, and you have them on your own project.

Known risks to test:

- Microsoft shows a one-time anti-phishing page on the first browser visit to a tunnel address. Open the address once in the same browser and choose Continue. If the page still appears inside the Trimble Connect frame (third-party cookies blocked), the extension will not load and this route needs another host.
- The tunnel's `Host` header must match the public address. If the server answers 400 for the host, check the printed address against `HERO_HOSTED_ALLOWED_HOSTS`.
- Anonymous access means anyone with the address can load the page. `/api` still needs a valid Trimble token.
- Dev Tunnels are for development. Microsoft expires an idle tunnel after 30 days.