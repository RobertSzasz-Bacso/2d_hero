# Phase 23 - Save the PDF to Trimble Connect

Status: in progress. Code and tests are done. Waiting for the owner's live check, and `check.ps1` is red for reasons outside this phase (see Left open).
Commit: not committed yet

## What landed

- Web, `apps/web/src/integrations/trimble/upload.ts`: initiate, send, commit against the Core API with the parent token. Folder listing (folders only), name-clash lookup, numbered names (`Plan (2).pdf`), cancel, fixed error messages, remembered folder per Trimble project (`{ id, name }` only).
- Web, `files.ts`: `entries(folderId | null)` (unfiltered) and `apiOrigin()` added to `FilesClient`.
- Web, `TrimbleSavePanel.tsx`: folder picker, conflict choice (new version or numbered name), stages, success, failure with "Download".
- Web, `src/pdf/target.ts`: `PdfSaveTarget` context. `ExportDialog.tsx` shows "Save to Trimble Connect" and "Download" when a target exists. `main.tsx` provides it in the hosted shell only. The editor and `src/pdf/` import no Trimble code.
- Web, `pdf/save.ts`: a `SecurityError` from the save dialog (iframe) falls back to a normal download.
- API: `PUT /api/projects/{id}/trimble-export` (hosted only), `trimbleExport` in `project.json` and in `GET /api/projects/{id}`. URL-like or token-shaped values are refused with 400.
- Docs: `docs/trimble-connect.md` (Saving the PDF), `docs/architecture.md` (route), `docs/decisions.md` (upload from the browser). No new dependency.
- E2E fixture `trimble-host.html` takes `?app=` to open the extension with a query.

## Tests

Written first. The red runs were kept: `upload.test.ts` failed on the missing module, `test_trimble_export.py` failed with 405 on the missing route.

- `vitest run`: 211 passed (31 new in `upload.test.ts`, 2 new in `save.test.ts`).
- `pytest tests/test_trimble_export.py tests/test_from_url.py tests/test_projects.py`: 70 passed. Whole suite: 294 passed, 4 skipped, 1 failed (`test_ingest.py::test_import_leaves_the_floor_plan_empty`).
- Playwright `trimble-export.spec.ts`: 5 passed (save to a folder, numbered name on a clash, remembered folder, failed upload then Download, local mode makes no Trimble request). `trimble-files` and `trimble-host`: 11 passed.
- Run with a temporary copy of `e2e-server.ps1` that starts the API with `.venv\Scripts\python.exe -m hero`, because `uv run` could not replace `hero.exe` while the owner's server was running. The copy was deleted.

## Spec changes

- `docs/trimble-connect.md`, `docs/architecture.md`, `docs/decisions.md` (see above).

## Left open

- Live check (owner): save a PDF in a real project. Record the token scope result (a 403 means the extension token cannot write), the upload host, the size limit, and what "new version" does when the name exists (version 2, or a second file). The upload flow was read from `trimble-connect-sdk` 4.0.11 source and was not seen live.
- Whether an uncommitted upload can be deleted: the SDK has no call for it. A cancel skips the commit and no file is made.
- `fetch` gives no byte progress. The dialog shows three stages.
- `check.ps1` is red, none of it in Phase 23 files: `test_ingest.py::test_import_leaves_the_floor_plan_empty` (the import now writes one empty level; uncommitted work in `planwrite.py`), 3 pyright errors (`test_from_url.py:66`, and numpy-typing errors elsewhere), and the earlier `cursor_sdk` / `test_ifc` / `test_testkit` / `test_samples` items from phase 21 and 22.
- Existing Playwright specs that create a project from `note.txt` (`drawing.spec.ts`, `drawing-tools.spec.ts`, `grips.spec.ts`, `wall-drag.spec.ts`, `plan-view.spec.ts`) now fail at project creation with "Only GLB files are supported." This is not from Phase 23. `trimble-export.spec.ts` uses `fixtures/synthetic/building.glb`.
- `projects.py` also holds uncommitted changes from other work (`_is_legacy_empty_import_shell`). Commit only the Phase 23 hunks.

## Do not redo

- Do not send the bearer to the signed upload host, and do not log or store the signed URL.
- Do not rely on the API to resolve a name clash. List the folder first.
- Do not add a server PDF route.
- Do not use `uv run` while the owner's server holds `hero.exe`. Use `.venv\Scripts\python.exe -m ...`.
