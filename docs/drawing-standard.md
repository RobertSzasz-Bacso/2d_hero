# Drawing standard

Metric European construction floor plan. The compiler in `apps/web/src/drawing/` turns a schema v2 plan into draw commands. The PDF writer consumes those commands. The canvas may look lighter, but the PDF follows this file.

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

Fill the wall-join polygon with black at 35% (solid poche). Stroke the outline at 0.50 mm. Cut openings out of the fill so the hole is paper-white.

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

- Column: solid poche rectangle or rotated rectangle, 0.50 mm outline, same fill as walls.
- Stair: outline 0.25 mm, an arrow up the run, treads as 0.13 mm lines across the width. Count matches `riserCount` as closely as the length allows. Break line if the stair continues off the level.
- Symbols are 0.25 mm strokes, no downloaded artwork. Insertion point is the center. The symbol scales to `width` and `depth`.

Symbol ids, and only these:

| Id | Drawn as |
| --- | --- |
| `toilet` | Pan and tank in plan. |
| `sink` | Rectangle with an oval basin. |
| `bathtub` | Rectangle with a drain arc. |
| `shower` | Square with an X and a door swing. |
| `kitchen-counter` | Rectangle. |
| `stove` | Square with four burners. |
| `bed-double` | Rectangle with a pillow band. |
| `sofa` | Rectangle with a back line. |
| `table` | Rectangle. |
| `wardrobe` | Rectangle with a cross. |
| `block` | Dashed rectangle. |
| `chair` | Square with a back arc. Hand-placed only. |

`chair` is not a detector class. It exists so the library can place one.

The editor can hide `role: furniture` without hiding `role: fixture`.
