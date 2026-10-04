# Phase handoff

At the end of a phase, write `docs/handoff/phase-NN.md` using this template. Keep it short. The next chat reads it before touching code.

```markdown
# Phase NN — title

Status: done
Commit: <git hash after you commit, or "this commit">

## What landed

- Bullet list of modules and commands that now exist.

## Tests

- Command run:
- Result: pass/fail counts.
- Metrics, if this phase measured any (IoU, MAE, memory, time).

## Spec changes

- None.
- Or: which doc changed, and why the installed library disagreed.

## Left open

- Bugs you did not fix, with the measured number.
- Samples you could not run because the file was missing.

## Do not redo

- A short list of approaches that failed, so the next phase does not repeat them.
```

Rules:

- Do not paste API keys, tokens, or absolute paths under the owner's home folder beyond `Documents\2D Hero` and `%APPDATA%\2D Hero`.
- If you skipped a sample, say which path was missing.
- If a threshold was not met, this phase is not done. Do not write `Status: done` while `check.ps1` is red.
