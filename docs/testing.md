# Testing

Tests describe the contract in `master_plan.md`, `docs/plan-schema.md`, and `docs/algorithms.md`. They are written before the implementation.

## Where tests go

| Kind | Place | Runner |
| --- | --- | --- |
| API, geometry, schema, metrics | `apps/api/tests/` | pytest |
| Editor kernel, drawing compiler, camera | `apps/web/src/**/*.test.ts` | Vitest |
| Clicks, tools, import screen | `apps/web/e2e/` | Playwright, Chromium |

Name a file after the behavior: `test_thickness.py`, `rooms.test.ts`, `wall-drag.spec.ts`.

## How to run

```powershell
powershell -File scripts\test.ps1
powershell -File scripts\test.ps1 -Api
powershell -File scripts\test.ps1 -Web
powershell -File scripts\check.ps1
```

`check.ps1` runs ruff, pyright, `tsc --noEmit`, pytest, and Vitest. Playwright stays in `test.ps1` so a tight loop can skip the browser. The phase is not done until `test.ps1` is green when that phase added an end-to-end test.

From Phase 1 onward, do not call `pytest` or `npm test` with a different working directory than the scripts use, except while debugging a single file:

```powershell
cd apps\api
uv run pytest tests\test_thickness.py -q
```

## Rules

- One assertion group per behavior. Use the threshold from the spec, not a rounded-down copy.
- Geometry comparisons use the tolerance written in `docs/algorithms.md` for that quantity. Do not add `assert abs(a-b) < 1e-9` on a detection result.
- Deterministic seeds only. A test that fails one run in ten is a bug in the test or the code.
- No network in the default run. `scripts/fetch-samples.ps1` is manual.
- No real Windows Credential Manager, no real `Documents\2D Hero`, no native dialog. Inject a temp directory and an in-memory keyring. Stub the dialog with a path the test created.
- Samples: if the manifest path is missing, `pytest.skip` with the path in the message. If the file exists and the metric fails, the test fails.
- Do not snapshot a whole PDF byte string. Assert the media box, that the content stream has vector operators, and the compiler's millimetre lengths.
- SVG snapshots are allowed for the drawing compiler. Commit the expected SVG. Review a diff as a drawing change, not as noise to overwrite blindly.

## Shared vectors

`shared/vectors/*.json` is the contract between `apps/web/src/core/` and `apps/api/src/hero/planops/`.

```json
{
  "name": "rectangle-net-area",
  "op": "rooms",
  "input": { },
  "expect": { "area": 16.56, "areaTolerance": 0.01 }
}
```

`input` is either a plan or an operation plus a plan, matching `docs/plan-schema.md`. TypeScript tests load every file. Python tests load every file from Phase 11. A new operation adds a vector in the same phase that adds the operation.

## Metrics in tests

Print the measured IoU, MAE, and counts when a detection test fails. Pytest's assertion message should include the number:

```python
assert room_iou >= 0.95, f"room IoU {room_iou:.3f} < 0.95"
```

Do not catch the assertion and skip.

## Fixtures

- `fixtures/synthetic/` — small files the Phase 7 generator writes and commits.
- `fixtures/*.obj`, `fixtures/*.ifc`, and the other files already in `fixtures/` — legacy tiny files. New tests prefer the generator. Do not delete a legacy fixture until nothing loads it.
- `samples/user/`, `samples/public/` — never required for the default run.
