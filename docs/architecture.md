# Architecture

2D Hero is one FastAPI process and one React app on the same Windows PC. The process binds `127.0.0.1` only. It does not upload the model anywhere.

`docs/plan-schema.md` is the data contract. `docs/algorithms.md` is the geometry contract. This file is the process, the HTTP API, and the editor behavior.

## Processes

- **Production:** `uv run hero` from `apps/api`. Serves `apps/web/dist` and the API on one port (8000, or the next free port). Opens the browser.
- **Development:** `powershell -File scripts\dev.ps1` starts the API and Vite. Vite proxies `/api` to the API.

The API process owns files, jobs, the keyring, and the native file dialog. The browser owns the canvas, undo, and the PDF.

## Security

On startup the API creates a token with `secrets.token_urlsafe(32)`.

- It writes the token to `%APPDATA%\2D Hero\session.token` and to `apps/api/.session-token`. Both are git-ignored. `.session-token` exists so the Vite proxy can read it.
- The launcher opens `http://127.0.0.1:<port>/#t=<token>`. The SPA reads the fragment once, stores it in `sessionStorage`, and removes it from the URL. It sends `X-Hero-Token` on every API call.
- In development the Vite proxy reads `.session-token` and sets the same header, so the browser does not have to.
- Every `/api` route except `GET /api/health` returns 401 when the header is missing or wrong.
- If the `Host` header is not `127.0.0.1` or `localhost` (with or without the port), return 400.
- CORS allows only `http://127.0.0.1:5173` and `http://localhost:5173`.

The Cursor API key is not this token. See `.cursor/rules/secrets.mdc`.

## Project files

Resolve folders with `platformdirs`, then pin the Windows result:

- Projects: `Path(user_documents_dir()) / "2D Hero" / <project-id>`. On Windows that is `Documents\2D Hero\<project-id>`.
- Settings, recent list, and `session.token`: `Path(user_config_dir("2D Hero", appauthor=False, roaming=True))`. On Windows that is `%APPDATA%\2D Hero`. Do not use `user_data_dir`. That path is Local AppData, and it is the wrong folder.

Root of one project:

```text
project.json       name, createdAt, sourceFileName, linkedPath or null
source.<ext>       copied source, absent when linked
plan.json          schema v2
plan.prev.json     previous good plan
revisions/         up to 20 older plan snapshots
underlay/          PNG per level (Phase 9)
preview.glb        or preview.pts (Phase 9)
review/            PNG and SVG for the AI (Phase 15)
```

`project-id` is a UUID hex. `project.json` uses UTF-8. Plan writes use a temp file and `os.replace`.

`%APPDATA%\2D Hero\recent.json` lists at most 10 project folders, newest first. Drop entries whose folder is gone.

`%APPDATA%\2D Hero\settings.json` holds title-block defaults, dimension display unit (`cm` or `mm`), and grid spacing in metres. It does not hold the API key.

A linked source is used when the file is larger than 200 MB, or when the user chooses link. The path must exist at job time. If it does not, return 400 with the sentence `The linked file is missing: <path>`.

## HTTP

| Method | Path | Role |
| --- | --- | --- |
| GET | `/api/health` | `{ "ok": true }`. No token. |
| GET | `/api/settings` | Settings plus `cursorKeySet`. Never the key. |
| PUT | `/api/settings` | Title block, display unit, grid. |
| PUT | `/api/settings/cursor-key` | Body `{ "key": "..." }`. Store in keyring. Response `{ "cursorKeySet": true }`. |
| DELETE | `/api/settings/cursor-key` | Remove the key. |
| GET | `/api/projects` | Recent projects. |
| POST | `/api/projects` | Multipart file, or JSON `{ "linkPath": "..." }`. |
| POST | `/api/dialogs/open-file` | Native file dialog. Returns `{ "path": "..." }`. |
| GET | `/api/projects/{id}` | Meta, revision, level summaries. Not the point cloud. |
| GET | `/api/projects/{id}/plan` | The plan JSON. |
| PUT | `/api/projects/{id}/plan` | Body is the plan. Header `If-Match: <revision>`. Mismatch → 409 and the current plan. |
| POST | `/api/projects/{id}/jobs` | Body `{ "kind": "import", "units": "m" or "mm" or "auto", "upAxis": "auto" or "x" or "y" or "z" }`. |
| GET | `/api/jobs/{id}` | State, stage name, progress 0–100, error sentence. |
| GET | `/api/jobs/{id}/events` | SSE progress. |
| POST | `/api/jobs/{id}/cancel` | Cancel between stages. |
| GET | `/api/projects/{id}/underlay/{levelId}.png` | Phase 9. |
| GET | `/api/projects/{id}/preview` | GLB or binary points. Never a JSON array of coordinates. |
| POST | `/api/projects/{id}/ai/propose` | Phase 15. Body `{ "instruction": "..." }`. Returns ops, not a saved plan. |
| POST | `/api/projects/{id}/ai/accept` | Apply the last proposal as one revision. |
| POST | `/api/projects/{id}/ai/reject` | Drop it. |

