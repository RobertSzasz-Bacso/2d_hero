# Phase 02 — Persistence and secure settings

Status: done
Commit: this commit

## What landed

- Pydantic plan schema v2 in `apps/api/src/hero/schema.py`. It exports JSON Schema. `apps/web/src/core/plan-types.ts` is generated from that schema, and a test fails if a fresh generate would change the file.
- Project folders, atomic `plan.json` writes, integer revisions, 409 with the current plan, `plan.prev.json`, and the last 20 snapshots.
- Recent list in the config directory, capped at 10, dropping folders that are gone.
- Streamed copy for uploads at or under 200 MB. Larger uploads are rejected. `POST /api/projects` with `linkPath` registers a link and does not copy. `POST /api/dialogs/open-file` uses the native dialog; tests inject the path.
- Settings in `settings.json`: title-block defaults, dimension unit (`cm` or `mm`), grid spacing in metres (default 1). The Cursor key is only in keyring, service `2D Hero`, username `cursor_api_key`.
- Settings screen: write-only key, remove control, title-block defaults, dimension unit, and grid spacing.

## Tests

- Command run: `powershell -File scripts/check.ps1`
- Result: ruff and pyright clean. pytest 50 passed, 1 Starlette deprecation warning about `httpx`. `tsc --noEmit` clean. Vitest 1 passed. `check.ps1` exited 0.
- Project tests use `tmp_path`. Key tests inject `MemoryKeyring` and never call Windows Credential Manager.

## Spec changes

- `docs/decisions.md`: default grid spacing is 1 m. TypeScript types are rendered in `hero.plan_types` because `json-schema-to-typescript` is not on the library list.

## Left open

- pytest still prints one `StarletteDeprecationWarning` for `httpx`. The suite passes.
- The native file dialog is covered by an injected path. A real window was not opened.
- Import screen, editor canvas, detection, PDF, and AI calls are later phases.

## Do not redo

- Do not point tests at `Documents\2D Hero` or the real Windows Credential Manager.
- Do not log the Cursor key, return it, or store it in `settings.json` or `plan.json`.
- Do not add a TypeScript code generator package for the plan types.
