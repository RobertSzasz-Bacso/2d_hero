# Phase 22 - Open a point cloud from Trimble Connect

Status: done. The owner accepted the `check.ps1` failures that were there before this phase (see Left open) and confirmed the picker works live (2026-10-09).
Commit: `Phase 22: Open a point cloud from Trimble Connect` (on main, not pushed)

## What landed

- API, `apps/api/src/hero/download.py`: URL and file-name checks (https only, port 443, host allow-list with no default, no credentials, `ipaddress.is_global`, same-host redirects at most 3), streamed download, `Transfers` registry for progress and cancel, `silence_url_loggers`.
- Routes (hosted only, local mode answers 404): `POST /api/projects/from-url`, `GET /api/transfers/{id}`, `POST /api/transfers/{id}/cancel`. The normal import flow runs after the download.
- `projects.create_from_chunks(..., limit=, trimble_source=)`. The whole project folder is removed on failure or cancel.
- `HostedConfig`: `download_hosts`, `max_download_bytes` (default 2 GiB). Env: `HERO_TRIMBLE_DOWNLOAD_HOSTS`, `HERO_TRIMBLE_MAX_DOWNLOAD_MB`.
- Dependency: `httpx>=0.28.1` (runtime; recorded in `docs/libraries.md` and `docs/decisions.md`).
- Web, `apps/web/src/integrations/trimble/`: `files.ts` (Core API client, token only to `*.connect.trimble.com`), `models.ts`, `TrimblePicker.tsx`, `adapter.ts` (`projectLocation`, `models()`). `App.tsx` takes a `hostedImport` slot. `main.tsx` fills it in hosted mode only.
- Region lookup falls back to the known regional hosts when `/regions` gives nothing usable. The browser console logs host, path and status per Core API call, never the token or a query string.
- Docs: `docs/trimble-connect.md`, `docs/architecture.md`, `docs/libraries.md`, `docs/decisions.md`, `secrets.mdc`.

## Tests

Written first. Red runs were kept: `test_from_url.py` failed on the missing route, `files.test.ts` failed on the missing `files.ts`.

- `pytest tests/test_from_url.py`: 33 passed.
- `vitest run`: 175 passed.
- Playwright `trimble-files.spec.ts`: 4 tests, passed when last run.
- A 5 MB LAS download matches the source SHA-256 and `execute_import` finishes `done`.

## Spec changes

- `docs/trimble-connect.md`, `docs/architecture.md`, `docs/libraries.md`, `docs/decisions.md`, `secrets.mdc` (see above).

## Left open

- `check.ps1` is red, none of it in Phase 22 files (same as Phase 21): 13 pyright errors (`cursor_sdk` not installed), and 3 pytest failures (`test_ifc`, `test_testkit`, `test_samples`).
- `HERO_TRIMBLE_DOWNLOAD_HOSTS` must be set to the real signed-download host before downloads work in a deployment. Check the console for the host of the first real download.
- The Core API response shapes were first confirmed live by the owner; the first attempt failed with "folder not found" until the region fallback was added. The exact cause (the `/regions` response) was not captured.
- Quick tunnel hostnames change on each restart, so the manifest URL in Trimble Connect must be updated.
- Nothing is uploaded to Trimble Connect, and no format is converted.

## Do not redo

- Do not trust `/regions` alone. Keep the known-origin fallback.
- Do not let httpx log request URLs: signed URLs carry a query string. Keep `silence_url_loggers`.
- In Playwright, scope API routes to the app origin. `**/api/**` also swallows the Trimble `/tc/api/` mocks.
- Do not bind `MAX_COPY_BYTES` as a default argument. Resolve it at call time.
