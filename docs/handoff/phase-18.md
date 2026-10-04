# Phase 18 — Direct editing with grips

Status: done
Commit: this commit

## What landed

- `apps/web/src/core/grips.ts`. Operations:
  - `setWallThicknessFromFace`, `setClearDistance`, `setOpeningEdge`, `rehostOpening`.
  - `moveSelection`, `snapRotation`, `snapFixtureToWall`.
  - Read helpers: `wallFrame`, `clearDistance`, `parallelNeighbors`. `parallelNeighbors` feeds the temporary dimensions.
  - The `SelectionKind` type.
- `apps/api/src/hero/planops/grips.py`: the same operations, run against the same shared vectors.
- Nine vectors in `shared/vectors/grip-*.json`. Both harnesses (`kernel.test.ts` and `test_planops.py`) dispatch them.
- `apps/web/src/editor/Grips.tsx`: the SVG grip layer. It draws:
  - Wall grips: `data-grip` values `end-a`, `end-b`, `middle`, `face-left`, `face-right`.
  - Temporary dimensions: `temp-dim-length`, `temp-dim-clear-left`, `temp-dim-clear-right`. Click one to open `temp-dim-input`.
  - Opening grips: `opening-center`, `opening-start`, `opening-end`. Flip controls: `flip-hinge`, `flip-side`.
  - Fixture grips: `fixture-rotate`, `fixture-width`, `fixture-depth`.
  - The snap glyph (`data-snap-kind`).
- `apps/web/src/editor/grip-math.ts`: grip-drag math. `rotationFromGrip` gives 15° steps, free with Shift. `faceDragThickness` keeps the opposite face, or the centerline with Alt.
- `PlanCanvas.tsx`:
  - Grip sessions and move sessions for fixtures, columns, texts, and stairs. One transaction per drag, saved once on pointer-up.
  - A released opening re-hosts onto the wall under the cursor. A released fixture snaps to a wall face.
  - Double-click a room to rename it in place (`room-name-inline`).
  - shadcn `context-menu` with `menu-delete`, `menu-split`, `menu-merge`, `menu-flip-hinge`, `menu-flip-side`. It was added with the CLI.
- `select.ts`: `itemsInBox(plan, levelId, rect, "window" | "crossing")` tests the real shapes. Left to right is window (solid blue). Right to left is crossing (dashed green). It replaces `itemsInPlanRect`.
- `store.ts` `nudge` and the arrow keys in `Editor.tsx`: one grid step, ten with Shift.
- `PlanSvg.tsx`: a selected room shows a dashed outline. The opening hit rect carries `data-hit`.

## Tests

- Commands run: `npx vitest run`, `npx playwright test`, and `powershell -File scripts\check.ps1`.
- Results:
  - Vitest: 84 passed.
  - Playwright: 8 passed, including the new `e2e/grips.spec.ts`.
  - pytest `test_planops.py`: 40 passed.
  - `check.ps1` exits 0.
- Measured on the 5 × 4 m rectangle with 0.20 m walls:
  - Outer-face thickness to 0.30 m keeps the area at 18.24 m².
  - Symmetric thickness gives 18.00 m².
  - A 4.00 m clear width gives 15.20 m², and the moved wall stays orthogonal.
  - Opening edge +0.10 m gives a 1.00 m opening, with the start edge fixed.
  - Re-host keeps 0.90 m. A 4.50 m opening onto a 4.00 m wall is rejected and the input plan is unchanged.
  - `moveSelection` is exact.
  - Rotation snaps to 15°.
- Before the code existed, the first run failed with missing modules (`grips.ts`, `hero.planops.grips`, `itemsInBox`). The Playwright test failed with 0 grips.

## Spec changes

- `docs/architecture.md`: a grip clicked without dragging acts as a click on what lies under it. Otherwise a door at the middle of a selected wall could not be picked.
- The two Python test helpers now read optional expectation keys with `.get()`. `Obj` is a dict, so `getattr(expect, "clear")` returned the `dict.clear` method.

## Left open

- `moveWall` does not move T-junction butts that sit on the moved wall. After a large face drag, a T-joint becomes a plain overlap. The union and the room areas are still right.
- Temporary dimensions only measure walls whose span overlaps the selected wall.

## Do not redo

- Vector inputs must not use dict method names (`items`, `clear`, `keys`) for attribute access in Python. Read them with `["items"]` or `.get(...)`.
- Do not put the opening's flip controls on the swing side. The arc would cover them.
