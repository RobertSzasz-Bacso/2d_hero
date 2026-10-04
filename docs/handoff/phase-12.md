# Phase 12 — Openings, columns, stairs

Status: done
Commit: this commit

## What landed

- `apps/api/src/hero/pipeline/openings.py` builds a per-wall elevation image from mesh triangles (cell 0.02 m), closes it, and classifies rectangular voids as doors, windows, or passages.
- Columns are vertical patches whose plan box is 0.15–0.80 m on both sides and whose Z span is at least 1.2 m. Stairs come from a slope whose normal is 20–45° from +Z and whose area is at least 1 m². `riserCount` for a slope with no steps is `round(height / 0.18)`.
- A full-height gap that splits one wall into two collinear faces becomes one spanning wall plus a passage. The mesh detector never sees that hole as an in-wall void.
- The normalized scene keeps mesh vertices and faces so the elevation image is not taken from the 0.05 m voxel cloud.
- `planwrite` writes openings, columns, and stairs onto each level.

## Tests

- Command run: `powershell -File scripts\check.ps1` after phases 12–14 were in the tree together.
- Result: ruff clean, pyright 0 errors, pytest 131 passed, Vitest 44 passed. `tests/test_openings.py` passed on its own before that.
- Clean synthetic openings: precision 1.000, recall 1.000, width error 0.040 m, sill error 0.010 m. Passage near (0, 3.5). Column at (2, 2), not a short wall. Stair footprint IoU ≥ 0.80. A blocked door is kept and emits `low_confidence_opening`.

## Spec changes

- None.

## Left open

- Fixtures and semantic IFC were the next phases.
- The synthetic stair is a ramp added beside the old solid box. The box is still dropped as an assumed island so room detection is unchanged. The test checks footprint IoU, not `riserCount` 16.

## Do not redo

- Do not raster the downsampled cloud at 0.02 m. A voxel is about 0.05 m, so a cell rarely holds two points. Rasterize the wall triangles.
- A morphological close larger than about 0.06 m starts to erase real voids. The 3×3 ellipse at 0.02 m is the close that was used.
- Do not classify a full-height hole wider than a door as a door. Head at the ceiling is a passage.
- A furniture-height box is not a column. Require a Z span of at least 1.2 m.
