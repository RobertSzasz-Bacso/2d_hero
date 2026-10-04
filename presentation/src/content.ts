export type Status = "implemented" | "planned";

export type Payload = {
  input: string;
  transform: string;
  output: string;
};

export type ArchNode = {
  id: string;
  kicker: string;
  title: string;
  detail: string;
  status: Status;
  x: number;
  y: number;
  /** Stage indexes (0–4) where this node is on the critical path. */
  stages: number[];
  payload: Payload;
};

export type ArchEdge = {
  from: string;
  to: string;
  label?: string;
  status: Status;
};

export type Stage = {
  id: string;
  short: string;
  title: string;
  eyebrow: string;
  diagramTitle: string;
  diagramNote: string;
  summary: string;
  purpose: string;
  challenges: { title: string; body: string }[];
  decisions: { title: string; body: string }[];
  statusNotes: { status: Status; text: string }[];
  graph: "system" | "engine";
  flow: string[];
  flowPlanned?: string[];
};

const planOut = `{
  "schemaVersion": 2,
  "units": "m",
  "revision": 3,
  "project": { "name": "Apartment", "northAngleDeg": 0 },
  "levels": [{
    "id": "L1",
    "name": "Ground",
    "elevation": 0,
    "ceilingHeight": 2.7,
    "walls": [{
      "id": "w1", "a": "v1", "b": "v2",
      "thickness": 0.2, "kind": "exterior", "confidence": 1
    }],
    "rooms": [{
      "id": "r1", "name": "Living", "number": "01",
      "seed": { "x": 2.4, "y": 1.9 }
    }]
  }],
  "detection": { "issues": [] }
}`;

