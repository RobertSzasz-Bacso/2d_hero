# Phase 10 — Wall surfaces

Status: done
Commit: this commit

## What landed

- `apps/api/src/hero/pipeline/surfaces.py` grows planar patches, snaps them, merges them, and pairs a thickness. Output is wall face records (plane, 2D segment, thickness or assumed, side count), not a plan.
- One-sided faces use the class default: 0.30 m on the hull, 0.15 m inside. The centerline is offset from the seen face by half that thickness along the normal.
- Off-axis walls that were not snapped record a `non_manhattan` issue. Assumed thickness records `assumed_thickness`.
- Manhattan alignment uses the mean angle inside the winning 1° histogram bin, then folds that angle into (−90°, 90°].

## Tests

- Command run: `uv run pytest tests/test_surfaces.py` and, at the end of Phases 9–11, `powershell -File scripts\check.ps1`.
- Result: 4 surface tests passed. The session check was ruff clean, pyright 0 errors, pytest 116 passed, Vitest 44 passed.
- Clean synthetic floor: wall IoU 0.866, thickness MAE 0.000 m, max angle error 0.000°. Every truth wall was found. A deleted face is still emitted, `assumed` is true, and the thickness is the class default. 7° snaps to Manhattan. 20° stays diagonal. A sofa does not become a wall.

## Spec changes

- None. Region growing is the deterministic plane detector: curvature from the smallest eigenvalue of a 30-neighbor covariance, then a grow within 8° and 0.02 m.

## Left open

- Faces are not yet a wall graph or rooms. That is Phase 11.
- The stair still emits `assumed_thickness` warnings. The graph drops that island later.

## Do not redo

- Do not pair “nearest face within 0.60 m” in one direction. The stair stole the south wall. Each face must be the other’s best partner, overlap first, then distance.
- Do not test “both sides of the slab” out to 0.5 m. The slab overhang marked exteriors as partitions. Count hits only between thickness/2 + 0.05 m and 0.5 m.
- Do not use the histogram bin midpoint. Bin [0°, 1°) is centered at 0.5°, so axis-aligned walls were rotated. Use the mean of the angles in the winning bin.
- Do not leave a peak near 180°. That flips the plan into negative coordinates. Fold into (−90°, 90°].
- Exact line intersection misses collinear walls a fraction of a millimetre apart. The overlap check buffers by at least 1e-6 m. A missing face is about 0.20 m off the truth centerline, so that test uses a 0.20 m gap.
