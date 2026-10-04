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

The build schedule for this repository is [master_plan.md](master_plan.md).