export const systemNodes: ArchNode[] = [
  {
    id: "source",
    kicker: "Disk",
    title: "Scan or IFC",
    detail: "OBJ, GLB, USDZ, PLY, E57, LAS, LAZ, IFC",
    status: "implemented",
    x: 12,
    y: 18,
    stages: [0, 1, 3],
    payload: {
      input: `{
  "path": "Documents/2D Hero/<id>/source.las",
  "or": { "linkedPath": "D:/scans/site.e57" },
  "linkWhen": "file > 200 MB, or the user chooses link"
}`,
      transform: `Readers yield a RawScene in the file's own units and axis.
trimesh (OBJ, GLB, PLY), pxr (USDZ), pye57 (every scan pose),
laspy chunk_iterator (never one array), ifcopenshell (IFC).
Span > 200 → millimetres. 50 < span ≤ 200 → centimetres. Else metres.`,
      output: `{
  "format": "las",
  "unitScaleToMeters": 0.001,
  "upAxisGuess": "z",
  "issue": "units_guessed"
}`,
    },
  },
  {
    id: "gate",
    kicker: "Security",
    title: "Localhost gate",
    detail: "Host check, then X-Hero-Token",
    status: "implemented",
    x: 31,
    y: 18,
    stages: [0, 1, 3],
    payload: {
      input: `GET /api/health                         → no token
GET /api/projects  Host: example.com    → 400
GET /api/projects                       → 401
GET /api/projects  X-Hero-Token: <ok>   → 200`,
      transform: `Startup: secrets.token_urlsafe(32).
Written to %APPDATA%/2D Hero/session.token and apps/api/.session-token.
The launcher opens /#t=<token>. The SPA reads the fragment once into
sessionStorage and strips it from the URL. It is not stored in localStorage.
Bind is 127.0.0.1 only. CORS is the Vite dev origins only.`,
      output: `{
  "health": { "ok": true },
  "foreignHost": 400,
  "missingToken": 401,
  "settingsBody": { "cursorKeySet": true }
}`,
    },
  },
  {
    id: "api",
    kicker: "Python",
    title: "FastAPI",
    detail: "One process on 127.0.0.1",
    status: "implemented",
    x: 50,
    y: 18,
    stages: [0, 1, 3, 4],
    payload: {
      input: `{
  "dev": "scripts/dev.ps1 → API + Vite :5173",
  "prod": "uv run hero → dist + API, opens the browser"
}`,
      transform: `The API owns files, jobs, keyring, and the native file dialog.
The browser owns the canvas, undo, and the PDF.
Handlers enqueue work and return. They do not wait on the worker.
Unknown routes are 404 JSON. Uncaught errors are a short sentence
at 500; the traceback goes to the log with secrets removed.`,
      output: `{
  "create": "POST /api/projects",
  "plan": "GET|PUT /api/projects/{id}/plan",
  "job": "POST /api/projects/{id}/jobs",
  "events": "GET /api/jobs/{id}/events",
  "pdfRoute": null
}`,
    },
  },
  {
    id: "store",
    kicker: "Persistence",
    title: "Project folder",
    detail: "Documents\\2D Hero\\<id>",
    status: "implemented",
    x: 88,
    y: 18,
    stages: [0, 1, 3, 4],
    payload: {
      input: `{
  "project.json": "name, source, linkedPath",
  "plan.json": "schema v2",
  "plan.prev.json": "previous good plan",
  "revisions/": "last 20 snapshots",
  "underlay/": "PNG per level",
  "preview.glb": "or preview.pts",
  "review/": "PNG + SVG for the agent",
  "job.json": "progress mirror"
}`,
      transform: `Writes are a temp file in the same directory, then os.replace.
The client sends If-Match: <revision>. A mismatch is 409 and the current plan.
Recent list: %APPDATA%/2D Hero/recent.json, at most 10, drop missing folders.
A running import with no live job is reported as
"The import was interrupted."`,
      output: `{
  "revision": 4,
  "conflict": "This plan was saved somewhere else. Reloaded.",
  "deleteWhileRunning": 409
}`,
    },
  },
  {
    id: "jobs",
    kicker: "Worker",
    title: "One heavy job",
    detail: "Process pool, cancel between stages",
    status: "implemented",
    x: 12,
    y: 48,
    stages: [1, 3, 4],
    payload: {
      input: `{
  "kind": "import",
  "units": "m | mm | auto",
  "upAxis": "auto | x | y | z"
}`,
      transform: `A process-wide lock. A second job is 409 "A job is already running."
ProcessPoolExecutor with one worker. Checkpoints, in order:
ingest 10 → normalize 30 → levels 50 (cloud.bin) → underlay 70 →
preview 75 → IFC 90, or wall surfaces 88 then wall graph 95.
Cancel is honoured at the next boundary. The plan is not written.
Progress is in memory and mirrored to job.json. The browser listens on SSE.`,
      output: `{
  "state": "cancelled",
  "stage": "wall surfaces",
  "progress": 88,
  "sentence": "Import was cancelled. The plan was not changed."
}`,
    },
  },
  {
    id: "detect",
    kicker: "Geometry",
    title: "Classic pipeline",
    detail: "Meshes and clouds, no learned weights",
    status: "implemented",
    x: 31,
    y: 48,
    stages: [1, 4],
    payload: {
      input: `{
  "scene": "normalised metres, Z up",
  "seed": "fixed",
  "tolerances": "hero.pipeline.tolerances"
}`,
      transform: `Streaming voxel hash (not a random sample). Gravity from the
dominant horizontal plane. Manhattan snap inside 8°. Planar patches,
thickness pairing, cell complex, min-cut inside/outside, elevation
voids, fixture boxes. Openings and fixtures run inside plan write
after the wall-graph checkpoint.`,
      output: `{
  "cleanRoomIoU": ">= 0.95",
  "noisyRoomIoU": ">= 0.85",
  "wallIoU": ">= 0.90",
  "thicknessMaeM": "<= 0.02"
}`,
    },
  },
  {
    id: "ifc",
    kicker: "IFC",
    title: "Semantic import",
    detail: "Objects, not a mesh guess",
    status: "implemented",
    x: 50,
    y: 48,
    stages: [1, 4],
    payload: {
      input: `{
  "file": "model.ifc",
  "scale": "ifcopenshell.util.unit.calculate_unit_scale"
}`,
      transform: `Per IfcBuildingStorey: wall axis and layer thickness, doors and
windows through the void relationship, IfcSpace name and seed,
columns, stairs, furnishing. A wall with an axis never calls the
mesh detector. No axis: fit the footprint and add ifc_wall_from_solid.`,
      output: `{
  "thicknessErrorM": "<= 0.01",
  "roomIoU": ">= 0.95",
  "spaceNames": "kept",
  "millimetreFile": "stored in metres"
}`,
    },
  },
  {
    id: "ml",
    kicker: "Phase 20",
    title: "ML sidecar",
    detail: "Optional, off, not imported",
    status: "planned",
    x: 69,
    y: 48,
    stages: [4],
    payload: {
      input: `{
  "setting": "default off",
  "package": "apps/api/requirements-ml.txt",
  "process": "sidecar, not the main interpreter"
}`,
      transform: `Specified, not built. Prefer SpatialLM or a RoomFormer-style
checkpoint with a local-use licence. Windows path is WSL2 or Docker
CUDA when a native wheel is not honest. The main app must not import
torch at startup. No weight download while the setting is off.`,
      output: `{
  "contract": "schema v2 only",
  "path": "same validators, does not bypass planops",
  "classicPipeline": "remains the default",
  "status": "not started"
}`,
    },
  },
  {
    id: "plan",
    kicker: "Contract",
    title: "plan.json v2",
    detail: "Metres, centerline + thickness",
    status: "implemented",
    x: 88,
    y: 78,
    stages: [0, 1, 4],
    payload: {
      input: `{
  "sourceOfTruth": "apps/api/src/hero/schema.py",
  "generated": "apps/web/src/core/plan-types.ts",
  "driftTest": "regeneration must be a no-op"
}`,
      transform: `Walls are a centerline plus full thickness. Joins are not stored.
Rooms are computed net faces. A seed point anchors the name when
walls move. A 5.00 m by 4.00 m rectangle at 0.20 m thickness has
net area (5.00 − 0.20) × (4.00 − 0.20) = 18.24 m².
Plan Y is north. Screen Y flips only in the view transform.`,
      output: planOut,
    },
  },
  {
    id: "editor",
    kicker: "Browser",
    title: "Konva editor",
    detail: "Kernel in apps/web/src/core",
    status: "implemented",
    x: 69,
    y: 78,
    stages: [0, 1, 3, 4],
    payload: {
      input: `{
  "tools": ["select", "wall", "door", "window", "passage",
    "dimension", "room", "text", "column", "stair", "symbol", "split"],
  "underlay": "PNG at 1.20 m, fade, never becomes walls",
  "preview": "GLB ≤ 200k triangles, or ≤ 500k float32 points"
}`,
      transform: `The kernel is the only writer of plan edits. No React, Konva, or three
inside core/. Immer undo capped at 100. rbush picking. Snap: endpoint
beats grid. A 4 cm gap closes; a 20 cm gap stays open.
Autosave ~400 ms after a change, and on pointer-up. No save on pointer-move.`,
      output: `{
  "save": "PUT /plan  If-Match: 3",
  "conflict": 409,
  "undo": "bitwise vertex restore on a pure move"
}`,
    },
  },
  {
    id: "pdf",
    kicker: "Sheet",
    title: "pdf-lib",
    detail: "Vector PDF in the browser",
    status: "implemented",
    x: 50,
    y: 78,
    stages: [0, 1, 3, 4],
    payload: {
      input: `{
  "paper": "A4 | A3 | A2 | A1",
  "default": "A3 landscape, scale 50",
  "scales": [50, 100, 200],
  "dimensions": "centimetres",
  "areas": "m²"
}`,
      transform: `Drawing commands are compiled in the browser (ISO 128, 5457, 3098, 7200).
pdf-lib writes the file. There is no server PDF route, and no DXF, DWG,
or IFC export. SVG exists only as an internal snapshot for tests and
for the AI review image.`,
      output: `{
  "action": "Download",
  "tile": "Tile sheets when the plan does not fit",
  "locked": "That PDF is open in another program. Close it, then export again."
}`,
    },
  },
  {
    id: "secrets",
    kicker: "Windows",
    title: "Credential Manager",
    detail: "keyring, never the plan",
    status: "implemented",
    x: 12,
    y: 78,
    stages: [3, 4],
    payload: {
      input: `{
  "ui": "Settings → Cursor key → Save key",
  "service": "2D Hero",
  "username": "cursor_api_key"
}`,
      transform: `The editor works with no key. The assistant stays off until a key is saved.
CURSOR_API_KEY in the environment is ignored, so a shell cannot leak a
key into the app. Tests inject an in-memory backend and never touch
the real vault. GET /api/settings returns cursorKeySet and never the key.`,
      output: `{
  "cursorKeySet": true,
  "plan.json": "no key",
  "logs": "no key",
  "http": "no key"
}`,
    },
  },
  {
    id: "ai",
    kicker: "Assistant",
    title: "Propose, then accept",
    detail: "Local agent, MCP planops",
    status: "implemented",
    x: 31,
    y: 78,
    stages: [1, 4],
    payload: {
      input: `{
  "instruction": "Name the large room Living and set wall w3 to 200 mm",
  "review": ["review/underlay.png", "review/plan.svg"],
  "model": "composer-2.5"
}`,
      transform: `python -m hero.mcp exposes get_plan, list_issues, set_wall_thickness,
move_wall, set_opening, set_room_name, apply_ops. Tools validate and
do not write plan.json. The agent cwd is the project folder.
tools are read and mcp only — built-in edit tools are not offered.
The UI highlights the ops. Accept is one undo step. Reject drops them.`,
      output: `{
  "proposalSaved": false,
  "onAccept": { "op": "set_wall_thickness", "thickness": 0.2, "revision": "+1" },
  "onReject": "plan unchanged",
  "badWallId": "tool error, proposal unchanged"
}`,
    },
  },
];

