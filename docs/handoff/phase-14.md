# Phase 14 — IFC import

Status: done
Commit: this commit

## What landed

- `apps/api/src/hero/pipeline/ifcimport.py` reads storeys, wall axes, layer thickness, doors, windows, spaces, columns, stairs, and furnishing. Lengths go through `ifcopenshell.util.unit.calculate_unit_scale` before they are stored in metres.
- `apps/api/src/hero/testkit/writers.py` writes that semantic model, including a millimetre file when `unit_scale_to_meters` is 0.001. Spaces are aggregated under the storey. `IfcSpace` has no `ContainedInStructure`.
- Import of an `.ifc` writes the semantic plan after the cloud, underlay, and preview. `detect_surfaces` is not called.
- A wall with no axis uses the long side of its solid footprint as the centerline and adds `ifc_wall_from_solid`. `IsExternal` true is exterior, false is partition, and a missing flag is interior.
- The mesh reader multiplies `create_shape` vertices by the same unit scale. Non-IFC files still use the mesh pipeline.

## Tests

- Command run: `powershell -File scripts\check.ps1`
- Result: ruff clean, pyright 0 errors, pytest 131 passed, Vitest 44 passed.
- Synthetic IFC: every wall matches within 0.01 m, door width 0.9 m and sill 0, two windows of 1.2 m, space names Living and Kitchen on both storeys, room IoU ≥ 0.95, elevations 0 and 3. A millimetre file comes back with an 8 m wall and thickness 0.25 m or 0.15 m. `fixtures/two_walls.ifc` yields two walls and `ifc_wall_from_solid` (no axis curves; footprints about 5.0 × 0.2 m and 3.0 × 0.2 m). The mesh detector spy is not called.

## Spec changes

- None. `docs/algorithms.md` says a missing axis is a centerline fit on the footprint, not a call to the mesh detector. The phase prompt's "Phase 10 method" is that fit.

## Left open

- IFC export and the AI assistant are later phases.
- `two_walls.ifc` does not carry synthetic room-IoU numbers. The two solids meet at a corner and have no axis.

## Do not redo

- Do not use `create_2pt_wall`'s body as the centerline. The profile sits on one side of p1–p2. The Axis curve is the centerline, and the layer set is the thickness.
- Do not `assign_container` an `IfcSpace`. Aggregate it.
- Do not call `detect_surfaces` for an IFC wall that already has an axis.
