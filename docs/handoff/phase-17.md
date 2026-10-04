# Phase 17 — Architectural plan view

Status: done
Commit: this commit

## What landed

- `apps/web/src/drawing/scene.ts`: a pure builder from a plan level to scene items in plan metres. Each item has its element, role, part, and weight. The PDF compiler (`compile.ts`) and the editor both draw from it.
- Solid black poche in the editor, the SVG snapshot, and the PDF. The 0.35 fill alpha is gone from `svg.ts` and `pdf/write.ts`.
- `apps/web/src/view/screen.ts`: the paper-millimetre to pixel conversion for line weights and text sizes, per the drawing standard's "Screen view" section.
- `apps/web/src/editor/PlanSvg.tsx`: the SVG plan view. Each element carries its own hit shape and data attributes:
  - Walls: `path[data-wall-id]` with `data-thickness`, `data-length`, `data-angle`, `data-ai-changed`, `data-selected`, `data-hover`.
  - Openings: `g[data-opening-id]` with `data-offset` and `data-swing-side`. Its strokes carry `data-role` (`leaf`, `swing`, `glass`, …).
  - Fixtures: `g[data-fixture-id][data-symbol]`.
  - Also `data-column-id`, `data-stair-id`, `data-separator-id`, `data-text-id`, and `data-dimension-id`.
  - Room tags: `g[data-room-id]`, whose area text has `data-testid="room-area"`.
  - Vertices: `circle[data-vertex-id]` with `data-x` and `data-y`.
  - Hover outlines in #3b82f6. Selection outlines in #1d4ed8, with a dashed centerline on walls. AI preview walls are orange.
- `PlanCanvas.tsx` hosts the view. The Konva stage and the HTML button overlay are deleted. Placing tools send every hit to `placeAt`. A dimension value opens an inline input (`data-testid="dimension-input"`).
- `symbols.ts`: the 12 symbols are redrawn with the part counts in `docs/drawing-standard.md`. The ids are unchanged.
- `konva` and `react-konva` are removed from `package.json`. `docs/libraries.md`, `README.md`, `AGENTS.md`, and `.cursor/rules/web-frontend.mdc` now describe the SVG view.
- Wall joints where three or more ends meet now pass through the joint point, in `core/wall-polygons.ts` and `planops/polygons.py`. See Spec changes.

## Tests

- Commands run: `powershell -File scripts\check.ps1` and `npx playwright test` in `apps/web`.
- Results:
  - Ruff and Pyright: clean.
  - pytest: 159 passed, including `test_planops.py` with 31 vectors.
  - Vitest: 69 passed in 11 files.
  - Playwright: 7 passed.
- New tests:
  - `view/screen.test.ts`: the four weight numbers.
  - `drawing/scene.test.ts`: swing radius, window lines, poche area minus openings within 0.001 m², cut weights, room tags.
  - `editor/symbols.test.ts`: the unit square and the part counts.
  - `e2e/plan-view.spec.ts`.
  - `shared/vectors/rooms-three-way-joint.json`: both rooms at 18.24 m².
- Changed tests:
  - `drawing.test.ts`: added checks that the output has no `fill-opacity` and no `/ca 0.35`.
  - `wall-drag.spec.ts`: grabs `path[data-wall-id="wSouth"]` at 25 % of its length, because the middle of that wall is the T-junction vertex `vMS`.
  - No assertion was loosened.

## Spec changes

- `docs/algorithms.md`, Wall polygons: where three or more wall ends meet, each polygon passes through the joint. Before this fix, two collinear walls plus a partition left a triangular hole at the joint. The union of the golden two-room plan then had no free faces (`room_seed_lost`). The editor and the Phase 6 golden SVG drew no room tags, and the wall had a white notch.
- The golden SVG `drawing/golden/two-room.svg` was regenerated. It changed in three ways: the solid fill, the extra joint points, and the two room tags that now appear. This is recorded in `docs/decisions.md`.
- `master_plan.md` Phase 17 lists the new vector and the reason the golden changed.

## Left open

- `PlanSvg` maps each point through `planToScreen` instead of using one SVG group transform. Line weights, dashes, and hit strokes therefore stay in screen pixels. The Y flip is still only in `view/camera.ts`.
- Room faces are picked through the background click (`pickAt`). The tag text itself has no pointer events.
- Fixtures still only select on click. Moving them is Phase 18.

## Do not redo

- Do not put hit targets in HTML on top of the plan. Each SVG shape is its own target.
- `[data-wall-id="…"]` must match exactly one element per wall. Playwright reads attributes in strict mode. The hover and selection outlines carry no id.