export const systemEdges: ArchEdge[] = [
  { from: "source", to: "gate", label: "local file", status: "implemented" },
  { from: "gate", to: "api", label: "X-Hero-Token", status: "implemented" },
  { from: "api", to: "store", label: "atomic write", status: "implemented" },
  { from: "store", to: "plan", label: "plan.json", status: "implemented" },
  { from: "api", to: "jobs", label: "enqueue", status: "implemented" },
  { from: "jobs", to: "store", label: "job.json", status: "implemented" },
  { from: "jobs", to: "detect", label: "scan", status: "implemented" },
  { from: "jobs", to: "ifc", label: ".ifc", status: "implemented" },
  { from: "detect", to: "plan", label: "schema v2", status: "implemented" },
  { from: "ifc", to: "plan", label: "semantics", status: "implemented" },
  { from: "ml", to: "plan", label: "validators", status: "planned" },
  { from: "plan", to: "editor", label: "GET plan", status: "implemented" },
  { from: "editor", to: "pdf", label: "pdf-lib", status: "implemented" },
  { from: "editor", to: "store", label: "If-Match", status: "implemented" },
  { from: "secrets", to: "ai", label: "keyring", status: "implemented" },
  { from: "api", to: "ai", label: "propose", status: "implemented" },
  { from: "ai", to: "editor", label: "ops preview", status: "implemented" },
];

