# Phase 13 — Fixtures and furniture

Status: done
Commit: this commit

## What landed

- `apps/api/src/hero/pipeline/fixtures.py` drops floors, ceilings, walls, columns, and stairs, then clusters the rest with 0.15 m single linkage.
- An oriented box is classified with the size table. One matching row is confidence 0.8. Two rows use the smaller area distance and confidence 0.5.
- Unmatched clusters at least 0.30 m on one plan axis become symbol `block`, role `furniture`, confidence 0.3. A cluster under 0.30 m on both axes is dropped. A bare apartment stays empty.
- Height includes the horizontal top and the floor voxel just under the storey, and stops short of the ceiling. Hide furniture was already in the editor and still hides `role: furniture` only.

## Tests

- Command run: `powershell -File scripts\check.ps1` after phases 12–14 were in the tree together.
- Result: ruff clean, pyright 0 errors, pytest 131 passed, Vitest 44 passed. `tests/test_fixtures.py` passed (5 tests).
- Bathroom toilet and sink land within 0.25 m of (1.0, 1.0) and (1.2, 5.0). The bed is `bed-double` within 0.25 m of (2.0, 3.6). No fixture sits on a wall. The bare apartment is empty. The 0.5 m cube is `block` / furniture / 0.3.

## Spec changes

- None. The choice for unknown clusters is the one in `docs/algorithms.md`: keep them as `block` at confidence 0.3.

## Left open

- Semantic IFC was the next phase.
- The sink mesh is 0.18 m tall so it sits in the sink row. The old 0.85 m box matched no row.

## Do not redo

- Do not take height from vertical-normal points only. Voxel mixing pulls the top face out of that set, and the toilet then measures about 0.32 m instead of 0.40 m.
- Do not place the bed on the column. The overlap stretched the box to 2.20 × 1.61 and missed `bed-double`.
