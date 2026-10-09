# AGENTS.md

Instructions for any coding agent working in this repo. The schedule is `master_plan.md`. The specs are `docs/`. This file is how to work, not what to build.

## What this product is

2D Hero turns a GLB mesh or point cloud into an editable metric floor plan and a scaled PDF. It runs on one Windows PC. The browser is the editor. Python does the heavy geometry.

The code under `apps/` that predates Phase 1 is a prototype. Do not extend it. Phase 1 deletes it.

## Read this first

1. `master_plan.md` — find the first phase whose status is not `done`. That is the only phase you implement.
2. The newest `docs/handoff/phase-NN.md`, if it exists.
3. The docs named in that phase's prompt.
4. The rule files in `.cursor/rules/` that match the files you touch.

`docs/research/` is old background. It does not override `docs/*.md`.

## Repo map

After Phase 1, the tree looks like this. Do not create later-phase folders early.

```text
apps/api/                 Python package `hero` (uv, src layout)
apps/web/                 Vite + React editor
apps/web/src/core/        Pure TypeScript plan kernel (no React, no three)
apps/web/src/drawing/     Plan → draw commands (Phase 6)
apps/web/src/pdf/         pdf-lib writer (Phase 6)
shared/vectors/           JSON cases both kernels must pass (Phase 3+)
docs/                     Specs. These win over comments and over the old code.
samples/user/             Owner's scans. Git-ignored. Tests skip if missing.
samples/public/           Downloaded public scans. Git-ignored.
fixtures/                 Small committed files, including synthetic output
scripts/dev.ps1           API + Vite
scripts/test.ps1          pytest, Vitest, Playwright
scripts/check.ps1         Lint, types, and tests
```

Projects at runtime live in `Documents\2D Hero\`, not in the repo. Settings live in `%APPDATA%\2D Hero`.

## Commands

Use Windows PowerShell. Do not use `&&`. Do not use `./scripts/test.sh`.

```powershell
powershell -File scripts\dev.ps1
powershell -File scripts\test.ps1
powershell -File scripts\check.ps1
powershell -File scripts\test.ps1 -Api
powershell -File scripts\test.ps1 -Web
```

Until Phase 1 has landed, those scripts do not exist. Do not invent a bash substitute. Write the scripts as part of Phase 1.

Python dependencies change only through `apps/api/pyproject.toml` and uv. Frontend dependencies change only through `apps/web/package.json`.

## Test-first loop

1. Write the test named in the phase. Use the real thresholds from `master_plan.md` and `docs/algorithms.md`.
2. Run it. Confirm it fails because the behavior is missing, not because of a typo in the test.
3. Implement the smallest amount that makes that test pass.
4. Run the phase tests, then `scripts/check.ps1`.

Do not delete a test, skip it, or widen a tolerance to go green. If a threshold is impossible, stop and report the measured number. The owner decides.

A test that needs a file in `samples/user/` or `samples/public/` must skip when the file is absent. Skipping is not a failure. A present file that fails the assertion is a failure.

## Definition of done

A phase is done only when all of these are true:

- The phase's tests pass.
- `powershell -File scripts\check.ps1` exits 0.
- `docs/handoff/phase-NN.md` exists and matches `docs/handoff/README.md`.
- The phase line in `master_plan.md` says `done`.
- The work is committed on `main` with message `Phase N: <short title>`.
- Nothing secret is in the commit. `git status` shows no `samples/user`, `samples/public`, or session token.

Do not push. Do not start the next phase in the same session.

## Rules that prevent the last failure

- Implement only the current phase. No stub modules for later phases. No "TODO: real algorithm" that returns a rectangle.
- Verify library APIs in the installed package or the official docs before calling them. Blog snippets and memory are not sources. If `docs/architecture.md` disagrees with the installed Cursor SDK, follow the SDK and update the doc in the same phase.
- Internal coordinates are metres, Z up, right-handed. The 2D plan is X right, Y up. Screen Y is down only inside the view transform.
- Detection tolerances live in one Python module. Editor tolerances live in one TypeScript module. The values are the ones in `docs/algorithms.md`.
- Randomness uses a fixed seed. Do not `np.random` without a generator you pass in.
- Vectorize numeric work. Do not loop Python over millions of points.
- Heavy jobs run one at a time in a process pool. The HTTP handlers stay quick.
- Atomic file writes: write a temp file in the same directory, then `os.replace`.
- The Cursor API key is stored with `keyring` only. Never log it, never return it, never put it in `plan.json` or `.env`.
- PDF is produced in the browser with `pdf-lib`. Do not add a server PDF route.
- Do not add a dependency that is not in `docs/libraries.md` unless you record why in `docs/decisions.md`.

## Windows pitfalls

- PowerShell 5.1 does not support `&&`. Run `powershell -File scripts\test.ps1`.
- Use `pathlib`. Do not hard-code backslashes.
- `os.replace` is the atomic rename. Do not delete the destination first.
- Open3D and trimesh ship Windows wheels. If a wheel fails, paste the error into the handoff and stop. Do not replace them with PDAL, pymeshlab, or a hand-written parser.
- `keyring` talks to Windows Credential Manager. Tests must inject an in-memory backend. Never write a real key from a test.
- Playwright needs Chromium: the test script installs it. Do not switch to Firefox to hide a failure.
- Large point-cloud GLBs must not be expanded into unnecessary copies. Preserve the existing capped/chunked normalization behavior.

## Commits

Commit only at the end of a phase, on `main`, unless the owner asks otherwise. Do not commit generated `node_modules`, `.venv`, `__pycache__`, `apps/web/dist`, or data directories.
