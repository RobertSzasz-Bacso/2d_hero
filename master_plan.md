# 2D Hero — master plan

2D Hero is a local Windows app. It turns a 3D scan or an IFC model into a metric European construction floor plan, lets one person edit that plan, and prints it to scale as PDF.

The browser is the editor. A Python service on the same machine reads the 3D file and detects the building. There are no accounts and no cloud upload of the model.

This file is the schedule. Specs live in `docs/`. Agent rules live in `AGENTS.md` and `.cursor/rules/`.

## How to run a phase

1. Open a new Cursor chat in this repo.
2. Copy the prompt from the phase whose status is `not started`. Paste it as the whole first message.
3. Do not start a later phase in that chat. One phase, one chat.
4. The phase is done only when its tests pass, `docs/handoff/phase-NN.md` exists, the status below is `done`, and the work is committed on `main`.

Status values: `not started`, `in progress`, `done`.

## Status

- [x] Phase 1 — Foundation reset — `done`
- [x] Phase 2 — Persistence and secure settings — `done`
- [x] Phase 3 — Editor core — `done`
- [ ] Phase 4 — Editor canvas — `not started`
- [ ] Phase 5 — Editor drawing tools — `not started`
- [ ] Phase 6 — Construction drawing and PDF — `not started`
- [ ] Phase 7 — Test kit — `not started`
- [ ] Phase 8 — Ingest, normalization, levels — `not started`
- [ ] Phase 9 — Import UI, underlays, 3D viewer — `not started`
- [ ] Phase 10 — Wall surfaces — `not started`
- [ ] Phase 11 — Wall graph and rooms — `not started`
- [ ] Phase 12 — Openings, columns, stairs — `not started`
- [ ] Phase 13 — Fixtures and furniture — `not started`
- [ ] Phase 14 — IFC import — `not started`
- [ ] Phase 15 — AI assistant — `not started`
- [ ] Phase 16 — Hardening and release — `not started`
- [ ] Phase 17 — Optional machine-learning detectors — `not started`

## Decisions that every phase keeps

These were chosen with the owner. Do not reopen them inside a phase. If one is impossible, stop and say why.

- **Rebuild.** The Python and TypeScript under `apps/` before Phase 1 is the old prototype. Phase 1 deletes it. Do not reuse its slicer, its USD regex parser, its JSON point preview, its random 40k-point RANSAC, or its "AI returns a whole plan as text" path. `fixtures/` and `docs/research/` may stay. `docs/research/` is background only. `docs/*.md` wins when they disagree.
- **One person, one PC, Windows first.** The server binds `127.0.0.1` only. English UI. No accounts, no i18n library, no hosted deploy.
- **Shape.** React + TypeScript + Vite in the browser. FastAPI on Python 3.12. One command starts both for development. A desktop shortcut is Phase 16, not a new stack.
- **Projects** are folders in `Documents\2D Hero\`. Recent projects are a list. App settings live in `%APPDATA%\2D Hero`.
- **The Cursor API key** is typed in Settings and stored in Windows Credential Manager through the `keyring` library. It is never written to the repo, to logs, to `plan.json`, or to an HTTP response. The app works fully with no key.
- **Security.** Every `/api` route except `GET /api/health` requires header `X-Hero-Token`. The token is a process secret. The server rejects a `Host` other than `127.0.0.1` or `localhost`.
- **One plan document, schema v2, meters.** Specified in [docs/plan-schema.md](docs/plan-schema.md). Pydantic is the source of truth. TypeScript types are generated. Walls are a centerline plus a thickness. Rooms are computed from wall geometry and anchored by a seed point. The 2D plan axis is X right, Y up (not screen Y).
- **Detection** is classic geometry, shared by meshes and point clouds, specified in [docs/algorithms.md](docs/algorithms.md). Machine learning is Phase 17 and off unless the owner turns it on.
- **PDF only.** No DXF, DWG, SVG export, or IFC export. SVG is allowed as an internal snapshot for tests and for the AI review image.
- **Drawing standard** is metric European (ISO 128, 5457, 3098, 7200), in [docs/drawing-standard.md](docs/drawing-standard.md). Dimension text defaults to centimetres. Areas are square metres.
- **Libraries** are the allow-list in [docs/libraries.md](docs/libraries.md). Do not add a package that is not listed without a one-line reason in `docs/decisions.md`.
- **Memory.** Target a 16 GB machine. Stream large clouds. Do not load a 100M-point file into one array.
- **Tests first.** Write the test, run it, keep the failure, then implement. Details in [docs/testing.md](docs/testing.md).
- **Git.** At the end of the phase, commit on `main`. Do not push. Do not commit `samples/user/`, `samples/public/`, `.session-token`, or anything under `%APPDATA%`.

## Closing steps (every phase prompt ends with these)

1. Run `powershell -File scripts/check.ps1`. Fix failures. Do not delete a test or loosen an assertion to get green.
2. Write `docs/handoff/phase-NN.md` from the template in `docs/handoff/README.md`.
3. In this file, change that phase's status line to `done` and tick its box.
4. Commit on `main` with message `Phase N: <short title>`. Do not push.

---

## Phase 1 — Foundation reset

**Status:** `done`

**Requires:** nothing.

**Goal:** a clean repo and a running empty app, with the security boundary already real.

**In**

- Delete the old application code listed in the prompt. Move the owner's GLB into `samples/user/` before deleting `apps/api/data/`.
- New `apps/api` (uv, Python 3.12, `.python-version`) and `apps/web` (Vite, React 19, TypeScript, Tailwind, shadcn/ui initialized).
- FastAPI app that binds `127.0.0.1`, serves `apps/web/dist` when it exists, and opens the browser from `uv run hero`.
- Token and Host checks, as in [docs/architecture.md](docs/architecture.md).
- `scripts/dev.ps1`, `scripts/test.ps1`, `scripts/check.ps1`.
- A smoke test that imports every Phase 1 library that has a Windows wheel.

**Out:** plan schema, projects, editor, detection, PDF, AI.

**Tests first**

- `GET /api/health` returns 200 without a token.
- Any other route returns 401 without `X-Hero-Token`, and 400 for a foreign `Host`.
- With the token, a placeholder `GET /api/settings` returns `{ "cursorKeySet": false }` and the body contains no key-shaped string.
- Vitest: the web token helper reads a fragment `#t=` once and does not put it in `localStorage`.
- Import smoke: `trimesh`, `open3d`, `shapely`, `cv2`, `laspy`, `pye57`, `ifcopenshell`, `keyring`, `pxr` (from `usd-core`). If a wheel will not install on this machine, stop and write the exact error in the handoff. Do not swap in an unlisted library.

