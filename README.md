# 2D Hero

2D Hero turns a 3D scan or an IFC model into an editable metric floor plan and a scaled PDF. It runs on this Windows PC. The drawing stays in your Documents folder. Nothing is uploaded.

## Install

Install [uv](https://docs.astral.sh/uv/) and Node.js. In this folder:

```powershell
cd apps\web
npm install
npm run build
cd ..\api
uv sync
```

Create a Desktop shortcut that starts the app and opens the browser:

```powershell
powershell -File scripts\install-shortcut.ps1
```

Double-click **2D Hero** on the Desktop.

To start it without a shortcut, from `apps\api`:

```powershell
uv run hero
```

That serves the built page and opens the browser. For day-to-day work on the code, `powershell -File scripts\dev.ps1` starts the API and the editor at http://127.0.0.1:5173.

## Save a key

The editor works with no key. The assistant needs a Cursor key.

On the home page, under **Settings**, type the key into **Cursor key** and press **Save key**. The key is stored in Windows Credential Manager. It is not written into the project. The page says **A Cursor key is saved.** You can press **Remove key** later.

If the assistant panel says no key is saved, come back to this page and open Settings.

## Import

On the home page, **Import a scan**:

1. Drop a file, or press **Browse** and choose one. OBJ, GLB, USDZ, PLY, E57, LAS, LAZ, and IFC are the formats the app reads. A file it cannot read says: "This file could not be read. Export an OBJ, GLB, USDZ, PLY, E57, LAS, LAZ, or IFC file and try again."
2. Check **Guessed units** and **Guessed up axis**. Change them if the guess is wrong.
3. Press **Start import**.

A file over 200 MB is not copied. Link it with **Browse**. If that file is moved or deleted, the app says which path is missing so you can choose it again.

**Cancel** stops the import between stages. The message is "Import was cancelled. The plan was not changed."

## Edit

When the import finishes, the plan opens. The tools are on the left: Select, Wall, Door, Window, and the others. Press `?` for the shortcut list. The plan saves on its own. **Ctrl+Z** undoes. **Fit** frames the drawing.

## Export PDF

Press **PDF** in the top bar. Choose 1:50, 1:100, or 1:200. If the plan does not fit, use the smaller scale or **Tile sheets**. Press **Download**.

If that PDF is already open in another program, close it and export again. The message is "That PDF is open in another program. Close it, then export again."

## Where projects live

Each project is a folder in `Documents\2D Hero`. The recent list is on the home page.

Title block, dimension units, and grid spacing are in `%APPDATA%\2D Hero`. The Cursor key is not in that folder.

Tape measurements for your own scans go in `samples\user\manifest.json`. See [samples/README.md](samples/README.md). Those files are not part of the app's project folder.

The build schedule for this repository is [master_plan.md](master_plan.md). The allow-list and the packages we refused are in [docs/libraries.md](docs/libraries.md).

## How it is built

One Windows PC. Python 3.12 does the geometry. The browser is the editor and writes the PDF. [uv](https://docs.astral.sh/uv/) installs the API. Node.js builds the page. The API binds `127.0.0.1` only.

### Python

| Library | What it is | Why it is here | Later alternative |
| --- | --- | --- | --- |
| FastAPI, Uvicorn | HTTP server. | Small local API. Handlers stay quick and enqueue the heavy job. | A stdlib HTTP server would work, and would mean writing routing and uploads by hand. |
| python-multipart | Multipart parser. | The import upload is a file in a form. | — |
| Pydantic | Schema models. | `plan.json` v2 is checked here. TypeScript types are generated from the same models. | Hand-written validators. They drift from the editor. |
| NumPy, SciPy | Arrays, SVD, histograms, clustering. | Voxel hashes, plane fits, storey peaks, fixture clusters. The loops stay in arrays. | A pure-Python loop over a large cloud will not fit the memory budget. |
| Shapely | Polygons. | Wall graphs are split and polygonized. Room scores and IoU use the same faces. | CGAL. The Windows build is the reason it is not here. |
| NetworkX | Graphs. | Inside and outside rooms are a minimum cut on the cell graph. | A small cut written for this one graph. NetworkX is already tested. |
| Trimesh | Mesh loader. | OBJ, GLB, and PLY. Also decimation for the 3D preview and the section for the underlay. | PyMeshLab. Its Windows wheels have been unreliable. |
| Open3D | Point-cloud tools. | Normals, and plane patches only when the installed call matches the docs. | The region grower in `docs/algorithms.md` is already the default, because it is deterministic. |
| usd-core (`pxr`) | USD reader. | iPhone USDZ, including crate files. Transforms and metres-per-unit come from the stage. | A regex over USDA. That misses crate files and was the old prototype's bug. |
| pye57 | E57 reader. | Terrestrial scans. Each scan pose is applied. | A partial E57 parser. Poses would be easy to drop. |
| laspy, lazrs | LAS and LAZ. | Chunked reads. A large cloud is never one array. | PDAL. The Windows build is painful, so it is refused. |
| IfcOpenShell | IFC toolkit. | Storeys, wall axes, doors, windows, and space names. Units go through its scale helper. | Tessellating the IFC and guessing walls. Semantic fields are the point of this path. |
| OpenCV (headless) | Image ops. | Elevation rasters for doors and windows. A small close fills scan holes. | scikit-image, if a step is clearer there. Pillow is not a morphology library. |
| Pillow | PNG writer. | Underlay images in the project folder. | OpenCV can write PNG too. Pillow is the small tool for that file. |
| keyring | OS secret store. | The Cursor key goes to Windows Credential Manager. | An env var or a field in `settings.json`. Both leak into logs and into the project. |
| platformdirs | OS folders. | Projects in Documents, settings in `%APPDATA%`. | Hard-coded paths. They break when the Windows profile is not the usual one. |
| sse-starlette | Server-sent events. | Import progress in the page while the worker runs. | Polling `job.json`. It works, and it is slower to show a cancel. |
| mcp | Tool server. | The assistant may call plan operations. The tools do not save the file. | Pasting a whole new plan JSON back from the model. That can wipe the drawing. |
| cursor-sdk | Local Cursor agent. | Optional extra. Used only when a key is saved. Tests use a fake and do not install it. | Any other chat API. It would be a second key and a second trust boundary. |
| pytest, httpx | API tests. | Routes, jobs, and the schema. httpx calls the app in-process. | — |
| Ruff, Pyright | Lint and types. | `scripts/check.ps1` runs both. | Flake8 and mypy. The check script would have to change with them. |

### Browser

| Library | What it is | Why it is here | Later alternative |
| --- | --- | --- | --- |
| React, Vite, TypeScript | UI and build. | The editor is a local page. Vite proxies `/api` in development. | A desktop shell such as Tauri. The decision is to stay a browser plus a shortcut. |
| Tailwind, shadcn/ui | Layout and controls. | One look for Settings, the import screen, and the editor. The CLI also brought Radix, `class-variance-authority`, `cn`, Lucide icons, the Geist font, and `tw-animate-css`. | A second component kit. The rule is to keep this one. |
| SVG in React (no library) | 2D plan view. | Draws the same scene as the PDF: black walls, door swings, symbols. Each element is its own hit shape. Plan Y stays up. Screen Y flips only in the camera. | Konva, used up to Phase 16. It drew placeholder graphics behind floating HTML buttons. |
| three.js, React Three Fiber, drei | 3D panel. | Orbit a decimated GLB or a capped point cloud, with the cut plane. | A hand-written WebGL view. More code for the same fit-and-orbit. |
| Immer | Immutable patches. | Undo and redo, capped at 100. Accepting an assistant proposal is one step. | Storing a full copy of the plan on every edit. |
| rbush | Spatial index. | Click and box selection without scanning every wall. | A grid. RBush already matches the snap tolerances. |
| polygon-clipping | Polygon booleans. | Wall thickness joins and the net room face. | Shapely in the browser. The kernel must stay free of Python. |
| pdf-lib | PDF writer. | Vector sheets at 1:50, 1:100, or 1:200, in the browser. | jsPDF, or ReportLab and WeasyPrint on the server. There is no PDF route on purpose. |
| Zustand | UI state. | Tool, selection chrome, panels. The plan history stays in the kernel. | React context for the same flags. |
| Vitest, Playwright, oxlint | Tests and lint. | Kernel tests do not open a browser. Playwright runs the editor. | Cypress. The scripts install Chromium for Playwright. |

## What would make it more reliable

These are not built. The classic pipeline stays the default either way.

- **Resume a dead import from `cloud.bin`.** Today a crash marks the job interrupted and the next run reads the scan again. A large LAS should continue from the last finished stage.
- **Queue the second job.** A second import is refused while one is running. A queue of one, still a single worker, would keep the request instead of making the owner start again.
- **Notice a changed link.** A missing linked file is already an error. A file that stayed at the same path but changed size or time should ask before the old plan is trusted.
- **One running app.** Two Desktop shortcuts can open two processes on different ports and write one project folder. A single-instance lock would send the second launch to the window that is already open.
- **Fall back when `plan.json` is unreadable.** `plan.prev.json` and the revision snapshots exist. Startup should load the previous good plan and say so when the current file fails the schema.
- **Disagreement, not a second plan.** The optional Phase 20 detector, still not started, should file issues where it differs from the classic walls. It should not replace them.
- **Record stage time and voxel size on the job.** A slow or huge site is then visible in `job.json` without a profiler.
- **Tape check inside the project.** Samples already assert known lengths when a manifest is present. A length the owner types on a wall, checked again after edits, would catch a bad drag on a real job.
- **Rebuild a stale underlay.** The PNG is not geometry. If the level elevation changes, the image should be written again so the trace matches the cut.
