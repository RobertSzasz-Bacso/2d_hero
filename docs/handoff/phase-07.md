# Phase 07 — Test kit

Status: done
Commit: this commit

## What landed

- `apps/api/src/hero/testkit/` builds a seeded two-storey apartment and writes OBJ, GLB, USDZ, PLY, LAS, E57, and a one-wall IFC.
- Metric functions follow `docs/algorithms.md`: wall IoU, room IoU, opening recall, thickness MAE, frame angle.
- `scripts/fetch-samples.ps1` downloads the public Duplex IFC when it is missing. Tests do not call it.
- Default-seed files live in `fixtures/synthetic/`.

## Tests

- Command run: `powershell -File scripts\check.ps1` after Phases 6–8.
- Result: pytest 76 passed, including 13 test-kit tests. The same seed writes the same OBJ bytes twice and matches `fixtures/synthetic/building.obj`. Truth against itself is wall IoU 1, room IoU 1, opening recall 1, thickness MAE 0. A 0.25 m wall is present. OBJ, GLB, and PLY load with trimesh. The IFC opens and contains an IfcWall.

## Spec changes

- None. `create_2pt_wall` in ifcopenshell 0.9 returns a shape representation and does not attach it. The writer calls `assign_representation` after it.

## Left open

- The IFC fixture is the south wall only. Semantic import of the whole building is Phase 14.
- E57 bytes are not stable. The library writes a random GUID.

## Do not redo

- Do not treat a corner touch as a shared centerline. Thickness pairing needs an overlap of at least 0.2 m.
- Import `ifcopenshell.api` submodules before use. They are not loaded lazily.
- Keep OBJ text as `%.6f` and `\n`. Changing vertex order changes the committed fixture.
- Wall ids must not reuse vertex ids on the same level.