**Acceptance:** `scripts/test.ps1` exits 0. `import hero.geometry` fails. The GLB is at `samples/user/two_social_rooms_in_a_ruined_building.glb`.

### Prompt

```text
Implement Phase 1 of 2D Hero in C:\prod\2d_hero. One phase only.

Read first: AGENTS.md, master_plan.md (Phase 1 only), docs/architecture.md, docs/libraries.md, docs/testing.md, docs/decisions.md.

The apps/ tree is an old prototype. Delete it after saving the sample:
- If either apps/api/data/80e668fe743e47f9ae32d4a2de47e58e/source.glb or apps/api/data/34bbdf6a440c496c81e492715c538212/source.glb exists, move one copy to samples/user/two_social_rooms_in_a_ruined_building.glb and do not commit that file.
- Delete apps/api/src, apps/api/tests, apps/web/src, apps/web/e2e, apps/web/scripts, and the old root scripts/test.ps1 and scripts/test.sh.
- Do not delete fixtures/, docs/, master_plan.md, AGENTS.md, samples/README.md, or .cursor/.

Rebuild only what Phase 1 lists in master_plan.md. Follow the security and process model in docs/architecture.md. Libraries only from docs/libraries.md. Python 3.12 via uv. Initialize shadcn/ui non-interactively and stop at an empty shell (button plus a health status line). Do not stub projects, the editor, detection, PDF, or AI.

Tests first, as listed under Phase 1. Run each new test and keep the failure before implementing. pytest for the API, Vitest for the token helper.

Then do the closing steps in master_plan.md (check.ps1, docs/handoff/phase-01.md, tick Phase 1, commit on main, do not push). Commit message: "Phase 1: foundation reset".
```

---

## Phase 2 — Persistence and secure settings

**Status:** `done`

**Requires:** Phase 1 done.

**Goal:** projects and settings survive a restart, and the API key can be saved safely.

**In**

- Pydantic schema v2 from [docs/plan-schema.md](docs/plan-schema.md). Export JSON Schema. Generate TypeScript types. A test fails if the generated file drifts.
- Project store: folder per project under `Documents\2D Hero\`, atomic `plan.json` write, integer revision, 409 on conflict, `plan.prev.json`, last 20 snapshots, recent list (drop missing folders).
- Streamed upload for small files (copy into the project). `POST /api/dialogs/open-file` uses a native dialog and can register a path as a linked source instead of copying when the file is over 200 MB.
- Settings store in `%APPDATA%\2D Hero`. Cursor key only through `keyring` (service `2D Hero`, username `cursor_api_key`).
- Settings screen: key field (write-only), remove button, title-block defaults, dimension display unit (cm default, mm optional), grid spacing.

**Out:** editor canvas, detection, PDF, AI calls.

**Tests first**

- Round-trip every schema example in `docs/plan-schema.md`, including the invalid examples, which must be rejected.
- Generated `apps/web/src/core/plan-types.ts` matches the schema export.
- Save, reload, and revision conflict (409) using a temp directory, not the real Documents folder.
- Crash-safe write: a failed replace leaves the previous `plan.json` readable.
- Keyring tests use an in-memory backend injected in the test. `GET /api/settings` never contains the key. Logs captured during save do not contain it.
- Recent list: three projects, delete one folder, list returns two.

**Acceptance:** the Settings screen stores a key and, after restart of the API process, still reports `cursorKeySet: true` while the JSON body stays free of the secret. Use the in-memory backend in tests, not the real Windows vault.

### Prompt

```text
Implement Phase 2 of 2D Hero in C:\prod\2d_hero. One phase only. Do not start Phase 3.

Read first: AGENTS.md, docs/handoff/phase-01.md, master_plan.md (Phase 2), docs/plan-schema.md, docs/architecture.md, docs/libraries.md, docs/testing.md, .cursor/rules/secrets.mdc.

Build the Pydantic schema exactly as docs/plan-schema.md. Generate TypeScript types from the exported JSON Schema into apps/web/src/core/plan-types.ts. Add a test that fails if regeneration would change that file.

Implement the project store and settings store as Phase 2 describes. Use pathlib and os.replace. Tests must use tmp_path and an in-memory keyring backend, never the real Documents folder and never the real Windows Credential Manager.

Settings UI: a write-only Cursor key, a remove control, title-block defaults, dimension display unit, grid spacing. Follow .cursor/rules/secrets.mdc.

