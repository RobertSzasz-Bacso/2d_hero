# Phase 19 — Drawing tools

Status: done
Commit: this commit

## What landed

- `apps/web/src/core/draw.ts`, new operations:
  - `wallFromLocation(p, q, thickness, "center" | "left" | "right")`.
  - `addRectangle(plan, levelId, c1, c2, thickness, "interior" | "centerline")`: counter-clockwise walls, shared vertices merged within `join_snap`, a "Room" seed at the centre unless one is already inside.
  - `placeOpeningAtDistance(plan, levelId, wallId, kind, end, distance, width, swingSide)`: the near edge sits `distance` from the inner corner at `end`. It throws when the opening does not fit between the inner corners.
  - `addDimension(plan, levelId, refs, offset)`: stores `auto: false`.
  - Helpers: `innerCornerOffset`, `addWallFrom`, `pointAtAngle`. `addFixture` takes a rotation.
- `core/snap.ts`: the alignment snap (kind `alignment`) ranks after extension and before angle lock, and returns `guides`.
- `apps/api/src/hero/planops/draw.py` and `snap.py`: the Python ports of the same operations.
- 13 new vectors in `shared/vectors/`: `snap-alignment*.json` (4) and `draw-*.json` (9). `kernel.test.ts` and `test_planops.py` both run them.
- Editor:
  - `tool-math.ts`: ortho lock, length and angle, rectangle corner from typed size, the opening ghost (clamped between inner corners), dimension pick and offset.
  - `draw-actions.ts`:
    - `extendWallTo` keeps a wall chain. With a face location line, each shared corner is the intersection of the offset centerlines, and closing the loop seeds a room.
    - Other placers: `placeRectangle`, `placeOpeningAt`, `placeDimension`, and `placeFixture` with rotation.
  - `ToolOverlay.tsx`: wall poche preview with "length · angle°", rectangle preview, opening ghost with swing and distances to both inner corners, dimension preview, rotated symbol ghost, dashed alignment guides.
  - `CursorInput.tsx`: typing a digit opens the cursor input. It gives length and angle for walls, width and depth for rectangles, and distance for openings. Values are in the display unit. Tab, Enter, and Escape work.
  - `SymbolLibrary.tsx`: thumbnails from `symbols.ts`. Click to arm, or drag onto `plan-stage`. A drop snaps the back to a wall face within `snap_px`.
  - `Toolbar.tsx`: rectangle and dimension tools, thickness presets 10 to 36.5 cm plus custom, the location-line select, and the rectangle-mode select. The sidebar length, angle, and Apply inputs are gone.
  - `store.ts`: `wallThickness`, `wallLocation`, `rectangleMode`, `symbolRotation`. R rotates the armed symbol (`Editor.tsx`).
  - `Shortcuts.tsx`: lists R while placing, typed digits, Tab, Shift, and the arrows.

## Tests

- Commands run: `npx tsc -b --noEmit`, `npx vitest run`, `npx playwright test`, and `powershell -File scripts\check.ps1`.
- Results:
  - Vitest: 106 passed.
  - Playwright: 10 passed. This includes the new `e2e/drawing-tools.spec.ts` (2) and `e2e/drawing.spec.ts`, which now types at the cursor.
  - pytest: 181 passed.
  - `check.ps1` exits 0.
- Measured:
  - Location left, wall (0, 0)–(5, 0) at 0.20 m: centerline at y = −0.10 within 1e-9. Right gives +0.10.
  - Interior rectangle 4.80 × 3.80 m with 0.20 m walls: centerlines 5.00 × 4.00 m, net area 18.24 m² within 0.01.
  - A wall chain drawn counter-clockwise on the 5 × 4 m box gives these net areas:
    - location left: 20.00 m²;
    - centre: 18.24 m²;
    - right: 16.56 m².
  - A door typed at 100 cm: near edge 1.000 m from the inner corner within 1 mm, from either end. A door that does not fit is rejected and the plan is unchanged.
  - A manual dimension v1 → opening start → v2 is stored with `auto: false` and those refs, and it survives reload in Playwright.
  - The Playwright flow:
    - draws 480 × 380 typed, sees `18.2 m²`;
    - places a door at a typed 100;
    - drags a sofa from the library;
    - adds a manual dimension;
    - reloads to an equal plan;
    - exports `Tool plan.pdf`, which starts with `%PDF-`.
- The new vectors and tests were written before the operations. Both harnesses throw on an unknown op, so the vectors were red until the ports landed. The exact output of that first red run was not kept.

## Spec changes

- `docs/architecture.md`, Editor behavior:
  - the cursor input and its display unit;
  - the 0.90 m opening ghost between the inner corners;
  - click or drag in the library;
  - wall-face snap on drop.
- `docs/algorithms.md`:
  - The chain corner rule for a face location line.
  - A double alignment can sit up to √2 · `snap_px` from the cursor.
- `docs/decisions.md`: typed values moved from the sidebar to the cursor.
- The e2e test stubs `window.showSaveFilePicker`. Chromium has it, so `savePdf` takes the picker path, not a download. That is a native file dialog, which the rules allow mocking.

## Left open

- Starting a wall on another wall's midpoint makes a T vertex on that wall without splitting it. This is the same as before Phase 19.
- The opening ghost width is fixed at 0.90 m. Change it after placing with the opening grips or the properties panel.
- The rectangle tool does not split existing walls it crosses. It only merges coincident vertices and skips duplicate walls.

## Do not redo

- In `CursorInput`, do not select the text in a focus effect on first show. React StrictMode runs the effect twice, and the first typed digit is lost ("80" instead of "480"). On first show, put the caret at the end. Select only when the active field changes.
- Do not name a prop `unit` in a file that imports `unit()` from `geom.ts`. Import it as `direction`.
- Do not wait for a `download` event in Playwright for the PDF. Stub `showSaveFilePicker` in `addInitScript`.
