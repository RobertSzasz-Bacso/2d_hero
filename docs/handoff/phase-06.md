# Phase 06 — Construction drawing and PDF

Status: done
Commit: this commit

## What landed

- `apps/web/src/drawing/` compiles a plan into paper-space draw commands: frame, title block, wall poche, openings, columns, stairs, symbols, dimensions, and room tags.
- `apps/web/src/pdf/write.ts` writes a vector PDF with pdf-lib. There is no server PDF route.
- The editor PDF button opens a scale dialog (1:50, 1:100, 1:200) and downloads the sheet.
- Golden snapshot `apps/web/src/drawing/golden/two-room.svg`.

## Tests

- Command run: `powershell -File scripts\check.ps1` after Phases 6–8.
- Result: ruff clean, pyright 0 errors, pytest 76 passed, Vitest 44 passed. The drawing file covers the 10.00 m wall at 1:50 (200 mm within 0.5 mm), a 0.50 mm cut stroke, dimension text `420`, the SVG snapshot, and an A3 landscape page with path operators.
- Browser: on the running editor, PDF opened the dialog, reported that the empty plan fits at 1:50, and Download closed the dialog with no error.

## Spec changes

- None.

## Left open

- A plan that does not fit was not clicked in the browser. The compiler still offers the next scale and tiled sheets.

## Do not redo

- Do not name a dimension helper parameter `unit`. That shadows the geometry `unit` function.
- Copy PDF bytes into a new `Uint8Array` before `Blob`. A view over a shared buffer is not a valid blob part here.
- The golden SVG is an exact string match. Regenerate it with `UPDATE_SVG=1` only when the drawing intentionally changes.