Tests first, as listed under Phase 2. Run them and keep the failures before implementing.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-02.md. Commit message: "Phase 2: persistence and secure settings". Do not push.
```

---

## Phase 3 — Editor core

**Status:** `done`

**Requires:** Phase 2 done.

**Goal:** a pure TypeScript kernel that can represent a real plan: thick walls, net rooms, edits, undo, picking, snapping. No canvas yet.

**In**

- `apps/web/src/core/`: tolerances, wall-join polygons, room extraction, domain operations, undo stack, spatial index, snapping.
- Algorithms and numbers from [docs/algorithms.md](docs/algorithms.md) sections "Editor geometry" and "Snapping".
- JSON vectors in `shared/vectors/` for every operation and for the room and join cases. The Python port in Phase 11 must run these same files.

**Out:** Konva, tools UI, PDF, any Python detection.

**Tests first** (Vitest, no DOM)

- A 5.00 m by 4.00 m rectangle, wall thickness 0.20 m, has net room area (5.00 − 0.20) × (4.00 − 0.20) = 18.24 m² within 0.01, and gross centerline area is not used.
- L, T, and X joints produce closed polygons with no spike longer than 3 times the thickness.
- An open gap of 4 cm snaps closed. A gap of 20 cm stays open.
- `moveWall` on a rectangle's south wall by 0.10 m north keeps the east and west walls orthogonal and changes only the depth.
- Undo then redo restores vertex coordinates bitwise for a pure move.
- Snap priority: endpoint beats grid when both are inside tolerance.
- Every file in `shared/vectors/` passes.

**Acceptance:** `npm test` in `apps/web` is green and does not start a browser. Core modules import no `react`, no `konva`, no `three`.

### Prompt

```text
Implement Phase 3 of 2D Hero in C:\prod\2d_hero. One phase only. Do not start Phase 4.

Read first: AGENTS.md, docs/handoff/phase-02.md, master_plan.md (Phase 3), docs/plan-schema.md, docs/algorithms.md (Editor geometry and Snapping), docs/testing.md, .cursor/rules/web-frontend.mdc.

Write a pure TypeScript kernel in apps/web/src/core/. No React, no Konva, no three.js. Wall joins, net rooms, domain ops, immer undo, rbush picking, and snapping must follow docs/algorithms.md. Put numeric tolerances in one module.

