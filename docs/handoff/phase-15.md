# Phase 15 — AI assistant

Status: done
Commit: this commit

## What landed

- `apps/api/src/hero/mcp` is a stdio MCP server (`python -m hero.mcp <project-dir>`) on `mcp` 2.3 `MCPServer`. Tools call `planops`: `get_plan`, `list_issues`, `set_wall_thickness`, `move_wall`, `set_opening`, `set_room_name`, `apply_ops`. They validate and return errors. They do not write `plan.json`.
- `POST /api/projects/{id}/ai/propose` writes `review/plan.svg` and `review/underlay.png`, then asks an agent. The plan file changes only on `POST .../ai/accept` (one revision). `POST .../ai/reject` drops the ops.
- The real agent is `CursorPlanAgent` in `hero.ai.agent`. It runs only when keyring has a key. It passes that key as `AgentOptions.api_key` and does not read `CURSOR_API_KEY`. Tests inject a fake agent. Playwright uses `--fake-agent` with an in-memory keyring.
- The editor previews the ops, highlights changed walls, and accepts them as one undo step.

## Tests

- Command run: `powershell -File scripts\check.ps1`, then `npx playwright test` in `apps/web`.
- Result: ruff clean, pyright 0 errors, pytest 136 passed, Vitest 45 passed, Playwright 4 passed.
- No network. `cursor_sdk` is not imported by the default test run.

## Spec changes

- `docs/architecture.md`: installed `cursor-sdk` 1.0.35 takes MCP servers on `AgentOptions.mcp_servers` (`StdioMcpServerConfig`). `Agent.create` keyword arguments do not include `mcp_servers`. `mcp` 2.3 uses `MCPServer`, and importing `mcp.server.fastmcp` raises.

## Left open

- A live key was not used. To try one: from `apps/api`, run `uv sync --extra ai`, start the app, save a Cursor user API key in Settings, open a project, and use the Assistant panel. The key stays in Windows Credential Manager. Without the `ai` extra, a stored key returns "The assistant package is not installed." and does not call Cursor.

## Do not redo

- Do not read `CURSOR_API_KEY`. Settings is the only key.
- Do not write `plan.json` from a tool. The proposal is the op list until accept.
- Do not pass `mcp_servers` as a keyword to `Agent.create`. It belongs on `AgentOptions`.
- Do not import `mcp.server.fastmcp`. This install is mcp 2.3.
