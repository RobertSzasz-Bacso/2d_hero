# Drawing standard

Metric European construction floor plan. `apps/web/src/drawing/scene.ts` turns a schema v2 plan level into scene items in plan metres. The compiler in `apps/web/src/drawing/compile.ts` maps those items to paper and the PDF writer consumes the result. The editor renders the same scene items as SVG through the camera (see "Screen view"), so the screen and the PDF follow this file.

Standards used for the choices below: ISO 128 (line weights and types), ISO 5457 (sheet frame, simplified), ISO 3098 (lettering), ISO 7200 (title block fields). Dimension style follows common metric architectural practice: centimetres, slash ticks, chains outside the building.

## Sheet

| Paper | Width × height, portrait (mm) |
| --- | --- |
| A4 | 210 × 297 |
| A3 | 297 × 420 |
| A2 | 420 × 594 |
| A1 | 594 × 841 |

Default: A3 landscape, scale 1:50.

Frame: 10 mm margin, 20 mm on the left (binding) edge. Title block sits in the lower right, inside the frame, 180 mm wide and 50 mm tall. Fields, top to bottom, left to right: project, address, sheet title, company, drawn by, date, scale (`1:50`), sheet number, revision note. Empty strings stay blank. They are not filled with placeholders in the PDF.

North arrow: upper right inside the frame, rotated by `project.northAngleDeg`. Scale bar: lower left inside the frame, labelled in metres, length a round number (1 m, 2 m, 5 m, or 10 m) that fits.

If the plan plus dimension chains does not fit in the frame at the chosen scale, the export dialog offers the next smaller scale (50 → 100 → 200) and a tiled set. Tiles overlap by 20 mm on paper and each tile repeats the title block with `sheet number` suffix `a`, `b`, `c`. The user confirms. Do not shrink the drawing to an arbitrary fit.

## Scale

On paper, one metre is `1000 / scale` millimetres. At 1:50, 10.00 m is 200 mm. Line weights are millimetres on paper, independent of the scale.

| Role | Weight (mm) | Pattern |
| --- | --- | --- |
| Cut walls (poche outline) | 0.50 | solid |
| Visible edges: door leaf, window frame, fixtures, stairs | 0.25 | solid |
| Dimension lines, extension lines, hatches, separators | 0.13 | solid |
| Hidden overhead (not used in v1) | 0.13 | dashed |

Text on the sheet, ISO 3098 upright:

| Use | Height (mm) |
| --- | --- |
| Room name | 5 |
| Room area and number | 3.5 |
| Dimensions | 2.5 |
| Title block | 2.5, project name 3.5 |

## Walls

Fill the wall-join polygon solid black (poche, 100%, no transparency). Stroke the outline at 0.50 mm. Cut openings out of the fill so the hole is paper-white.

Do not draw the centerline on the PDF. The editor may show it while a wall is selected.

Separators are a thin dash-dot line, not poche.

## Openings

- **Door.** A gap in the wall of the true width. Leaf is a 0.25 mm line. Swing is a quarter circle at 0.13 mm on `swingSide`. `left` and `right` are the hinge end when walking in the swing direction. `double` is two leaves. `sliding` is a thin rectangle offset to `swingSide`, no arc. `none` draws only the gap.
- **Window.** Wall poche stops at the jambs. Two parallel 0.25 mm lines across the opening (glass). A third center line at 0.13 mm.
- **Passage.** Wall stops. No leaf. No glass.

Sill and head are not drawn on the plan. They appear in the properties panel. A window tag is not required in v1.

## Dimensions

Display unit defaults to centimetres: a length of 4.20 m is the text `420`. Millimetre mode shows `4200`. No unit suffix on the chain. The title block says the unit once: `Dimensions in cm`.

Extension lines start 2 mm on paper from the feature and pass the dimension line by 2 mm. Ticks are slashes at 45°, 2.5 mm long. Text sits above the line, centered, reading from the bottom or the right.

Automatic chains, which the user may delete:

- For each exterior side of the building outline: an overall chain, a chain through the wall vertices, and a chain through the opening edges. Offset them 0.4 m, 0.8 m, and 1.2 m outside the outer face.
- For each room that is within 5° of a rectangle: width and depth inside the room, offset 0.3 m from the faces.

Deleting a chain stores its key in `suppressedAutoDimensions` (see `docs/plan-schema.md`):

- Exterior: `exterior-<side>-overall`, `exterior-<side>-segments`, `exterior-<side>-openings`. `<side>` is `north`, `east`, `south`, or `west` in the plan frame (+Y is north before the sheet's north arrow).
- Room: `room-<roomId>-width` and `room-<roomId>-depth`.

A typed value edits geometry (see `docs/algorithms.md`). It does not only change the text.

## Room tags

Centered on the net room polygon, stacked: name, number, area with one decimal and `m²` (`18.2 m²`). If the name is empty, show `Room`. The tag must not be stored back into the plan as a text element.

## Columns, stairs, fixtures

- Column: solid black poche rectangle or rotated rectangle, 0.50 mm outline, same fill as walls.
- Stair: outline 0.25 mm, an arrow up the run, treads as 0.13 mm lines across the width. Count matches `riserCount` as closely as the length allows. Break line if the stair continues off the level.
- Symbols are 0.25 mm strokes, no downloaded artwork. Insertion point is the center. The symbol is drawn in a unit square from −0.5 to 0.5 on both axes and scales to `width` (local X) and `depth` (local Y). Local +Y is the back of the symbol, the side that goes against a wall.

Symbol ids, and only these. Each part is one polyline. The part count is tested.

| Id | Parts | Drawn as |
| --- | --- | --- |
| `toilet` | 3 | Tank against the back, bowl, seat opening inside the bowl. |
| `sink` | 3 | Counter outline, basin, tap at the back of the basin. |
| `bathtub` | 3 | Outer rim, rounded inner basin, drain. |
| `shower` | 5 | Tray, two diagonals, drain, door swing. |
| `kitchen-counter` | 2 | Counter outline, worktop front edge line. |
| `stove` | 9 | Hob outline, four burners, each with an outer and an inner ring. |
| `bed-double` | 5 | Frame, two pillows at the back, blanket fold line, turned-down corner. |
| `sofa` | 6 | Back, two arms, three seat cushions. |
| `table` | 2 | Top outline, inner edge line. |
| `wardrobe` | 6 | Carcass, hanging rail, four hangers. |
| `block` | 1 | Dashed rectangle. |
| `chair` | 2 | Seat, back rest. Hand-placed only. |

`chair` is not a detector class. It exists so the library can place one.

The editor can hide `role: furniture` without hiding `role: fixture`.

## Screen view

The editor shows the same scene items as the sheet, at the scale in `plan.sheet.scale`, as a print preview that follows the zoom. One paper millimetre is `pixelsPerMeter * scale / 1000` screen pixels.

- Stroke width in pixels: `max(1, weightMm * pixelsPerMeter * scale / 1000)`. At 1:50 and 100 px/m a 0.50 mm cut line is 2.5 px. At 20 px/m a 0.13 mm line clamps to 1 px.
- Text height in pixels: `max(10, heightMm * pixelsPerMeter * scale / 1000)`. At 1:50 and 100 px/m a 5 mm room name is 25 px. At 20 px/m a 2.5 mm dimension clamps to 10 px.
- Poche is solid black, as on paper. A hovered element gets a 2 px blue outline (`#3b82f6`). A selected element is filled and outlined blue (`#1d4ed8`), and a selected wall also shows its dashed centerline.
- Thin elements (door swings, symbol strokes, dimension lines) get an invisible hit stroke `snap_px` wide so they can be clicked.
- Editing overlays are screen-sized and never printed: grips are 9 px squares (ends), 9 px diamonds (wall middle), 9 px triangles pointing outward (wall faces, opening edges), 10 px circles (rotate), and flip arrows 14 px long. Temporary dimensions are blue (`#2563eb`), 12 px text, with the same slash ticks as a printed chain.
- The underlay image stays under the drawing and is not printed.
