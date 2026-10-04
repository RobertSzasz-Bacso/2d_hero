# Phase 01 — Foundation reset

Status: done
Commit: this commit

## What landed

- Deleted the prototype application and moved the owner scan to `samples/user/two_social_rooms_in_a_ruined_building.glb` (git-ignored).
- `apps/api`: uv package `hero` on Python 3.12. `uv run hero` binds `127.0.0.1`, writes the session token, serves `apps/web/dist` when that directory exists, and opens the browser. `--no-browser` is for development.
- Token and Host checks. `GET /api/health` is public. Other `/api` routes require `X-Hero-Token`. A foreign `Host` returns 400.
- Placeholder `GET /api/settings` returns `{ "cursorKeySet": false }`.
- `apps/web`: Vite, React 19, TypeScript, Tailwind, shadcn/ui (radix-nova). Empty shell: a button and a health line. The page reads `#t=` once into `sessionStorage` and does not use `localStorage`. The Vite proxy adds `X-Hero-Token` from `apps/api/.session-token`.
- `scripts/dev.ps1`, `scripts/test.ps1`, `scripts/check.ps1`.

## Tests

- Command run: `powershell -File scripts/test.ps1` and `powershell -File scripts/check.ps1`
- Result: pytest 19 passed, 1 Starlette deprecation warning about `httpx`. Vitest 1 passed. `check.ps1` exited 0 (ruff, pyright, pytest, `tsc --noEmit`, Vitest).
- `import hero.geometry` raises `ModuleNotFoundError`.
- Phase 1 wheels imported: `trimesh`, `open3d`, `shapely`, `cv2`, `laspy`, `pye57`, `ifcopenshell`, `keyring`, `pxr`.

## Spec changes

- `docs/decisions.md`: ruff, pyright, the Vite template's oxlint, and the packages `shadcn init` installed. Tests stay on `httpx` because `httpx2` is not on the library list.
- `docs/decisions.md`: `@/*` is mapped without `baseUrl`. TypeScript 6.0 errors on `baseUrl` (`TS5101`). The shadcn Vite page still shows `baseUrl`.
- `README.md` now describes how to start the empty shell.

## Left open

- `GET /api/settings` is a placeholder. It always reports `cursorKeySet: false`. Phase 2 stores the key.
- pytest prints one `StarletteDeprecationWarning` for `httpx`. The suite still passes.
- No Playwright project in this phase, so Chromium was not installed.

## Do not redo

- Do not restore the prototype slicer, USD regex parser, JSON point preview, or text-plan assistant.
- Do not put `baseUrl` back into the web tsconfig under TypeScript 6.
- Do not switch the test client to `httpx2` unless `docs/libraries.md` changes.
- The Windows wheels for Open3D, OpenCV, ifcopenshell, and usd-core installed. Do not replace them.
