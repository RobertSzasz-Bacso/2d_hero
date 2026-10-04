# Phase 04 — Editor canvas

Status: done
Commit: this commit

## What landed

- Konva stage in `apps/web/src/editor/`. Plan Y is flipped only in `apps/web/src/view/camera.ts`.
- Wheel zoom at the cursor, middle-mouse and space-drag pan, Fit, click, shift-toggle, and box selection.
- Properties for thickness, opening width, sill, head, swing, coordinates, fixture rotation, and text.
- Corner drag, parallel wall drag, and opening slide. One undo step per pointer gesture.
- Keyboard undo, redo, delete, fit, and Escape. Autosave on pointer-up and 400 ms after other edits. `If-Match` carries the revision. A 409 reloads and shows `This plan was saved somewhere else. Reloaded.` Status text is Saved, Saving, or Error.
- Playwright loads `apps/web/e2e/two-room.json` through the API. `scripts/e2e-server.ps1` serves that test on ports 8091 and 5191 so a dev server on 8000 and 5173 can stay up. `hero --projects-dir`, `--config-dir`, and `--session-file` keep the test off the real Documents and AppData folders.

## Tests

- Command run: `powershell -File scripts/check.ps1`, then `npx playwright test` in `apps/web`.
- Result: ruff and pyright clean. pytest 50 passed, 1 Starlette deprecation warning about `httpx`. Vitest 34 passed. Playwright 1 passed. `check.ps1` exited 0.
- Camera test: zooming by 2 keeps the plan point under the cursor. North is up on screen.

## Spec changes

- None.

## Left open

- Drawing new walls, dimensions, and symbols are Phase 5.
- pytest may still print one Starlette deprecation warning about `httpx`.

## Do not redo

- Do not import Konva, React, or three from `apps/web/src/core/`.
- Do not save on pointer-move. A drag is one history transaction and one save on pointer-up.
- Immer freezes the plan after `record`. Set the revision by replacing the plan object. Assigning `plan.revision` throws.
- On Windows, `os.replace` can return access denied while a scanner holds `plan.json`. Retry the replace. Do not delete the destination first.
