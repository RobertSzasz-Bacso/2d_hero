# 2D Hero

A local app that turns an iPhone scan mesh or an IFC model into an editable 2D floor plan, then a PDF. The spec is [plan.md](plan.md).

The browser is the editor. Slicing, IFC extraction, PDF export, and the optional AI cleanup run in a Python API on the same machine. There are no accounts.

## Phase 1 formats

- **glTF / GLB** and **OBJ** — what iPhone scan apps usually export. Polycam’s free plan exports glTF only.
- **USDZ** — Apple’s package. USDA meshes inside the zip are sliced like any other mesh.
- **E57, LAS, and PLY point clouds** — laser scans. The draft is leveled, sliced, and drawn as walls. A mesh PLY is sliced like any other mesh.
- **IFC** — BIM walls. iPhone apps do not export this.

## Requirements

- Python 3.11 or newer
- Node.js 22 or newer
- [uv](https://docs.astral.sh/uv/) is the easy way to install the Python package. Without it, `pip install -e "apps/api[dev]"` also works.
- On Linux, building `pyclipr` needs a C++ compiler and Python headers (`python3-dev` on Debian/Ubuntu) when a wheel is not available for your platform.

## Install and test

From the repository root:

- macOS and Linux: `./scripts/test.sh`
- Windows: `powershell -File scripts/test.ps1`

That installs locked dependencies, runs the Python tests, the editor unit tests, and the Playwright flow. No API key is required. The fixtures in `fixtures/` are synthetic and are what the tests upload.

## Run the app

```bash
cd apps/api && uv sync --extra dev
cd ../web && npm ci && npm run build
cd ../api && uv run hero
```

Open http://127.0.0.1:8000 . During development you can run the API (`uv run hero` in `apps/api`) and `npm run dev` in `apps/web`, then open http://127.0.0.1:5173 .

Drop a `.glb`, `.gltf`, `.obj`, `.usdz`, `.e57`, `.las`, `.ply`, or `.ifc` file. Drag corners, connect a gap with the Connect tool, place doors and windows, add a measurement or a label, name a room, then export PDF, DXF, or SVG. Closed rooms show their area, and it updates while a corner moves. Mesh and point-cloud files have a slice height, measured in meters above the floor. The default is 1.2. Changing it redraws the plan. A 3D view of the source sits beside the plan so you can see the cut.

## AI cleanup

Clean draft straightens near-axis walls and closes small gaps on this machine. It returns the same plan document and does not download a model. Set `HERO_CLEANUP_MODEL` to a local JSON plan only if you already have a fixture model on disk.

Set `CURSOR_API_KEY` before starting the API if you want the Clean with AI box to call the [Cursor Python SDK](https://cursor.com/docs/sdk/python). Install that extra package yourself (`pip install cursor-sdk`). The test suite uses a fake assistant and does not call Cursor.
