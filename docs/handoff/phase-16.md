# Phase 16 — Hardening and release

Status: done
Commit: this commit

## What landed

- `hero.samples.check_samples` reads a manifest and skips when that file, or every listed scan, is missing. A present file with no tape references must open. A `levels` count and each `references` length are asserted. Default tolerance is 0.05 m. A length is the collinear run, so a wall split at a junction still counts as one tape measurement.
- Unreadable files, a cancelled import, and a missing linked path return a sentence. A locked PDF says to close the other program and export again.
- `scripts/install-shortcut.ps1` writes a shortcut that runs `uv run hero` from `apps/api` and opens the browser. `-Destination` can be a folder other than the Desktop.
- `README.md` is the user guide: install, start, save a key, import, edit, export PDF, and where projects live.

## Tests

- Command run: `powershell -File scripts\check.ps1`
- Result: ruff clean, pyright 0 errors, pytest 146 passed, 1 skipped, Vitest 47 passed.
- Synthetic manifest: south external wall 8.00 m within 0.05 m, two storeys.
- 5 million point LAS, `normalize_scene` on this machine (AMD Ryzen 5 7600X, 31.1 GB RAM): tracemalloc peak 0.136 GB, 49.5 s. Both are inside the 1.5 GB and 5 minute budget.

## Spec changes

- None. The missing-link sentence stays `The linked file is missing: <path>`.

## Left open

- `samples/public/Duplex_A_20110907.ifc` is missing, so that regression skipped.
- `samples/user/manifest.json` is not present. The example manifest was used. `samples/user/two_social_rooms_in_a_ruined_building.glb` is present and opened. It has no tape references, so the test does not assert a length.
- No named exception was added to `docs/decisions.md`.

## Do not redo

- Do not lower the 0.05 m tape tolerance, or the synthetic IoU and MAE thresholds from earlier phases.
- Do not fail the suite when a sample file is absent. Skip with the path in the message.
- Do not measure a tape length as a single graph edge. The synthetic south wall is split where the partition meets it, and the run is still 8 m.