Write shared/vectors/*.json first and Vitest tests that load them. Run the tests and keep the failures. Then implement until the Phase 3 cases pass, including the 5.00 by 4.00 m room at 18.24 m² net.

Do not port the kernel to Python in this phase. Do not build UI.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-03.md. Commit message: "Phase 3: editor core". Do not push.
```

---

## Phase 4 — Editor canvas

**Status:** `not started`

**Requires:** Phase 3 done.

**Goal:** the plan can be inspected and edited with the mouse without fighting the tool: zoom, select, drag, properties, autosave.

**In**

- Konva stage. Camera: wheel zoom at the cursor, pan, fit. Y is flipped only in the view transform.
- Selection: click, shift-toggle, box. Properties panel for the selection (thickness, opening width, coordinates).
- Move a corner. Drag a wall parallel. Slide an opening along its wall. Delete.
- Keyboard: undo, redo, delete, fit, tool cancel (Escape).
- Autosave debounced about 400 ms, sends the revision, handles 409 by reloading and showing an error. Status text: Saved / Saving / Error.

**Out:** drawing new walls, dimension editing, symbols, PDF, 3D.

**Tests first**

- Vitest for the camera math: zoom at a cursor keeps that plan point under the cursor.
- Playwright: load a fixed two-room fixture plan (no 3D file), fit, drag a corner, assert the vertex data attribute, undo with the keyboard, drag a wall, assert the opposite wall's length changed and its angle stayed orthogonal.

**Acceptance:** the Playwright flow passes. Dragging does not send an HTTP save per pointer-move; it saves on pointer-up (test with a request counter).

### Prompt

```text
Implement Phase 4 of 2D Hero in C:\prod\2d_hero. One phase only. Do not start Phase 5.

Read first: AGENTS.md, docs/handoff/phase-03.md, master_plan.md (Phase 4), docs/architecture.md (Editor behavior), docs/algorithms.md (Snapping), .cursor/rules/web-frontend.mdc, docs/testing.md.

Build the Konva editor on top of apps/web/src/core/. The core stays free of Konva. View transform: plan Y is up, screen Y is down. Implement zoom-at-cursor, pan, fit, click and box selection, a properties panel, corner drag, parallel wall drag, opening slide, and debounced autosave with revision conflicts.

Write the Vitest camera test and the Playwright flow first. Run them and keep the failures. Use a fixed plan JSON fixture, not a 3D scan. Assert that pointer-move does not call the save endpoint.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-04.md. Commit message: "Phase 4: editor canvas". Do not push.
```

---

## Phase 5 — Editor drawing tools

**Status:** `not started`

**Requires:** Phase 4 done.

**Goal:** a person can draw a plan from scratch and correct a detected one.

**In**

- Wall tool: click points, type length and angle, close a loop, snap as specified.
- Door, window, and passage tools on a wall. Swing flip.
- Automatic dimension chains (see drawing standard). Click a dimension value and type a new one; the geometry moves.
- Room name and number by clicking a room. Room separator line.
- Column, stair run, text label.
- Symbol library (the symbols listed in [docs/drawing-standard.md](docs/drawing-standard.md)): drag into the plan, rotate, scale within the symbol's allowed range.
- Copy, paste, split wall, merge collinear walls.
- Shortcuts overlay.

**Out:** PDF sheets, detection, AI.

**Tests first**

- Core tests: typed wall of 3.250 m at 90° lands on that length within 1 mm. Typing a dimension of 420 cm moves the targeted segment to 4.20 m and leaves the orthogonal neighbor orthogonal.
- Split then merge returns the same wall count.
- Playwright: draw a rectangle with typed lengths, place a door, name the room, see the net area, drop a toilet symbol.

**Acceptance:** a plan built only with tools, never with a 3D file, can contain walls, a door, a named room, a column, a stair, and a fixture, and it reloads from `plan.json` unchanged.

### Prompt

```text
Implement Phase 5 of 2D Hero in C:\prod\2d_hero. One phase only. Do not start Phase 6.

Read first: AGENTS.md, docs/handoff/phase-04.md, master_plan.md (Phase 5), docs/plan-schema.md, docs/algorithms.md (Editor geometry), docs/drawing-standard.md (symbols and dimension behavior, not sheet layout), .cursor/rules/web-frontend.mdc.

Add the drawing tools listed in Phase 5. Domain changes go through apps/web/src/core/ operations, with new shared/vectors cases. Automatic dimensions and typed dimension edits must follow docs/drawing-standard.md. Symbols are the fixed list in that doc, drawn as simple SVG paths in code, not downloaded artwork.

Tests first: core tests for typed length, typed dimension edit, split and merge; then the Playwright rectangle flow. Run them and keep the failures before implementing.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-05.md. Commit message: "Phase 5: editor drawing tools". Do not push.
```

---

## Phase 6 — Construction drawing and PDF

**Status:** `not started`

**Requires:** Phase 5 done.

**Goal:** the sheet looks like a construction floor plan and prints at a true scale.

**In**

- A drawing compiler in `apps/web/src/drawing/` that turns a plan into draw commands: wall poche, joins, openings, dimensions, room tags, columns, stairs, fixtures, north arrow, scale bar.
- Sheet layout from [docs/drawing-standard.md](docs/drawing-standard.md): paper size, scale 1:50 / 1:100 / 1:200, frame, title block from settings.
- PDF via `pdf-lib` in the browser, vector, not a screenshot. If the plan does not fit, offer the next smaller scale or a tiled set of sheets. The user chooses.
- Line weights are millimetres on paper, converted by the scale. Do not use screen pixels as line weights.

**Out:** detection, AI, any server-side PDF.

**Tests first**

- Compiler unit tests: a 10.00 m wall at 1:50 is 200 mm long on the sheet, within 0.5 mm. Cut-wall stroke is 0.50 mm. A dimension of 4.20 m displays as `420`.
- SVG snapshot of a golden two-room plan. Commit the expected SVG.
- PDF test: page media box is A3 landscape, content is vector (more than text operators), the file is not a single embedded raster of the canvas.

**Acceptance:** opening the PDF in a viewer at 100% and measuring the scale bar matches the printed length. The automated stand-in is the 10.00 m → 200 mm test.

### Prompt

```text
Implement Phase 6 of 2D Hero in C:\prod\2d_hero. One phase only. Do not start Phase 7.

Read first: AGENTS.md, docs/handoff/phase-05.md, master_plan.md (Phase 6), docs/drawing-standard.md, .cursor/rules/drawing-standard.mdc, docs/libraries.md.

Build apps/web/src/drawing/ as a pure compiler from a plan to draw commands, and apps/web/src/pdf/ to write a vector PDF with pdf-lib. Follow the sheet, line weights, hatches, symbols, dimension chains, and title block in docs/drawing-standard.md. No server PDF route. No DXF.

Tests first: scale and line-weight unit tests, a committed SVG snapshot, and a PDF media-box test. Run them and keep the failures. The golden plan is a fixture JSON, not a scan.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-06.md. Commit message: "Phase 6: construction drawing and PDF". Do not push.
```

---

## Phase 7 — Test kit

**Status:** `not started`

**Requires:** Phase 6 done.

**Goal:** later detection phases have known buildings, not hand-waved screenshots.

**In**

- A seeded generator in `apps/api/src/hero/testkit/` that builds a multi-room, multi-storey building: thick walls, doors, windows, a column, a stair, a few fixtures, furniture clutter, and a known gravity direction.
- Writers for OBJ, GLB, binary USDZ (via `usd-core`), PLY, LAS, E57, and a minimal IFC. Same building, many files, under `fixtures/synthetic/` for the small default seed. Large clouds are generated in temp during the test, not committed.
- Noise, a tilt, millimetre units, and a missing second wall face, as generator options.
- Metric functions: wall IoU, room IoU, opening precision and recall, thickness MAE, frame angle error. Definitions in [docs/algorithms.md](docs/algorithms.md) "Metrics".
- `scripts/fetch-samples.ps1` downloads the public files named in `samples/README.md` into `samples/public/` and skips files already present. Tests skip a public sample when the file is absent.

**Out:** the detector itself. The generator does not call pipeline code.

**Tests first**

- Same seed, same OBJ bytes twice.
- The default building's ground-truth plan validates against schema v2.
- A 0.25 m wall in the truth has thickness 0.25.
- Metric self-check: the truth compared with itself scores wall IoU 1, room IoU 1, opening recall 1.
- Each writer produces a file that the matching reader in Phase 8 will be able to open. In this phase, assert only that the file exists, is non-trivial, and that OBJ/GLB/PLY load with trimesh. IFC opens with ifcopenshell.

**Acceptance:** `pytest apps/api/tests/test_testkit.py` passes offline. No network in the default test run.

### Prompt

```text
Implement Phase 7 of 2D Hero in C:\prod\2d_hero. One phase only. Do not start Phase 8. Do not implement wall detection.

Read first: AGENTS.md, docs/handoff/phase-06.md, master_plan.md (Phase 7), docs/plan-schema.md, docs/algorithms.md (Metrics), docs/testing.md, samples/README.md, docs/libraries.md.

Add a seeded synthetic-building generator and file writers as Phase 7 describes. Ground truth is a schema v2 plan plus the 3D pose and unit scale. Metric functions must match the definitions in docs/algorithms.md, including the self-comparison test.

Write the tests first, including byte-stable OBJ for a fixed seed. Run them and keep the failures. Commit only the small default-seed fixtures. Do not commit samples/public or large clouds.

Add scripts/fetch-samples.ps1 for the public URLs in samples/README.md. Tests must not call it.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-07.md. Commit message: "Phase 7: test kit". Do not push.
```

---

## Phase 8 — Ingest, normalization, levels

**Status:** `not started`

**Requires:** Phase 7 done.

**Goal:** every supported file becomes a leveled, metric, storey-split point set without filling RAM.

**In**

- Readers: OBJ, GLB/glTF, USDZ (crate and USDA, through `usd-core`, not a regex parser), PLY, E57 (apply the scan pose), LAS/LAZ (chunked), IFC geometry only as a mesh for this phase. Semantic IFC is Phase 14.
- Streaming voxel downsample. Target about 2 million points for the processing cloud. Coarser if the site is large.
- Normals, gravity, Manhattan frame, unit guess, storey split. Algorithms and acceptance numbers are in [docs/algorithms.md](docs/algorithms.md).
- Background job: one heavy job at a time, progress events, cancel between stages. Persist the normalized result in the project folder as a chunked binary, not JSON.

**Out:** wall graph, openings, editor changes, AI.

**Tests first**

- Each small synthetic format loads. A millimetre building is reported as millimetres and converted to metres (a 5 m room is 5 m, not 5000 m).
- A building tilted 3 degrees comes back with up-axis error under 1 degree.
- Two storeys become two levels whose elevations match truth within 0.05 m.
- A streamed LAS of at least 5 million generated points never holds all of them in one array (assert the reader is a generator) and peak Python heap for the downsample stage stays under 1.5 GB. Skip this test if the machine cannot allocate that scratch space, and say so in the handoff.
- Cancel sets the job to cancelled and does not write a plan.

**Acceptance:** the numbers above, on synthetic data, with a fixed seed. No network.

### Prompt

```text
Implement Phase 8 of 2D Hero in C:\prod\2d_hero. One phase only. Do not start Phase 9. Do not detect walls yet.

Read first: AGENTS.md, docs/handoff/phase-07.md, master_plan.md (Phase 8), docs/algorithms.md (Ingest through Storeys), docs/libraries.md, docs/architecture.md (Jobs), .cursor/rules/geometry.mdc, .cursor/rules/python-backend.mdc.

Implement readers and the normalization pipeline exactly in the order and with the tolerances in docs/algorithms.md. USDZ goes through usd-core (pxr). E57 poses must be applied. LAS/LAZ must be chunked. Downsample by streaming voxel hash. Internal frame is Z-up metres.

Jobs: one heavy job, SSE progress, cancel between stages. Store outputs as binary, never as a JSON array of points.

Tests first, using the Phase 7 generator, for units, gravity, storeys, streaming, and cancel. Run them and keep the failures before implementing. Verify every third-party call against the installed package. If Open3D's signature differs from a blog post, use the installed signature or the fallback written in docs/algorithms.md.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-08.md. Commit message: "Phase 8: ingest, normalization, levels". Do not push.
```

---

## Phase 9 — Import UI, underlays, 3D viewer

**Status:** `not started`

**Requires:** Phase 8 done.

**Goal:** the owner can open a real file, see which way is up, and trace over the cut.

**In**

- Import screen: file drop, or a native browse that can link a large file. Show the guessed units and up axis. The user can override both before the job starts. Progress and cancel.
- Underlay images per level: horizontal section of the mesh or the point slab at 1.20 m above that floor, plus a top-down density image. PNG in the project folder. The editor can show, hide, and fade them. They are not geometry.
- Level switcher when there is more than one storey.
- 3D panel, toggleable, react-three-fiber: simplified GLB (under 200k triangles) or a point cap of 500k, the cut plane, and orbit controls. Fit the camera to the model. Do not send the full cloud as JSON.

**Out:** automatic walls, PDF changes, AI.

**Tests first**

- API: underlay PNG for the synthetic box is at least 32×32 and not a single flat color.
- API: preview GLB loads with trimesh and has fewer triangles than the source when the source is denser than the cap.
- Playwright: open the committed synthetic OBJ, see the underlay image, toggle it, see the 3D canvas.

**Acceptance:** the ruined-building GLB in `samples/user/` opens if the file is present. The test skips cleanly when it is absent. A missing file is not a failure.

### Prompt

```text
Implement Phase 9 of 2D Hero in C:\prod\2d_hero. One phase only. Do not start Phase 10. Do not create wall centerlines.

Read first: AGENTS.md, docs/handoff/phase-08.md, master_plan.md (Phase 9), docs/architecture.md (Import and 3D preview), docs/algorithms.md (Underlay), .cursor/rules/web-frontend.mdc.

Build the import flow with an explicit units and up-axis confirmation, job progress, and cancel. Generate per-level underlay PNGs and a decimated preview GLB or capped point cloud. The 3D panel uses react-three-fiber and shows the cut plane. The editor can fade the underlay under the empty plan.

Tests first, as listed under Phase 9, including a skip when samples/user/two_social_rooms_in_a_ruined_building.glb is missing. Run them and keep the failures. Do not put point coordinates in a JSON response.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-09.md. Commit message: "Phase 9: import UI, underlays, 3D viewer". Do not push.
```

---

## Phase 10 — Wall surfaces

**Status:** `not started`

**Requires:** Phase 9 done.

**Goal:** reliable wall faces and thicknesses, including walls seen from one side.

**In**

- The planar-patch, snap, merge, and thickness-pairing stages in [docs/algorithms.md](docs/algorithms.md).
- Output is a list of wall face records on the job result: plane, polygon in 2D, thickness or `assumed`, side count. Not a plan document yet.
- Issues for assumed thickness and for non-Manhattan planes that were not snapped.

**Out:** rooms, openings, editor graph.

**Tests first**

- Clean synthetic floor: every truth wall is found, thickness MAE ≤ 0.02 m, angle error ≤ 1°.
- The same building with one face deleted: that wall is still emitted, `assumed: true`, thickness is the default for its class, and a warning issue exists.
- A 7° off-axis wall snaps to the Manhattan frame. A 20° wall stays diagonal and is not forced.
- Clutter: a sofa-sized box in the room does not become a wall.

**Acceptance:** those four cases, fixed seeds, no hidden tuning inside the test.

### Prompt

```text
Implement Phase 10 of 2D Hero in C:\prod\2d_hero. One phase only. Do not start Phase 11. Do not polygonize rooms.

Read first: AGENTS.md, docs/handoff/phase-09.md, master_plan.md (Phase 10), docs/algorithms.md (Planar patches through Thickness), .cursor/rules/geometry.mdc, docs/libraries.md.

Implement planar patches, dominant-direction snap, coplanar merge, and opposite-face thickness pairing. Use the fallback region grower in docs/algorithms.md if you cannot prove the Open3D call from the installed package. Deterministic seeds and sorted iteration only. No random subsampling as the final answer.

Tests first, on the Phase 7 generator: clean thickness, single-sided assumed wall, 7° versus 20° snap, and clutter rejection. Run them and keep the failures. Record wall IoU and thickness MAE in the test output.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-10.md. Commit message: "Phase 10: wall surfaces". Do not push.
```

---

## Phase 11 — Wall graph and rooms

**Status:** `not started`

**Requires:** Phase 10 done.

**Goal:** the first real path from a scan to an editable plan with correct net rooms.

**In**

- Python port of wall joins and room extraction, passing the same `shared/vectors/` as the TypeScript kernel. Put it in `apps/api/src/hero/planops/`.
- Cell complex, inside/outside labeling, partition walls, topology cleanup, from [docs/algorithms.md](docs/algorithms.md).
- Write schema v2 levels: vertices, walls, room seeds. Openings can wait.
- Quality report on the plan (`detection.issues`) and an issues panel in the editor. Choosing an issue selects the element.

**Out:** doors and windows, fixtures, IFC semantics, AI.

**Tests first**

- `planops` passes every shared vector the TypeScript tests pass, with the stated tolerances.
- Clean synthetic apartment: room IoU ≥ 0.95 against truth, each room's width and depth within 0.02 m, wall IoU ≥ 0.90.
- A gap of one missing short wall: the issue list contains an open-gap or uncertain-room code, and the plan still opens in the editor.
- Noisy generator option: room IoU ≥ 0.85. If this fails, improve the algorithm. Do not lower the clean threshold.

**Acceptance:** importing the default synthetic OBJ produces a plan the Phase 4 editor can open, with the metrics above asserted in pytest.

### Prompt

```text
Implement Phase 11 of 2D Hero in C:\prod\2d_hero. One phase only. Do not start Phase 12.

Read first: AGENTS.md, docs/handoff/phase-10.md, master_plan.md (Phase 11), docs/algorithms.md (Cell complex, Rooms, Metrics), docs/plan-schema.md, shared/vectors/, .cursor/rules/geometry.mdc.

First port wall joins and room extraction to apps/api/src/hero/planops/ and make them pass shared/vectors/ within tolerance. Tests for that port come before any detector work.

Then implement the cell complex and inside/outside labeling and write a schema v2 plan (walls, thicknesses, room seeds, issues). No openings yet. Add an issues panel that selects the related element.

Tests first: the vector port, then clean room IoU ≥ 0.95 and dimensions within 0.02 m, then the gap case and the noisy IoU ≥ 0.85 case. Run them and keep the failures. Do not weaken the clean thresholds.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-11.md. Commit message: "Phase 11: wall graph and rooms". Do not push.
```

---

## Phase 12 — Openings, columns, stairs

**Status:** `not started`

**Requires:** Phase 11 done.

**Goal:** doors, windows, passages, columns, and stairs show up as real elements with measured size.

**In**

- Per-wall elevation images and rectangular void classification, from [docs/algorithms.md](docs/algorithms.md).
- Columns from small vertical footprints. Stairs from step or slope evidence.
- Elements are editable with the Phase 5 tools after import (swing, width, delete).

**Out:** furniture symbols, IFC, AI.

**Tests first**

- Clean synthetic: door and window recall ≥ 0.90, precision ≥ 0.85. Match rule is in the metrics section (center within 0.25 m and width within 0.15 m).
- Width error ≤ 0.05 m and sill height error ≤ 0.05 m on the clean set.
- A full-height hole wider than a door becomes a passage, not a door.
- The column is a column, not a short wall. The stair polygon overlaps truth IoU ≥ 0.80.

**Acceptance:** those metrics on the generator's clean seed. A furnished variant may miss openings that are fully blocked; it must not crash, and it must flag low confidence.

### Prompt

```text
Implement Phase 12 of 2D Hero in C:\prod\2d_hero. One phase only. Do not start Phase 13.

Read first: AGENTS.md, docs/handoff/phase-11.md, master_plan.md (Phase 12), docs/algorithms.md (Openings, Columns, Stairs, Metrics), docs/plan-schema.md, docs/drawing-standard.md (how openings are drawn, so the fields you write are enough).

Detect doors, windows, passages, columns, and stairs as specified. Write them into the plan. Reuse the elevation-image method; do not slice the whole storey with one RANSAC line.

Tests first, on the Phase 7 generator, with the numeric thresholds in Phase 12. Run them and keep the failures. Keep low-confidence openings instead of dropping them silently, and add an issue.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-12.md. Commit message: "Phase 12: openings, columns, stairs". Do not push.
```

---

## Phase 13 — Fixtures and furniture

**Status:** `not started`

**Requires:** Phase 12 done.

**Goal:** fixed fixtures and large furniture become symbol instances the user can delete or move.

**In**

- Cluster the points that are not structure. Fit an oriented box. Classify with the size table in [docs/algorithms.md](docs/algorithms.md). Map the class to a symbol id from the drawing standard.
- Unknown clusters become a generic block with low confidence, or are dropped when smaller than 0.30 m in both plan dimensions. Document the choice in the handoff and test it.
- The user can hide all furniture without hiding sanitary fixtures.

**Out:** learned classifiers, AI naming of rooms.

**Tests first**

- Synthetic bathroom: toilet and sink map to those symbol ids, center error ≤ 0.25 m.
- Synthetic bedroom: bed maps to `bed-double`.
- A wall is not also a fixture.
- Empty clutter (bare apartment) yields an empty fixture list and passes.

**Acceptance:** the four tests, fixed seed. Classification is a function of the box size and height, so the test can state the expected class from the table.

### Prompt

```text
Implement Phase 13 of 2D Hero in C:\prod\2d_hero. One phase only. Do not start Phase 14.

Read first: AGENTS.md, docs/handoff/phase-12.md, master_plan.md (Phase 13), docs/algorithms.md (Fixtures), docs/drawing-standard.md (symbol ids), docs/plan-schema.md.

Cluster non-structural points, fit oriented boxes, and classify them with the size table. Emit fixture records with a symbol id and confidence. Do not download models. Do not add a new symbol id that is not in the drawing standard.

Tests first: bathroom toilet and sink, bedroom bed, no fixture on a bare wall, empty result for a bare apartment. Run them and keep the failures.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-13.md. Commit message: "Phase 13: fixtures and furniture". Do not push.
```

---

## Phase 14 — IFC import

**Status:** `not started`

**Requires:** Phase 13 done.

**Goal:** an IFC model becomes a plan from its own objects, not from a mesh guess.

**In**

- Read storeys, walls (axis and thickness from material layers or from the solid), doors, windows, spaces (room seeds and names), columns, stairs, furnishing.
- Use `ifcopenshell`. Units converted with `calculate_unit_scale`. World coordinates.
- If a wall has no axis, fall back to the Phase 10 method for that element only, and add an issue.
- The mesh pipeline remains for non-IFC files.

**Out:** IFC export, AI.

**Tests first**

- The synthetic IFC from Phase 7: every wall, door, and space name survives, thickness within 0.01 m, room IoU ≥ 0.95.
- A file with two storeys produces two levels.
- An IFC in millimetres is converted to metres.
- `fixtures/two_walls.ifc` if it still loads: it produces two walls and does not throw. If it is a curved or non-standard case, assert behavior and document it instead of forcing the synthetic numbers.

**Acceptance:** semantic fields win over the mesh estimate whenever both exist. A test spies that the mesh wall detector is not called for a wall that has an axis curve.

### Prompt

```text
Implement Phase 14 of 2D Hero in C:\prod\2d_hero. One phase only. Do not start Phase 15.

Read first: AGENTS.md, docs/handoff/phase-13.md, master_plan.md (Phase 14), docs/algorithms.md (IFC), docs/plan-schema.md, docs/libraries.md (ifcopenshell).

Import IFC semantically: storeys, wall axes, layer thickness, doors, windows, spaces as named room seeds, columns, stairs, furnishing. Convert units. Use the mesh fallback only when a wall has no axis, and record an issue. Verify ifcopenshell calls against the installed version.

Tests first: the Phase 7 synthetic IFC (thickness within 0.01 m, room IoU ≥ 0.95, names kept), two storeys, millimetre units, and a test that the mesh detector is not used when an axis exists. Run them and keep the failures.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-14.md. Commit message: "Phase 14: IFC import". Do not push.
```

---

## Phase 15 — AI assistant

**Status:** `not started`

**Requires:** Phase 14 done.

**Goal:** a Cursor agent can propose plan edits the owner accepts or rejects, and the app still works with no key.

**In**

- A local MCP server (Python `mcp` SDK) with tools that call `planops`: read plan, list issues, set thickness, move wall, add or edit an opening, set a room name, apply a batch of those ops. Tools return validation errors. They do not write `plan.json`.
- A local Cursor SDK agent (`cursor-sdk`), model set explicitly, `local` cwd set to the project folder. Read the current SDK docs before coding. The snippets in `docs/architecture.md` are a guide, not a guarantee, if the installed SDK disagrees.
- The agent receives the plan JSON and the review images (underlay plus an SVG of the current drawing). It may only change the plan through the tools.
- The UI shows a preview of the ops (changed geometry highlighted). Accept applies them as one undo step. Reject discards them.
- Missing key: the panel explains how to open Settings. No crash, no cloud agent, no silent env-only path. An env var is not required and is not read if a key is stored. If no key is stored, the feature stays off even if `CURSOR_API_KEY` happens to exist, so tests and the owner's shell cannot leak a key into the app by accident. The Settings key is the only key.

**Out:** Phase 17 models. Free-text JSON plan replacement.

**Tests first**

- A fake agent (no SDK) calls `set_wall_thickness`. The proposal is not saved until accept. Accept changes the plan. Reject leaves it. Undo restores the old thickness.
- A tool call with a bad wall id returns an error payload and does not change the proposal.
- Caplog: the key string never appears. HTTP responses never contain it.
- Playwright with the fake agent: type an instruction, see the preview, accept.

**Acceptance:** the real SDK is behind an interface. The default test run does not import-call the network. A separate manual note in the handoff says how the owner can try a live key.

### Prompt

```text
Implement Phase 15 of 2D Hero in C:\prod\2d_hero. One phase only. Do not start Phase 16.

Read first: AGENTS.md, docs/handoff/phase-14.md, master_plan.md (Phase 15), docs/architecture.md (AI assistant), docs/plan-schema.md, .cursor/rules/secrets.mdc, and the Cursor SDK skill or the official Python SDK docs. If a snippet in docs/architecture.md disagrees with the installed SDK, follow the SDK and update docs/architecture.md in this commit.

Expose plan operations as MCP tools that validate and do not save. Run a local Cursor SDK agent only when a keyring key exists. Ignore CURSOR_API_KEY in the environment. Proposals are previewed, then accepted as one undo step or rejected. Write review images to the project folder and point the agent at those files.

Tests use a fake agent. No network in pytest or Playwright. Tests first, as listed under Phase 15, including the log and HTTP assertions that the secret never leaks. Run them and keep the failures.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-15.md. Commit message: "Phase 15: AI assistant". Do not push. Do not commit a key.
```

---

## Phase 16 — Hardening and release

**Status:** `not started`

**Requires:** Phase 15 done.

**Goal:** the owner's real files are a gate, the app starts from a shortcut, and the written guide matches the UI.

**In**

- Regression tests that run when `samples/user/` or `samples/public/` contains a manifest entry. Skip when absent. For entries with `references` (tape measurements), assert the named length within the stated tolerance (default 0.05 m).
- Failures on real files become algorithm bugs, not ignored diffs. Fix the pipeline or record a single named exception in `docs/decisions.md` with the reason.
- Memory and time notes on the synthetic 5M-point cloud: write the measured figures in the handoff. Budget: downsample stage under 1.5 GB and under 5 minutes on the owner's machine. If the machine is smaller, record the hardware and the actual figure. Do not pretend.
- Clear errors for a bad file, a cancelled job, a missing linked path, and a locked PDF.
- `scripts/install-shortcut.ps1` creates a Desktop shortcut that runs the app and opens the browser.
- Rewrite the user-facing `README.md` as a short guide: install, start, save a key, import, edit, export PDF, where projects live.

**Out:** new feature areas, Phase 17.

**Tests first**

- Skip behavior when `samples/user` is empty.
- A manifest fixture in a temp directory with a synthetic file and a reference length of a known wall passes.
- A missing linked path returns a 400 with a sentence a person can act on, not a stack trace.

**Acceptance:** `scripts/check.ps1` is green. The shortcut script dry-runs in a test (assert the `.lnk` target command) without requiring the Desktop if the test injects a destination folder.

### Prompt

```text
Implement Phase 16 of 2D Hero in C:\prod\2d_hero. One phase only. Do not start Phase 17.

Read first: AGENTS.md, every docs/handoff/phase-*.md, master_plan.md (Phase 16), samples/README.md, docs/testing.md, docs/algorithms.md (Metrics).

Turn real samples into skip-if-missing regression tests. Where a manifest entry has tape-measure references, assert those lengths. Fix real failures in the pipeline instead of lowering the synthetic thresholds from earlier phases.

Add the shortcut installer, friendlier errors, and a user-facing README. Record memory and time for the 5M-point synthetic case in the handoff.

Tests first, as listed under Phase 16. Run them and keep the failures.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-16.md. Commit message: "Phase 16: hardening and release". Do not push.
```

---

## Phase 17 — Optional machine-learning detectors

**Status:** `not started`

**Requires:** Phase 16 done. Do not start this unless the owner asks.

**Goal:** an optional GPU detector can propose walls, without becoming a dependency of the normal install.

**In**

- A separate `apps/api/requirements-ml.txt` and a sidecar process the main app does not import at startup.
- Behind a setting, default off. When off, no ML import and no download.
- Prefer a published model with a licence that allows local use (SpatialLM or a RoomFormer-style checkpoint). Document the licence and the download size in the handoff.
- The model may only emit the same schema v2 plan. Its output passes the same validators. It does not bypass `planops`.
- Run on Windows via a WSL2 or Docker CUDA sidecar if a native wheel is not honest about working. Do not pretend CUDA works.

**Out:** replacing the classic pipeline. The classic result remains the default.

**Tests first**

- With the setting off, the test process does not import `torch`.
- A fixture JSON from the sidecar is rejected when it fails the schema, and accepted when it passes, then measured with the Phase 7 metrics.
- If no GPU is present, the live-model test skips.

**Acceptance:** `scripts/test.ps1` on a machine without PyTorch still passes and does not download weights.

### Prompt

```text
Implement Phase 17 of 2D Hero in C:\prod\2d_hero only if the owner explicitly asked for the optional ML phase. Otherwise stop.

Read first: AGENTS.md, docs/handoff/phase-16.md, master_plan.md (Phase 17), docs/algorithms.md (Metrics), docs/libraries.md, docs/decisions.md.

Add an optional detector sidecar that is off by default and is not imported by the main app. Output must be schema v2 and must go through the normal validators. Document the model licence and download size. Do not remove or bypass the classic pipeline.

Tests first: torch is not imported when the setting is off; invalid sidecar JSON is rejected; GPU tests skip without a GPU. The default test run must pass with no weights downloaded.

Then do the closing steps in master_plan.md. Handoff file: docs/handoff/phase-17.md. Commit message: "Phase 17: optional ML detectors". Do not push.
```
