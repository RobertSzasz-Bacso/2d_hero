# Phase 08 — Ingest, normalization, levels

Status: done
Commit: this commit

## What landed

- Readers in `apps/api/src/hero/ingest/` for OBJ, GLB/glTF, PLY, USDZ (pxr), E57, LAS/LAZ chunks, and IFC meshes.
- `apps/api/src/hero/pipeline/` guesses units, voxel-downsamples, orients to Z-up, finds storeys, and writes `cloud.bin` (magic `HEROCLOUD` plus float32 points). Not a JSON point array.
- `apps/api/src/hero/jobs.py` runs ingest, normalize, and levels one at a time in a single worker. Cancel between stages does not write `cloud.bin` or replace `plan.json`.
- Routes: `POST /api/projects/{id}/jobs`, `GET /api/jobs/{id}`, `GET /api/jobs/{id}/events`, `POST /api/jobs/{id}/cancel`. A second job is 409 `A job is already running`.

## Tests

- Command run: `powershell -File scripts\check.ps1`.
- Result: ruff clean, pyright 0 errors, pytest 76 passed, Vitest 44 passed.
- A millimetre building is scale 0.001 with `units_guessed`, and the horizontal span is about 8 m. A 3° tilt recovers up within 1°. Two storeys land within 0.05 m of 0 m and 3 m. Each synthetic format yields more than 10 points. An E57 pose of +10 m is applied. A 5e6-point LAS stays a generator and the downsample peak stayed under 1.5 GB (the test did not skip). Cancel leaves `plan.json` unchanged and writes no `cloud.bin`.

## Spec changes

- None. Installed calls that differ from a casual reading: pye57 `read_scan(..., ignore_missing_fields=True)` or it raises on `cartesianInvalidState`; Open3D `estimate_normals` plus `orient_normals_towards_camera_location` (normals are then flipped outward); pxr and ifcopenshell stubs are incomplete, so those calls go through `cast(Any, ...)`.

## Left open

- Planes for gravity are grouped by an 8° normal bin and a 0.02 m offset on a 0.05 m voxel, then refit by SVD. That is deterministic and matches the synthetic floors. A spatial region-growing walk is still the description in `docs/algorithms.md` for later wall patches.
- No wall detection. Preview GLB and underlays stay in Phase 9.

## Do not redo

- Do not assemble a LAS into one array. `iter_las_chunks` must be callable again for the bbox pass and the voxel pass.
- Sample meshes at 0.05 m in metres. A millimetre file needs a 50-unit step, or the grid allocation explodes.
- A one-bin floor spike is flat after a 3-bin mean. Treat a raw bin that is strictly above its neighbors as a peak when the smoothed bin is at least as high as its neighbors.
- Measure floor coverage as occupied area. The convex hull of a wall-top ring is the whole slab.
- `create_2pt_wall` does not set `Representation` until `assign_representation`.
