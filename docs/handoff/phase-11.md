# Phase 11 — Wall graph and rooms

Status: done
Commit: this commit

## What landed

- `apps/api/src/hero/planops/` is a Python port of the TypeScript plan kernel. It passes the same `shared/vectors/` cases. Shapely replaces `polygon-clipping`. `Math.round` is half toward +∞.
- `apps/api/src/hero/pipeline/cells.py` builds the cell complex per storey: drop isolated assumed islands, axis-align walls within 1°, snap ends, split hosts at junctions, polygonize, score floor and ceiling, and keep walls that separate inside from outside via a minimum cut.
- `apps/api/src/hero/pipeline/planwrite.py` writes schema v2 levels (vertices, walls, room seeds) and detection issues. Import calls this after wall surfaces.
- `apps/web/src/editor/IssuesPanel.tsx` lists `plan.detection.issues`. Choosing an issue with an element id selects that element.
- The synthetic builder can cut a full-height gap in the ground west wall (`open_gap=True`).

## Tests

- Command run: `powershell -File scripts\check.ps1`, then `npx playwright test` in `apps/web`.
- Result: ruff clean, pyright 0 errors, pytest 116 passed, Vitest 44 passed, Playwright 3 passed.
- Planops: 29 shared vectors passed. Clean synthetic apartment: room IoU 1.000, wall IoU 1.000, max width or depth error 0.000 m. Noise of 0.01 m: room IoU 0.987. A missing short wall emits `open_gap` and the plan still opens.

## Spec changes

- None. Inside cells are those whose floor score is at least the median of nonempty cells and greater than 0. The spec says “above”; equal room densities both have to count.

## Left open

- Doors, windows, fixtures, IFC semantics, and AI are later phases.
- `assumed_thickness` issues from dropped stair faces have no element id, so the panel cannot select them.
- Playwright covers import, the underlay toggle, the 3D canvas, drawing, and wall drag. It does not click an issue.

## Do not redo

- Snapping an endpoint onto a host is not enough. Shapely `intersects()` is false across a 1e-18 gap. Split the host so both lines share the vertex.
- Axis-align within 1° before joining. Otherwise the partition stops a millimetre short of a tilted south wall and both room seeds share one face.
- Drop a connected component that is entirely assumed and has no exterior face. The stair box splits the kitchen if it stays.
- A dangling column edge does not close a cell. Polygonize drops it. Do not force it into a room.
