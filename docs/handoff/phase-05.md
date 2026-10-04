# Phase 05 — Editor drawing tools

Status: done
Commit: this commit

## What landed

- Drawing operations in `apps/web/src/core/draw.ts`: typed walls, openings, swing flip, columns, stairs, text, fixtures, separators, room seeds, copy/paste, split, and merge.
- Automatic exterior and room dimension chains in `apps/web/src/core/dimensions.ts`, including suppression keys from the drawing standard.
- Editor tools on the Phase 4 canvas: wall, door, window, passage, room, separator, column, stair, text, split, symbol library, typed dimensions, copy/paste, and a shortcuts overlay.
- Symbol strokes are code polylines for the ids in `docs/drawing-standard.md`.
- Shared cases `shared/vectors/typed-wall.json` and `shared/vectors/split-merge.json`.

## Tests

- Command run: `powershell -File scripts\check.ps1`, then `npx playwright test` in `apps/web`.
- Result: check passed (ruff, pyright 0, pytest 50 passed, Vitest 40 passed). Playwright 2 passed (`drawing.spec.ts`, `wall-drag.spec.ts`).
- A 5.00 by 4.00 m typed rectangle at 0.20 m thickness shows net area `18.2 m²`. A typed wall of 3.250 m at 90° is within 1 mm. Split then merge restores the wall count.

## Spec changes

- None.

## Left open

- The home screen does not create a blank project by itself. A new drawing starts from an empty plan, including one created by uploading a non-scan file.
- Opening dimension chains use the host wall's vertices. Sheet layout and PDF stay in Phase 6.

## Do not redo

- Do not auto-fit when the first walls are drawn. The drawing test clicks the stage in the default camera (40 px/m, origin 80, 240).
- Do not save on pointer-move. Discrete tool edits still debounce about 400 ms; wait for the saved `plan.json` before asserting a reload.
- Symbol art stays in code. Do not download fixture artwork.
