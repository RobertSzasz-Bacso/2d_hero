# Trimble Connect hosted integration

Phase 21. The editor runs as a Trimble Connect project extension in an iframe. This phase is the shell only: connect, get a token, call the backend. It does not download point clouds, import Trimble files, or upload plans.

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

