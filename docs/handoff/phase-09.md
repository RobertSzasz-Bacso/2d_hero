# Phase 09 — Import UI, underlays, 3D viewer

Status: done
Commit: this commit

## What landed

- Import screen in `apps/web/src/editor/ImportPanel.tsx`: drop or browse, guessed units and up axis, progress, and cancel. Large files can be linked.
- Underlay PNGs in `apps/api/src/hero/pipeline/underlay.py`: a section 1.20 m above the floor and a top-down density image, 0.02 m per pixel. The editor shows, hides, and fades them. A level switcher appears when there is more than one storey.
- Preview in `apps/api/src/hero/pipeline/preview.py`: Open3D quadric decimation to 200k triangles, then a GLB. Point clouds use a 16-byte `HEROPTS` header and a 500k cap. The 3D panel is `apps/web/src/editor/View3D.tsx`.
- Empty storey shells in `apps/api/src/hero/pipeline/shells.py` so the editor can switch levels before walls exist.
- Routes for guess, underlay frames and PNG, and preview. `pillow` is the image writer. `scipy` and `networkx` are in the same lock because the next two phases landed in this session.

## Tests

- Command run: `powershell -File scripts\check.ps1`, then `npx playwright test` in `apps/web`.
- Result: ruff clean, pyright 0 errors, pytest 116 passed, Vitest 44 passed, Playwright 3 passed. Those counts include Phases 10 and 11, which were checked in the same session.
- The synthetic underlay is at least 32×32 and is not one flat colour. A mesh over the triangle cap loads in trimesh with fewer faces. `samples/user/two_social_rooms_in_a_ruined_building.glb` was present and opened.

## Spec changes

- None. `trimesh` `export(file_type="glb")` is the runtime call; the stub requires `file_obj`, so the call is cast. Decimation is Open3D `simplify_quadric_decimation(target_number_of_triangles=200_000)` because `trimesh.simplify_quadric_decimation` imports `fast-simplification`, which is not in `docs/libraries.md`.

## Left open

- Wall faces and rooms are Phases 10 and 11. This commit still writes empty shells.

## Do not redo

- Do not put point coordinates in JSON. The cloud is `HEROCLOUD`; the point preview is `HEROPTS`.
- Do not add `fast-simplification` to decimate. Open3D decimates and trimesh writes the GLB.
