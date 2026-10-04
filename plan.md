# 2D Hero — master plan

2D Hero turns a 3D scan or model into an interactive 2D floor plan. The person reviews it, connects gaps, adds annotations, and exports it. Heavy geometry stays in a local Python backend. The browser is the editor.

We implement one phase at a time. A phase is done when its tests are green, including an end-to-end test when the phase has a screen. Do not start the next phase by widening the current one.

## Research

These are the source papers. Decisions below come from them plus a check of what iPhone scan apps actually export.

- [3D to 2D floor plan app](docs/research/3d-to-2d-floorplan-app.pdf) — ingestion formats, slicing, Clipper2 healing, dual canvas, Cursor SDK versus real vision models, DXF and SVG export.
- [3D floor plan app architecture](docs/research/3d-floor-plan-app-architecture.pdf) — mesh versus point-cloud pipelines, Manifold and Clipper2, parametric wall graph, client versus Windows/Python backend, Cursor SDK as a plan editor.

The Cursor SDK is an agent that edits a plan. It is not the geometry engine. Geometry stays deterministic. The SDK is the “clean this plan” action in every phase that has a plan on screen.

## Decisions that hold for every phase

- One person, one machine. No accounts. Projects are folders on disk. The repo is the package other people install and test.
- Python on Windows, macOS, and Linux. Windows is a supported target, not the only one.
- The plan document is the only model the editor, the AI action, and exporters share:

```json
{
  "units": "m",
  "vertices": [{ "id": "v1", "x": 0, "y": 0 }],
  "walls": [{ "id": "w1", "a": "v1", "b": "v2" }],
  "annotations": [{ "id": "a1", "x": 1, "y": 1, "text": "Kitchen" }]
}
```

- Tests are written failing first. Geometry and API use pytest. Editor behavior uses Vitest. A screen change gets a Playwright test.
- `./scripts/test.sh` on macOS and Linux, `powershell -File scripts/test.ps1` on Windows. No API key required. `CURSOR_API_KEY` is optional.

## Phase 1 — Draft, edit, PDF

Status: implemented in this repo.

In:

- glTF / GLB and OBJ (iPhone meshes; Polycam’s free plan exports glTF only).
- IFC walls from the storey with the most wall area, in meters.
- Horizontal slice, default 1.2 m above the floor, with a height control for meshes.
- Clipper2 closes small gaps. Near-axis walls snap orthogonal.
- Editor: move corners, connect endpoints, delete, text annotations.
- PDF with walls, annotation text, a scale bar, and a title.
- “Clean with AI” sends the plan JSON to the Cursor SDK and accepts the reply only when it matches the schema. Tests use a fake assistant.

Out of this phase: everything in phases 2–7.

## Phase 2 — USDZ from iPhone

Status: implemented in this repo.

Apple’s own export. Add it when a scan app will not give glTF or OBJ.

In: USDZ ingest on the backend, same plan document, same editor and PDF. Fixture and a failing test before the parser.

## Phase 3 — Industrial point clouds

Status: implemented in this repo.

Laser scans, not meshes. The architecture paper puts this on the backend: ground-plane leveling, a horizontal slab, then line extraction.

In: E57 and LAS (PLY point clouds if they come from the same tools). Output is still the plan document. The editor does not change except to show that the draft came from a cloud.

## Phase 4 — Architectural editing

Status: implemented in this repo.

The plan becomes a parametric wall graph, as in the architecture paper.

In: doors and windows hosted on a wall, dimension callouts, room names, live room area from closed cycles. Dragging a corner keeps openings on their wall. PDF shows those symbols and dimensions.

## Phase 5 — CAD export

Status: implemented in this repo.

PDF stays. Add the formats the research papers treat as the professional handoff.

In: layered DXF (walls, doors, windows, annotations) and SVG. Same plan document in, file out. No new editor tools.

## Phase 6 — 3D and 2D together

Status: implemented in this repo.

In: a 3D view of the source model next to the 2D plan. Moving the slice height redraws the plan. Edits in 2D stay on the plan document. The 3D view is for checking the cut, not a second editor.

## Phase 7 — Learned cleanup

Status: implemented in this repo.

Only after phases 1–3 produce a stable draft. RoomFormer, Raster2Seq, or a successor runs on the backend and returns the same plan document. The Cursor SDK remains the language control (“close the gap by the entrance”). The neural model is not a replacement for that action, and it does not bypass the schema check. The checked-in path is deterministic and does not download weights. A local JSON fixture is used only when `HERO_CLEANUP_MODEL` already points at a file.

## Not scheduled

Multi-user hosting, accounts, and a public link. Revisit only after the local package is the product people actually run.
