# Phase 03 — Editor core

Status: done
Commit: this commit

## What landed

- Pure TypeScript kernel in `apps/web/src/core/`: tolerances, mitered wall polygons, T-junction subtraction, net rooms, domain operations, immer undo, rbush picking, and snapping.
- `shared/vectors/*.json` for rooms, L/T/X/acute joins, 4 cm and 20 cm gaps, `moveWall`, typed dimensions, snap priority, picking, and the plan edits.
- npm dependencies `immer`, `rbush`, and `polygon-clipping`. Core modules do not import React, Konva, or three.

## Tests

- Command run: `powershell -File scripts/check.ps1`
- Result: ruff and pyright clean. pytest 50 passed, 1 Starlette deprecation warning about `httpx`. `tsc --noEmit` clean. Vitest 29 passed. `check.ps1` exited 0.
- Net area of the 5.00 × 4.00 m rectangle, wall thickness 0.20 m: 18.24 m² (4.80 × 3.80). Gross centerline area 20 m² is not used.

## Spec changes

- `docs/algorithms.md`, `docs/plan-schema.md`, `docs/testing.md`, `docs/drawing-standard.md`, and the Phase 3 line in `master_plan.md`: the example net area is 18.24 m². Recorded in `docs/decisions.md`.
- `apps/web/tsconfig.app.json` includes Node types so Vitest can read `shared/vectors/`.

## Left open

- No editor canvas, tools UI, or Python `planops` port. Those are later phases.
- pytest still prints one `StarletteDeprecationWarning` for `httpx`.

## Do not redo

- Do not thicken walls by the full thickness to force 16.56 m². Offset is `thickness / 2`, and the measured hole is 4.80 × 3.80 m.
- Do not import React, Konva, or three from `apps/web/src/core/`.
- Call `enablePatches()` before `produceWithPatches`. Immer 11 does not load the patch plugin otherwise. Assign plan fields on the draft; a root replace patch does not restore the document.