Unknown routes return 404 JSON `{ "detail": "..." }`. Uncaught exceptions return 500 with a short sentence, not a traceback, after the traceback has been written to the log without secrets.

There is no PDF route.

## Jobs

- A single process-wide lock: one heavy job at a time. A second request gets 409 `A job is already running`.
- The job runs in a `ProcessPoolExecutor` with one worker. Stages check a cancel flag at their boundary.
- Progress is in-memory and mirrored to `job.json` in the project so a refresh can show it.
- Stages in order, for a scan: ingest, normalize, levels, wall surfaces, wall graph, openings, fixtures. Each phase implements only the stages that exist so far. A later phase adds a stage. It does not rerun a finished stage's tests with weaker numbers.
- The HTTP layer never waits on the worker except to enqueue.

## Import and 3D preview

The import screen shows the guessed units and up axis before the job starts. The user can override both. `auto` runs the guess in `docs/algorithms.md`.

Preview mesh: decimate to at most 200_000 triangles, write `preview.glb`. Point preview: at most 500_000 points, float32 XYZ, little-endian, with a 16-byte header `HEROPTS` plus `uint32` count. The 3D panel uses react-three-fiber, fits the camera to the bounds, and draws the cut plane at 1.20 m above the active floor. The panel can be hidden.

Underlays are images. They are never converted into walls by the editor.

## Editor behavior

The kernel in `apps/web/src/core/` is the only place that changes a plan. The canvas calls it. See `docs/algorithms.md` for joins, rooms, snapping, `moveWall`, and typed dimensions.

- Tools: select, wall, door, window, passage, dimension, room, text, column, stair, symbol, split. Escape returns to select.
- Selection: click the topmost hit, shift toggles, drag on empty space box-selects. The properties panel edits thickness, opening width, sill, head, swing, fixture rotation, and text.
- Drag a corner with the select tool. Drag a wall body parallel to itself. Drag an opening along its wall. Snapping applies on move.
- Wheel zooms at the cursor. Middle mouse or space-drag pans. Fit (F) frames the plan.
- Undo (Ctrl+Z) and redo (Ctrl+Y) use the immer patch stack, cap 100. Accepting an AI proposal is one undo step.
- Autosave: 400 ms after a change, and immediately on pointer-up. No save during pointer-move. `If-Match` carries the revision. 409 replaces the local plan with the server plan and shows `This plan was saved somewhere else. Reloaded.`
- Room labels and areas are computed. They are not stored as polygons.

## AI assistant

Phase 15 only. The feature is off when keyring has no key. Do not read `CURSOR_API_KEY`.

The app starts a local stdio MCP server (`python -m hero.mcp`) that wraps `planops`:

- `get_plan`
- `list_issues`
- `set_wall_thickness`
- `move_wall`
- `set_opening`
- `set_room_name`
- `apply_ops` (a list of the ops above)

Tools validate against the schema and return errors as tool results. They must not write `plan.json`.

The agent is a **local** Cursor SDK agent whose cwd is the project folder. `cursor-sdk` 1.0.35 puts inline MCP servers on `AgentOptions.mcp_servers`, not on the keyword arguments of `Agent.create`. The model is `composer-2.5`. `tools` is `read` and `mcp`, so the built-in edit tools are not offered. The API key is the `api_key` field. It is not an environment variable and it is not passed to the MCP process.

```python
import sys

from cursor_sdk import Agent, AgentOptions, LocalAgentOptions, StdioMcpServerConfig

with Agent.create(
    AgentOptions(
        model="composer-2.5",
        api_key=key,
        local=LocalAgentOptions(cwd=project_dir),
        mcp_servers={
            "hero": StdioMcpServerConfig(
                command=sys.executable,
                args=["-m", "hero.mcp", str(project_dir)],
                cwd=project_dir,
            )
        },
        tools=["read", "mcp"],
    )
) as agent:
    run = agent.send(prompt)
    result = run.wait()
```

`mcp` 2.3 names the server class `MCPServer` (`mcp.server.mcpserver`). The old `FastMCP` import raises. The server reads the project directory from its first argument.

The prompt tells the agent to change the plan only through tools, and points it at `review/underlay.png` and `review/plan.svg`. The proposal sent to the browser is the list of ops. The UI highlights the difference. Accept applies them through the same core operations as a mouse edit. Reject drops the list.

Tests use a fake agent behind the same interface. The default test run does not open a socket to Cursor.

## What not to copy from the prototype

The pre-Phase-1 code sliced one plane and called the segments walls, parsed USD with regular expressions, sent preview coordinates as JSON, subsampled clouds at random, and asked a model to return a whole plan as text. None of that is a fallback.