export const engineNodes: ArchNode[] = [
  {
    id: "read",
    kicker: "Ingest",
    title: "Readers",
    detail: "hero.ingest.read",
    status: "implemented",
    x: 14,
    y: 18,
    stages: [2],
    payload: {
      input: `{
  "formats": ["obj", "glb", "gltf", "usdz", "ply", "e57", "las", "laz", "ifc"]
}`,
      transform: `Each reader yields points in file units. USDZ goes through pxr, not a
regex. E57 applies translation and rotation per scan. LAS/LAZ uses
chunk_iterator. A 5 million point synthetic LAS stayed under the
budget on this machine: tracemalloc peak 0.136 GB, 49.5 s
(Ryzen 5 7600X, 31.1 GB). Limits are 1.5 GB and 5 minutes.`,
      output: `{
  "type": "RawScene",
  "unreadable": "This file could not be read. Export an OBJ, GLB, USDZ, PLY, E57, LAS, LAZ, or IFC file and try again."
}`,
    },
  },
  {
    id: "voxel",
    kicker: "Normalize",
    title: "Voxel hash",
    detail: "Centroids, fixed seed",
    status: "implemented",
    x: 37,
    y: 18,
    stages: [2],
    payload: {
      input: `{
  "voxel_min_m": 0.02,
  "voxel_max_m": 0.10,
  "target_points": 2000000
}`,
      transform: `For each chunk, key (floor(x/v), floor(y/v), floor(z/v)), accumulate
sum and count, emit centroids. If the volume implies more than
target_points cells, grow v and clamp to voxel_max_m.
A random subsample is not the processing cloud.`,
      output: `{
  "cloud": "project/cloud.bin",
  "jsonPointArray": false
}`,
    },
  },
  {
    id: "gravity",
    kicker: "Frame",
    title: "Up and Manhattan",
    detail: "Z up, +X dominant wall",
    status: "implemented",
    x: 60,
    y: 18,
    stages: [2],
    payload: {
      input: `{
  "tilt": "3° synthetic",
  "acceptance": "up-axis error < 1°"
}`,
      transform: `Vertical is the largest nearly-horizontal normal cluster. If nothing
lies within 25° of the short bbox axis, use that axis and add
gravity_uncertain. Floor is the lower of the two largest parallel
planes. Wall normals histogram at 1°. Snap a plane within 8° of +X
or +Y. A 7° wall snaps. A 20° wall stays diagonal.`,
      output: `{
  "frame": "metres, Z up, right-handed",
  "issues": ["gravity_uncertain", "non_manhattan"]
}`,
    },
  },
  {
    id: "storeys",
    kicker: "Levels",
    title: "Storeys",
    detail: "Floor / ceiling peaks",
    status: "implemented",
    x: 83,
    y: 18,
    stages: [2],
    payload: {
      input: `{
  "histogram": "Z bin 0.05 m, 3-bin mean",
  "pair": "ceiling 1.8–8.0 m above the floor"
}`,
      transform: `Two synthetic storeys must match elevation within 0.05 m.
A floor peak covering under 30% of the largest floor is not its own
level. No ceiling peak: one level, ceilingHeight 2.7 m, warning
ceiling_missing. Points within 0.3 m of the slab belong to the level.`,
      output: `{
  "levels": [
    { "id": "L1", "elevation": 0.0, "ceilingHeight": 2.7 },
    { "id": "L2", "elevation": 3.05, "ceilingHeight": 2.65 }
  ]
}`,
    },
  },
  {
    id: "patches",
    kicker: "Walls",
    title: "Patches + thickness",
    detail: "hero.pipeline.surfaces",
    status: "implemented",
    x: 83,
    y: 48,
    stages: [2],
    payload: {
      input: `{
  "plane_dist_m": 0.02,
  "plane_angle_deg": 8,
  "thickness_m": [0.08, 0.60],
  "min_wall_m": 0.40
}`,
      transform: `Deterministic region grow, then SVD. Pair opposite faces (normal dot
≤ −0.95, overlap ≥ 50% of the shorter footprint). Unpaired walls are
assumed: 0.30 m exterior, 0.15 m interior, confidence 0.4, issue
assumed_thickness. A sofa-sized box (about 2×1 m, height under 1.2 m)
must not become a wall. Clean floor: thickness MAE ≤ 0.02 m, angle ≤ 1°.`,
      output: `{
  "centerline": "midway between faces",
  "kind": "exterior | interior | partition | assumed",
  "oneSided": { "assumed": true, "issue": "assumed_thickness" }
}`,
    },
  },
  {
    id: "cells",
    kicker: "Rooms",
    title: "Cell complex",
    detail: "polygonize + min-cut",
    status: "implemented",
    x: 60,
    y: 48,
    stages: [2],
    payload: {
      input: `{
  "endpoint_snap_m": 0.05,
  "min_room_m2": 0.5,
  "library": ["shapely", "networkx"]
}`,
      transform: `Snap ends, split at intersections, polygonize. Floor and ceiling
scores mark sure-inside cells. The unbounded face is sure-outside.
networkx.minimum_cut keeps walls between inside and outside, or
between two inside cells. A missing short wall still opens in the
editor and records open_gap or uncertain_room.
Python planops passes the same shared/vectors as the TypeScript kernel.`,
      output: `{
  "clean": { "roomIoU": ">= 0.95", "dimensionErrorM": "<= 0.02", "wallIoU": ">= 0.90" },
  "noisy": { "roomIoU": ">= 0.85" },
  "room": { "seed": { "x": 2.4, "y": 1.9 }, "polygon": "computed, not stored" }
}`,
    },
  },
  {
    id: "openings",
    kicker: "Voids",
    title: "Openings",
    detail: "Elevation raster, 2 cm",
    status: "implemented",
    x: 37,
    y: 48,
    stages: [2],
    payload: {
      input: `{
  "opening_cell_m": 0.02,
  "close_m": 0.04,
  "close_max_m": 0.06
}`,
      transform: `Per wall, not one RANSAC slice of the storey. Raster points near the
center plane, morphological close with cv2, then classify the void.
A hole that is under 70% empty is still emitted, with low_confidence_opening.
Columns: vertical footprint 0.15–0.80 m, not a short wall.
Stairs: 20–45° plane or ≥ 4 risers of 0.14–0.20 m. Footprint IoU ≥ 0.80.`,
      output: `{
  "door": { "sill": "<= 0.15", "head": "1.90–2.40", "width": "0.60–1.80" },
  "passage": { "head": "near ceiling", "width": ">= 0.90" },
  "window": { "sill": ">= 0.40", "width": "0.40–3.00" },
  "clean": { "precision": ">= 0.85", "recall": ">= 0.90", "widthErrorM": "<= 0.05" }
}`,
    },
  },
  {
    id: "fixtures",
    kicker: "Symbols",
    title: "Fixtures",
    detail: "Box size table",
    status: "implemented",
    x: 14,
    y: 48,
    stages: [2],
    payload: {
      input: `{
  "cluster": "0.15 m linkage, after structure is removed",
  "drop": "plan extent < 0.30 m on both axes"
}`,
      transform: `Oriented box in XY plus Z extent. Class only when width, depth, and
height all fall in a row of the drawing-standard table (toilet, sink,
bathtub, bed-double, …). Two matches → confidence 0.5. One match → 0.8.
Unmatched clusters become symbol block at 0.3. A bare apartment
yields an empty list. Furniture can be hidden without hiding sanitary fixtures.`,
      output: `{
  "bathroom": ["toilet", "sink"],
  "centerErrorM": "<= 0.25",
  "bedroom": "bed-double",
  "wallIsFixture": false
}`,
    },
  },
  {
    id: "ifcpath",
    kicker: "Bypass",
    title: "IFC objects",
    detail: "hero.pipeline.ifcimport",
    status: "implemented",
    x: 60,
    y: 78,
    stages: [2],
    payload: {
      input: `{
  "when": "source suffix is .ifc",
  "checkpoint": "stage name \\"ifc\\" at progress 90"
}`,
      transform: `Semantic fields win over the mesh estimate. The mesh wall detector
is not called for a wall that already has an axis curve. Units are
converted before any length is stored. Two storeys become two levels.`,
      output: `{
  "rooms": "IfcSpace LongName → room.name",
  "issueIfNoAxis": "ifc_wall_from_solid"
}`,
    },
  },
  {
    id: "planops",
    kicker: "Shared kernel",
    title: "planops",
    detail: "Python port of the vectors",
    status: "implemented",
    x: 14,
    y: 78,
    stages: [2],
    payload: {
      input: `{
  "vectors": "shared/vectors/*.json",
  "also": "apps/web/src/core"
}`,
      transform: `Wall-join polygons, net rooms, moveWall, snap. Both kernels must pass
the same files. Joins are L, T, and X with no spike longer than 3×
thickness. Endpoint snap beats the grid. The detector writes vertices,
walls, and room seeds; the editor recomputes faces.`,
      output: `{
  "netArea": 18.24,
  "example": "5.00 × 4.00 m, thickness 0.20 m",
  "grossCenterlineArea": "not used"
}`,
    },
  },
  {
    id: "kernel",
    kicker: "TypeScript",
    title: "Editor kernel",
    detail: "Pure TS, undo, pick, snap",
    status: "implemented",
    x: 37,
    y: 78,
    stages: [2],
    payload: {
      input: `{
  "modules": ["ops", "history", "snap", "pick", "rooms", "wall-polygons"],
  "forbiddenImports": ["react", "konva", "three"]
}`,
      transform: `Tolerances live in one TypeScript module: join snap 0.05 m, miter
limit 3, min room 0.50 m², snap 8 px, ortho 1°. Grid comes from
settings (a new file defaults to 1 m). Dragging a wall moves it
parallel and keeps neighbours orthogonal. Accepting an AI proposal
is one undo step through these same operations.`,
      output: `{
  "history": "immer patches, cap 100",
  "index": "rbush",
  "view": "Y flipped only in the camera"
}`,
    },
  },
  {
    id: "mlengine",
    kicker: "Not started",
    title: "Detector sidecar",
    detail: "Must re-enter planops",
    status: "planned",
    x: 83,
    y: 78,
    stages: [2],
    payload: {
      input: `{
  "phase": 17,
  "status": "not started",
  "default": "off"
}`,
      transform: `A fixture JSON from the sidecar is rejected when it fails schema v2
and accepted only when it passes, then measured with the same Phase 7
metrics. Live model tests skip when no GPU is present.
scripts/test.ps1 on a machine without PyTorch must still pass.`,
      output: `{
  "torchImportedWhenOff": false,
  "weightsDownloaded": false,
  "bypassesPlanops": false
}`,
    },
  },
];

