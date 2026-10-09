# Phase 21 - Trimble Connect hosted integration

Status: done. The owner accepted the failures in `check.ps1` that were there before this phase (see Left open) and asked to keep them as they are.
Commit: `Phase 21: Trimble Connect hosted integration` (on main, not pushed)

## What landed

- Package: `trimble-connect-workspace-api` 0.3.38, pinned. The plan named `trimble-connect-project-workspace-api`; Trimble deprecated it (see `docs/trimble-connect.md`, `docs/decisions.md`). The owner chose the new package.
- API, `apps/api/src/hero/hosted.py`: `HostedConfig.from_env`, `TokenVerifier` (PyJWT, RS256, JWKS), `HostedSecurityMiddleware` (Host allow-list, bearer check, closed local-only routes, `frame-ancestors`), `manifest`.
- `create_app(..., hosted=, key_provider=)`: hosted mode adds `GET /api/hosted/session` and public `GET /trimble/manifest.json`, uses its own CORS list, writes no session file, and closes `linkPath`. Local mode is the same code path as before.
- `uv run hero --hosted [--host H] [--port P]` reads `HERO_HOSTED_*` and `HERO_TRIMBLE_*`.
- Web, `apps/web/src/integrations/trimble/`: `adapter.ts`, `origins.ts`, `connection.ts` (the only import of the package), `HostedGate.tsx`. `hostAuth.ts` is the in-memory bearer store. `heroFetch` sends `Authorization: Bearer` only when no local session token exists.
- `main.tsx` picks hosted mode when the page is framed and has no local session token.
- Docs: `docs/trimble-connect.md` (new), `docs/architecture.md` (Hosted mode), `docs/libraries.md`, `docs/decisions.md`, `secrets.mdc`, `python-backend.mdc`.
- Infra: `.gitattributes` keeps the golden SVG LF. `scripts/e2e-server.ps1` sets `VITE_TRIMBLE_PARENT_ORIGINS` for the test parent and reads `HERO_E2E_API_PORT`.

## Tests

Written first. The red runs:

- `pytest tests/test_hosted.py`: collection error, `No module named 'hero.hosted'`.
- `vitest run`: `adapter.test.ts`, `origins.test.ts`, and `hostAuth.test.ts` failed to load (modules missing). Everything else passed except the golden SVG (below).
- Playwright `trimble-host.spec.ts` was not seen red for the missing behavior. Its first runs failed on environment problems (port 8091 held by another program, no Chromium, and Chromium's Local Network Access block on an intercepted public origin). I changed the harness, not an assertion, and it passed on the next run.

Green runs:

- `pytest tests/test_hosted.py`: 50 passed.
- `vitest run`: 20 files, 151 passed.
- `playwright test`: 17 passed (10 existing, 7 new). Run with `HERO_E2E_API_PORT=8092`.
- `ruff check .`: clean. `tsc` for `tsconfig.app.json` and `tsconfig.node.json`: clean.

## Spec changes

- `docs/architecture.md`: hosted mode section.
- `docs/libraries.md`: `pyjwt[crypto]` and `trimble-connect-workspace-api`.
- `master_plan.md`: Phase 21 uses the workspace package; a Phase 21 status line was added.
- The golden SVG was LF in git and CRLF in this checkout (`core.autocrlf`). `.gitattributes` fixes new checkouts, and I converted the working file.

## Left open

- `check.ps1` is red, and none of it is in Phase 21 files:
  - `pyright`: 13 errors in `ai/agent.py`, `ai/identify.py`, `ai/mask.py`, `test_ai.py`, `test_identify.py`, `test_ingest.py`. `cursor_sdk` is not installed (optional extra).
  - `pytest`: 3 failures. `test_ifc.py::test_axis_wall_does_not_call_the_mesh_detector` patches `hero.jobs.detect_surfaces`, which does not exist. `test_testkit.py::test_same_seed_writes_the_same_obj_bytes` compares LF output to a CRLF `building.obj`. `test_samples.py::test_reference_length_matches_a_known_wall` reports no walls in `building.obj`, which is probably the same CRLF cause (not checked).
  - Owner decision (2026-10-09): mark Phase 21 done and leave these as they were. They need their own fix before the next phase relies on a green `check.ps1`.
- Checked live (owner, 2026-10-09, quick tunnel to `127.0.0.1:8000`): the extension loads, the menu entry shows, and the hosted session bar reads "Connected". Real values: issuer `https://id.trimble.com`, JWKS `https://id.trimble.com/.well-known/jwks.json`. The token `aud` is a list of six Trimble client ids that belong to Trimble Connect, not to 2D Hero, so the check is "valid Trimble token for one configured audience". Not checked: regional parent origins and any manifest field beyond `title`, `url`, `icon`, `enabled`, `extensionType`.
- Hosted storage is one shared folder. There is no per-user ownership. Settings (title block, grid) are also shared.
- Not done: nothing is downloaded, imported, or uploaded from Trimble Connect.

## Do not redo

- Do not use `trimble-connect-project-workspace-api`. It is deprecated.
- Do not call the package's `connect()` and trust it: it posts to `*` and ignores the sender. Keep the origin checks in `origins.ts`.
- In Playwright, do not fulfill the parent page with `page.route` when it frames `127.0.0.1`. Chromium blocks it (`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`). Serve `e2e/fixtures/trimble-host.html` from Vite on `localhost`.
- Do not mock `/api/*` in a test that claims "no local token is needed" and let the Vite proxy answer. The proxy adds `X-Hero-Token` itself.
- The menu entry needs a real PNG icon at an absolute URL (/icon.png). Without one, ui.setMenu is accepted but nothing is drawn.

