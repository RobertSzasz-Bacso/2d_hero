# Plan schema v2

The plan is the only model the editor, the detector, the PDF, and the AI tools share. Pydantic models in `apps/api/src/hero/schema.py` are the source of truth. They export JSON Schema. A script generates `apps/web/src/core/plan-types.ts`. A test fails if a fresh generate would change that file.

Units are metres. `x` increases east in the project frame. `y` increases north before `project.northAngleDeg` is applied as a sheet rotation. Do not store screen pixels.

`schemaVersion` must be `2`. Any other value is an error. There is no migrator.

## Top level

| Field | Type | Rule |
| --- | --- | --- |
| `schemaVersion` | `2` | Required. |
| `units` | `"m"` | Required. |
| `revision` | int ≥ 0 | Bumped by the store on each successful save, not by the client. The client sends it back in `If-Match`. |
| `project` | object | Below. |
| `levels` | array | At least one after a successful import. Empty is valid for a new blank project. |
| `sheet` | object | Below. |
| `detection` | object | Below. Empty issues is valid. |

### `project`

| Field | Type | Default |
| --- | --- | --- |
| `name` | string | `""` |
| `address` | string | `""` |
| `northAngleDeg` | number | `0` |

`northAngleDeg` is the bearing of plan +Y, degrees clockwise from geographic north. `0` means +Y is north.

### `sheet`

| Field | Type | Default |
| --- | --- | --- |
| `paper` | `A4` `A3` `A2` `A1` | `A3` |
| `orientation` | `landscape` `portrait` | `landscape` |
| `scale` | `50` `100` `200` | `50` (meaning 1:50) |
| `titleBlock` | object | See below. |

`titleBlock`: `company`, `project`, `address`, `drawnBy`, `date`, `sheetTitle`, `sheetNumber`, `revisionNote`. All strings, default `""`. The logo is a PNG path in app settings, not a field in the plan.

### `detection`

```json
{
  "source": {
    "filename": "scan.glb",
    "format": "glb",
    "unitScaleToMeters": 1,
    "upAxis": "z",
    "manhattanAngleDeg": 0,
    "linked": false
  },
  "issues": []
}
```

`source` may be `null` on a hand-drawn plan. `format` is one of `obj`, `glb`, `gltf`, `usdz`, `ply`, `e57`, `las`, `laz`, `ifc`, `hand`.

Issue:

| Field | Type |
| --- | --- |
| `id` | string |
| `severity` | `info` `warning` `error` |
| `code` | string, from the list below |
| `message` | short English sentence |
| `levelId` | string or null |
| `elementId` | string or null |

Codes: `gravity_uncertain`, `units_guessed`, `non_manhattan`, `assumed_thickness`, `open_gap`, `uncertain_room`, `room_seed_lost`, `room_not_split`, `low_confidence_opening`, `ifc_wall_from_solid`, `missing_source`.

Do not invent a code without adding it to this list in the same phase.

## Level

| Field | Type |
| --- | --- |
| `id` | id |
| `name` | string |
| `elevation` | metres, finished floor above project zero |
| `ceilingHeight` | metres above the finished floor, must be > 1.5 |
| `vertices` | array |
| `walls` | array |
| `openings` | array |
| `columns` | array |
| `stairs` | array |
| `rooms` | array |
| `separators` | array |
| `fixtures` | array |
| `texts` | array |
| `dimensions` | array |
| `suppressedAutoDimensions` | array of strings | Keys the auto generator must not recreate. |

An id matches `^[A-Za-z][A-Za-z0-9_-]{0,31}$` and is unique among ids of that level. Level ids are unique in the plan.

### Vertex

`{ "id", "x", "y" }` numbers are finite metres.

### Wall

| Field | Type | Rule |
| --- | --- | --- |
| `id` | id | |
| `a`, `b` | vertex ids | Different, both exist. |
| `thickness` | number | > 0 and ≤ 1.5 |
| `kind` | `exterior` `interior` `partition` `assumed` | |
| `confidence` | number | 0 to 1 |

The wall runs from `a` to `b` along the centerline. Thickness is full thickness, centred on that line. Joins are not stored.

### Opening

| Field | Type | Rule |
| --- | --- | --- |
| `id` | id | |
| `wall` | wall id | Exists. |
| `kind` | `door` `window` `passage` | |
| `offset` | number | 0 to 1. Center of the opening along `a` → `b`. |
| `width` | metres | > 0 and less than the wall length. |
| `sill` | metres | ≥ 0, above the level floor. |
| `head` | metres | > sill, ≤ ceilingHeight + 0.05. |
| `swing` | `left` `right` `double` `sliding` `none` | Passages use `none`. |
| `swingSide` | `positive` `negative` | Which side of the directed wall the leaf swings to. |
| `confidence` | number | 0 to 1. |

### Column

`{ "id", "x", "y", "width", "depth", "rotationDeg" }`. Width and depth are full sizes in metres, both > 0. `rotationDeg` is the width axis, degrees counter-clockwise from +X.

### Stair