export const engineEdges: ArchEdge[] = [
  { from: "read", to: "voxel", label: "RawScene", status: "implemented" },
  { from: "voxel", to: "gravity", label: "centroids", status: "implemented" },
  { from: "gravity", to: "storeys", label: "Z up", status: "implemented" },
  { from: "storeys", to: "patches", label: "per level", status: "implemented" },
  { from: "patches", to: "cells", label: "centerlines", status: "implemented" },
  { from: "cells", to: "openings", label: "graph", status: "implemented" },
  { from: "openings", to: "fixtures", label: "structure", status: "implemented" },
  { from: "fixtures", to: "planops", label: "draft", status: "implemented" },
  { from: "ifcpath", to: "planops", label: "skip mesh", status: "implemented" },
  { from: "planops", to: "kernel", label: "same vectors", status: "implemented" },
  { from: "mlengine", to: "planops", label: "schema gate", status: "planned" },
];

export const stages: Stage[] = [
  {
    id: "overview",
    short: "Overview",
    title: "A scan becomes a sheet",
    eyebrow: "Stage 1 · System overview",
    diagramTitle: "One PC, two owners",
    diagramNote:
      "Python owns files and detection. The browser owns the drawing, undo, and the PDF. Nothing is uploaded.",
    summary:
      "2D Hero turns a 3D scan or an IFC model into an editable metric floor plan and a scaled PDF. It runs on one Windows machine.",
    purpose:
      "The owner has real scans — phone LiDAR, Matterport-style meshes, terrestrial E57 and LAS, and IFC — and wants a European construction drawing they can correct and print. The plan stays in Documents. There are no accounts.",
    challenges: [
      {
        title: "A slice is not a drawing",
        body: "The pre-Phase-1 prototype cut one plane and called the segments walls. Thickness, rooms, and openings were not a model the editor could trust. Phase 1 deleted that app.",
      },
      {
        title: "The file may not fit in RAM",
        body: "Sites can be large. LAS and LAZ are chunked. The target machine is 16 GB. A 100-million-point cloud is never one array.",
      },
      {
        title: "Two languages, one document",
        body: "Detection is Python. Editing is TypeScript. Both speak schema v2, and both pass the same JSON vectors for joins, rooms, and snaps.",
      },
    ],
    decisions: [
      {
        title: "Local web app",
        body: "React and Vite in the browser, FastAPI on Python 3.12, bound to 127.0.0.1. A desktop shortcut launches it. No Tauri, no installer, no hosted deploy.",
      },
      {
        title: "Centerline plus thickness",
        body: "Rooms are computed from wall geometry and anchored by a seed. A stored room polygon would go stale the moment a wall moves.",
      },
      {
        title: "PDF only",
        body: "ISO metric sheet, dimensions in centimetres, areas in square metres. No DXF, DWG, or IFC export.",
      },
    ],
    statusNotes: [
      {
        status: "implemented",
        text: "Phases 1–16 are done: shell, projects, editor, detection, IFC, assistant, shortcut, and the user guide.",
      },
      {
        status: "planned",
        text: "Phase 20, an optional GPU detector, is not started. The classic pipeline is the product.",
      },
    ],
    graph: "system",
    flow: ["source", "gate", "api", "store", "plan", "editor", "pdf"],
  },
  {
    id: "flow",
    short: "Data flow",
    title: "From file to revision",
    eyebrow: "Stage 2 · Request lifecycle",
    diagramTitle: "Import, edit, propose",
    diagramNote:
      "A scan walks the geometry worker. An IFC walks the semantic importer. Edits and accepted proposals both land as one revision.",
    summary:
      "Three lifecycles share one plan file: import jobs, autosaved editor operations, and assistant proposals that are not saved until Accept.",
    purpose:
      "The HTTP layer stays quick. Heavy work is a single background job with Server-Sent Events. The editor never posts a save on pointer-move. The agent never writes plan.json itself.",
    challenges: [
      {
        title: "Guess, then let the owner correct",
        body: "Units and up axis are guessed before the job starts. The import screen shows both. auto follows the span and gravity rules; the user can override either.",
      },
      {
        title: "Two writers of the same JSON",
        body: "The worker writes the detected plan once. After that the editor sends the whole document with If-Match. A stale revision reloads instead of merging blindly.",
      },
      {
        title: "Preview must stay small",
        body: "The 3D panel gets a decimated GLB (at most 200,000 triangles) or a binary point cap (500,000 float32 XYZ, header HEROPTS). Coordinates are never a JSON array.",
      },
    ],
    decisions: [
      {
        title: "Job checkpoints",
        body: "ingest, normalize, levels, underlay, preview, then either ifc or wall surfaces and wall graph. Openings and fixtures are part of writing the detected plan.",
      },
      {
        title: "Underlays are images",
        body: "A horizontal section 1.20 m above the floor, plus a density image. The editor can fade them. They are not traced into walls.",
      },
      {
        title: "Ops, not a replacement plan",
        body: "POST …/ai/propose returns a list of operations. Accept applies them through the same kernel as a mouse edit. Reject discards the list.",
      },
    ],
    statusNotes: [
      {
        status: "implemented",
        text: "Create, link, dialog, job, SSE, cancel, plan GET/PUT, underlay, preview, propose, accept, and reject are live routes.",
      },
      {
        status: "implemented",
        text: "There is still no PDF route. Download is pdf-lib in the page.",
      },
    ],
    graph: "system",
    flow: ["source", "gate", "api", "jobs", "detect", "plan", "editor", "store"],
  },
  {
    id: "engine",
    short: "Engine",
    title: "Deterministic geometry",
    eyebrow: "Stage 3 · Internal engine",
    diagramTitle: "Detection, then the shared kernel",
    diagramNote:
      "Tolerances live in one Python module and one TypeScript module. Numbers below are the ones the tests assert.",
    summary:
      "The engine is classic geometry: voxel centroids, planes, a cell complex, elevation images, and a size table. Machine learning is not on this path.",
    purpose:
      "Every threshold is explainable and replayable with a fixed seed. The same wall-join and room cases run in Python planops and in the TypeScript kernel, from shared/vectors.",
    challenges: [
      {
        title: "One-sided walls",
        body: "A scan often sees only the inner face. The unpaired plane is still emitted, marked assumed, with 0.15 m or 0.30 m and an issue the editor can select.",
      },
      {
        title: "Clutter",
        body: "Furniture is not structure. Short vertical extent is rejected at the wall stage, then clustered later and classified, or dropped under 0.30 m.",
      },
      {
        title: "Rooms that are not the raw cells",
        body: "Metrics use the net face inside the thickness, not the centerline polygon. The stored seed is moved until it sits in that free space.",
      },
    ],
    decisions: [
      {
        title: "Region growing is the default",
        body: "Open3D plane detection is optional and only after the installed signature is verified. The fallback is deterministic and is what the tests describe.",
      },
      {
        title: "Min-cut for inside and outside",
        body: "Sure-inside cells (floor or ceiling evidence) and the unbounded outside face bound a cut. Partitions survive because they separate two inside cells.",
      },
      {
        title: "IFC does not re-guess",
        body: "When a wall has an axis curve, the mesh detector is not called for that element. A test spies on that.",
      },
    ],
    statusNotes: [
      {
        status: "implemented",
        text: "Ingest, normalize, surfaces, cells, openings, fixtures, IFC, planops, and the TS kernel are in the tree and covered by the phase tests.",
      },
      {
        status: "planned",
        text: "A sidecar may later propose the same schema. It still has to pass planops. That process does not exist yet.",
      },
    ],
    graph: "engine",
    flow: [
      "read",
      "voxel",
      "gravity",
      "storeys",
      "patches",
      "cells",
      "openings",
      "fixtures",
      "planops",
      "kernel",
    ],
  },
  {
    id: "safety",
    short: "Safety",
    title: "Fail in a sentence",
    eyebrow: "Stage 4 · Resilience and safety",
    diagramTitle: "What is allowed to go wrong",
    diagramNote:
      "The plan on disk changes only after a stage finishes, or after a revision check. Secrets never travel with the drawing.",
    summary:
      "Failure is a short English sentence, a kept previous plan, and a job lock. The Cursor key stays in Windows Credential Manager.",
    purpose:
      "The owner can cancel, crash, move a linked file, or open the PDF in another program without losing the last good drawing or leaking a key into logs.",
    challenges: [
      {
        title: "Cancel versus a half-written plan",
        body: "The worker checks a flag at stage boundaries. Cancelled means the plan was not changed. A failed import says the same, after the traceback is logged.",
      },
      {
        title: "One job, one machine",
        body: "A second import gets 409. If the process dies mid-job, the next project list turns that running record into \"The import was interrupted.\"",
      },
      {
        title: "The PDF is locked by another program",
        body: "Export does not pretend success. The page says to close the other program and export again.",
      },
    ],
    decisions: [
      {
        title: "Atomic replace",
        body: "plan.json is written to a temp file beside the destination, then os.replace. A failed replace leaves the previous file readable. plan.prev.json and 20 revisions sit behind it.",
      },
      {
        title: "Token is not the API key",
        body: "X-Hero-Token is a process secret for localhost. The Cursor key is a different secret, write-only in Settings, and absent from HTTP bodies.",
      },
      {
        title: "Real scans are a gate, not a silent skip of a bad number",
        body: "Missing files in samples/user or samples/public skip. A present file that misses a tape length is a failure. Default tape tolerance is 0.05 m.",
      },
    ],
    statusNotes: [
      {
        status: "implemented",
        text: "Host 400, token 401, job 409, revision 409, missing link 400, unreadable file, cancel, locked PDF, and in-memory keyring tests are in the suite.",
      },
      {
        status: "implemented",
        text: "Phase 16 recorded 146 pytest passed, 1 skipped, 47 Vitest passed, ruff clean, pyright 0 errors.",
      },
    ],
    graph: "system",
    flow: ["source", "gate", "api", "jobs", "store"],
  },
  {
    id: "roadmap",
    short: "Roadmap",
    title: "Shipped, and the one open phase",
    eyebrow: "Stage 5 · Today versus the roadmap",
    diagramTitle: "Classic path is the default",
    diagramNote:
      "Turn on full architecture to see the Phase 20 sidecar. It is specified. It is not in the running app.",
    summary:
      "Sixteen phases are done, from the security boundary through release. The only scheduled work left is an optional detector that must not become a dependency.",
    purpose:
      "The roadmap is master_plan.md. Status is binary: done or not started. Phase 20 does not replace the geometry in Stage 3. It may only emit schema v2 and then face the same validators.",
    challenges: [
      {
        title: "A GPU the owner may not have",
        body: "CUDA is not assumed. If a native wheel is dishonest, the spec says WSL2 or Docker, and to say so. A machine without PyTorch must still pass the default tests.",
      },
      {
        title: "Learned walls that skip the kernel",
        body: "That path is forbidden. Invalid sidecar JSON is rejected. Accepted JSON is measured with the same IoU and MAE numbers as the synthetic generator.",
      },
      {
        title: "Do not weaken old thresholds",
        body: "Later phases add stages. They do not rerun an earlier stage's tests with a softer IoU. If a real sample cannot pass, the choice is a fix or one named exception in decisions.md.",
      },
    ],
    decisions: [
      {
        title: "Off unless the owner asks",
        body: "Phase 20's own prompt says to stop unless the owner explicitly asked for the ML phase. The setting defaults off. No import, no download.",
      },
      {
        title: "Libraries stay on a list",
        body: "torch and tensorflow are denied in the main environment. A new package needs a line in decisions.md. PDF stays pdf-lib. LAS stays laspy.",
      },
      {
        title: "English, main, no push",
        body: "The UI is English only. Each phase committed on main and did not push. Projects and samples stay outside git.",
      },
    ],
    statusNotes: [
      {
        status: "implemented",
        text: "Working today: import and link, classic detection, IFC semantics, editor, issues, underlay, 3D preview, PDF, assistant propose/accept, shortcut.",
      },
      {
        status: "planned",
        text: "Not built: requirements-ml.txt, the sidecar process, the on/off setting, SpatialLM or RoomFormer weights, GPU skip tests.",
      },
    ],
    graph: "system",
    flow: ["detect", "plan", "editor", "pdf"],
    flowPlanned: ["ml", "plan", "editor", "pdf"],
  },
];

export function graphFor(stage: Stage): { nodes: ArchNode[]; edges: ArchEdge[] } {
  if (stage.graph === "engine") {
    return { nodes: engineNodes, edges: engineEdges };
  }
  return { nodes: systemNodes, edges: systemEdges };
}

export function curveControl(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function pointOnCurve(
  a: { x: number; y: number },
  c: { x: number; y: number },
  b: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}