| Field | Type |
| --- | --- |
| `id` | id |
| `outline` | array of `{x,y}`, at least 3 points, plan footprint |
| `direction` | `{x,y}` unit vector, uphill in plan |
| `riserCount` | int ≥ 1 |
| `fromElevation` | metres relative to the level floor |
| `toElevation` | metres, greater than `fromElevation` |

### Room

`{ "id", "name", "number", "seed": { "x", "y" } }`. The polygon is computed from walls and separators. `name` and `number` are strings and may be empty. The seed is the anchor that keeps the name when walls move.

### Separator

`{ "id", "a", "b" }` vertex ids. A separator splits a room. It has no thickness. It is not a wall.

### Fixture

| Field | Type | Rule |
| --- | --- | --- |
| `id` | id | |
| `symbol` | string | One of the ids in `docs/drawing-standard.md`. |
| `x`, `y` | metres | Insertion point, center of the symbol. |
| `rotationDeg` | number | Counter-clockwise from +X. |
| `width`, `depth` | metres | > 0. |
| `confidence` | number | 0 to 1. Hand-placed symbols use 1. |
| `role` | `fixture` `furniture` | |

### Text

`{ "id", "x", "y", "text", "heightM" }`. `heightM` is the text height in plan metres, > 0. Sheet text size is a drawing concern, not this field.

### Dimension

```json
{
  "id": "d1",
  "auto": true,
  "offset": 0.4,
  "segments": [
    { "a": { "type": "vertex", "id": "v1" }, "b": { "type": "vertex", "id": "v2" } }
  ]
}
```

`offset` is metres, perpendicular to the first segment, signed (positive is to the left of `a` → `b`). A chain is several segments in order, where each `b` equals the next `a`.

A reference is either `{ "type": "vertex", "id" }` or `{ "type": "opening", "id", "edge": "start" | "end" }`. `start` is the edge closer to wall vertex `a`.

`auto: true` means the app may rebuild this chain. A user edit sets `auto` to false. Deleting an automatic chain does not leave an empty dimension. It adds that chain's key to the level's `suppressedAutoDimensions`, and the generator must not recreate a listed key.

Keys are listed in `docs/drawing-standard.md`. Examples: `exterior-south-overall`, `room-r1-width`.

## Validation

Reject the plan when:

- A wall, opening, separator, or dimension references a missing id.
- A wall has `a == b`.
- An opening width is longer than its wall.
- `head <= sill`.
- Two ids in the same level collide.
- A number is NaN or infinite.
- `schemaVersion` is not 2.

## Valid example

```json
{
  "schemaVersion": 2,
  "units": "m",
  "revision": 0,
  "project": { "name": "Example", "address": "", "northAngleDeg": 0 },
  "sheet": {
    "paper": "A3",
    "orientation": "landscape",
    "scale": 50,
    "titleBlock": {
      "company": "",
      "project": "Example",
      "address": "",
      "drawnBy": "",
      "date": "",
      "sheetTitle": "Ground floor",
      "sheetNumber": "01",
      "revisionNote": ""
    }
  },
  "detection": { "source": null, "issues": [] },
  "levels": [
    {
      "id": "L1",
      "name": "Ground floor",
      "elevation": 0,
      "ceilingHeight": 2.7,
      "vertices": [
        { "id": "v1", "x": 0, "y": 0 },
        { "id": "v2", "x": 5, "y": 0 },
        { "id": "v3", "x": 5, "y": 4 },
        { "id": "v4", "x": 0, "y": 4 }
      ],
      "walls": [
        { "id": "w1", "a": "v1", "b": "v2", "thickness": 0.2, "kind": "exterior", "confidence": 1 },
        { "id": "w2", "a": "v2", "b": "v3", "thickness": 0.2, "kind": "exterior", "confidence": 1 },
        { "id": "w3", "a": "v3", "b": "v4", "thickness": 0.2, "kind": "exterior", "confidence": 1 },
        { "id": "w4", "a": "v4", "b": "v1", "thickness": 0.2, "kind": "exterior", "confidence": 1 }
      ],
      "openings": [
        {
          "id": "o1",
          "wall": "w1",
          "kind": "door",
          "offset": 0.5,
          "width": 0.9,
          "sill": 0,
          "head": 2.1,
          "swing": "left",
          "swingSide": "positive",
          "confidence": 1
        }
      ],
      "columns": [],
      "stairs": [],
      "rooms": [
        { "id": "r1", "name": "Room", "number": "01", "seed": { "x": 2.5, "y": 2 } }
      ],
      "separators": [],
      "fixtures": [],
      "texts": [],
      "dimensions": [],
      "suppressedAutoDimensions": []
    }
  ]
}
```

Net room area of this example is (5.00 − 0.20) × (4.00 − 0.20) = 4.80 × 3.80 = 18.24 m². Thickness is centred on the centerline, so each side loses half the wall thickness.

## Invalid examples

These must fail validation:

- A wall `"a": "v9"` when `v9` does not exist.
- `"schemaVersion": 1`.
- An opening with `"head": 1` and `"sill": 1`.
- Two vertices with the same `id`.
