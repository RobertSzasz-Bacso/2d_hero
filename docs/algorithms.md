# Algorithms

This is the geometry contract. Implement it in the order below. Numbers here are the ones tests use. If a library call is awkward on Windows, use the fallback in the same section. Do not replace a section with a single horizontal slice.

Papers for the method, not for code to copy:

- Rabbani, van den Heuvel, Vosselman. *Segmentation of point clouds using smoothness constraint.* ISPRS 2006. Region growing.
- Schnabel, Wahl, Klein. *Efficient RANSAC for point-cloud shape detection.* 2007. Plane fitting. Open3D's detector is the packaged form. The fallback below is region growing, which is deterministic.
- Mura, Mattausch, Jaspe Villanueva, Gobbetti, Pajarola. *Automatic room detection and reconstruction in cluttered indoor environments with complex room layouts.* Computers & Graphics 2014. Cell complex and inside/outside.
- Ochmann, Vock, Wessel, Klein. *Automatic reconstruction of parametric building models from indoor point clouds.* ISPRS Journal 2016. Wall centerlines and thickness.
- Turner and Zakhor. *Floor plan generation and room labeling of indoor environments from laser range data.* 2014. Floor and ceiling evidence. We use their evidence idea on a 2D cell complex, not their volumetric grid.

## Frame and tolerances

Internal frame after normalization:

- Metres.
- Z up, right-handed.
- X and Y in the Manhattan frame when the building has one. +X is the dominant wall direction.
- Plan 2D uses those X and Y. Y is up in the plan, not down.

Detection tolerances (one Python module, these values):

| Name | Value | Meaning |
| --- | --- | --- |
| `voxel_min_m` | 0.02 | Finest processing voxel. |
| `voxel_max_m` | 0.10 | Coarsest, only for a huge site. |
| `target_points` | 2_000_000 | Downsample budget. |
| `plane_dist_m` | 0.02 | Point-to-plane inlier. |
| `plane_angle_deg` | 8 | Region-grow normal limit. |
| `manhattan_snap_deg` | 8 | Snap a wall to the dominant axis inside this angle. |
| `thickness_min_m` | 0.08 | Thinnest paired wall. |
| `thickness_max_m` | 0.60 | Thickest paired wall. |
| `assumed_interior_m` | 0.15 | One-sided interior wall. |
| `assumed_exterior_m` | 0.30 | One-sided exterior wall. |
| `endpoint_snap_m` | 0.05 | Join centerline ends. |
| `min_wall_m` | 0.40 | Drop shorter fragments. |
| `min_room_m2` | 0.50 | Drop smaller faces. |
| `opening_cell_m` | 0.02 | Elevation raster. |

Editor tolerances (one TypeScript module):

| Name | Value |
| --- | --- |
| `join_snap_m` | 0.05 |
| `miter_limit` | 3 |
| `min_room_m2` | 0.50 |
| `snap_px` | 8 |
| `ortho_deg` | 1 |
| `grid_m` | from settings, default 0.01 |

## Ingest

Each reader yields a `RawScene`: points `(N, 3)` in the file's own units and axis, optional normals, optional triangles, a `unit_scale_to_meters` guess, and the source format.

| Format | Reader | Notes |
| --- | --- | --- |
| OBJ, GLB, glTF | trimesh | Bake transforms. A scene becomes one mesh. |
| USDZ | `pxr` (`usd-core`) | Open the crate. Read `UsdGeom.Mesh`. Apply `metersPerUnit` and the full xform. Do not use regular expressions. USDA and USDC both go through `pxr`. |
| PLY | trimesh | Mesh if it has faces, otherwise points. |
| E57 | pye57 | Read every scan. Apply the scan translation and rotation. Skip a scan with no Cartesian points. |
| LAS, LAZ | laspy | `chunk_iterator`. Never `points = np.array(all)`. |
| IFC | Phase 8 may tessellate with ifcopenshell for a preview mesh. Semantic import is Phase 14 and does not use this mesh as the plan. |

Unit guess, before converting:

- Let `span` be the largest horizontal extent of the raw points.
- A room is usually 2–30 m. A storey is usually under 100 m.
- If `span > 200`, treat the file as millimetres (`scale = 0.001`).
- If `50 < span <= 200`, treat it as centimetres (`scale = 0.01`).
- Otherwise treat it as metres.
- Add issue `units_guessed` whenever the scale is not 1, or whenever the user had to confirm. The import screen can override. After the override, multiply and continue in metres.

## Downsample

Streaming voxel hash. For each chunk, key `(floor(x/v), floor(y/v), floor(z/v))`, accumulate sum and count. Emit centroids at the end.

Choose `v = voxel_min_m`. If the bbox volume suggests more than `target_points` cells, increase `v` so the expected count is about `target_points`, and clamp to `voxel_max_m`. Record `v` on the job.

Do not use a random sample as the processing cloud.

## Normals

If the mesh has faces, compute area-weighted face normals and one normal per vertex, then store a normal per downsampled point by nearest vertex.

If the cloud has no normals, use Open3D `estimate_normals` with k = 30. Verify the method name in the installed Open3D. Orient normals so they point towards the outside of a rough bbox center when a consistent-tangent method is not available. Check the installed signature before calling `orient_normals_consistent_tangent_plane`.

## Gravity

1. Coarse planes: region growing (below) at voxel 0.05 m, or Open3D plane patches if you have confirmed the signature. Keep planes with at least 500 points.
2. The vertical direction is the normal of the largest nearly-horizontal cluster: cluster plane normals within 10°, score a cluster by total area, and prefer a cluster whose normal is within 25° of the shortest bbox axis (buildings are shorter than they are wide).
3. If no cluster is within 25° of that axis, use the shortest bbox axis and add `gravity_uncertain`.
4. Sign: the floor is the lower of the two largest parallel horizontal planes. +Z must point from floor to ceiling after the rotation.
5. Rotate the cloud and the normals. Translate Z so the lowest floor peak sits at 0 for the lowest level. Higher storeys keep their elevations.

Acceptance on the synthetic tilt: angle between estimated up and true up is under 1°.

## Dominant directions

1. Take planes whose normal is within 15° of horizontal (walls).
2. Project those normals to XY and find the strongest angle by a histogram of bin 1°.
3. The second axis is that angle plus 90°. If a second peak is at least 30% of the first and within 8° of +90°, the building is Manhattan.
4. Rotate XY so the strongest direction is +X. Store `manhattanAngleDeg` (the rotation applied, degrees counter-clockwise).
5. If the second peak is missing, still store the strongest angle, and add `non_manhattan` only for later planes that stay off-axis.

## Storeys

After Z-up:

1. Keep points whose normal is within 15° of +Z (floor) or −Z (ceiling).
2. Histogram Z with bin 0.05 m. Smooth with a 3-bin mean.
3. A peak is a smoothed bin at least as high as both neighbors, and higher than 2% of the points in the histogram. A flat smoothed plateau keeps the bin with the higher raw count. The reported height is the count-weighted centre of that bin and its two neighbors. Edge bins count.
4. Pair each floor peak with the next ceiling peak 1.8–8.0 m above it.
5. A floor peak whose horizontal coverage is under 30% of the largest floor is not its own level. Add an info issue and ignore it as a mezzanine hint.
6. Each pair is a level: `elevation` is the floor Z, `ceilingHeight` is the difference.
7. If the cloud has points but no floor/ceiling pair, keep one level at the strongest floor peak, or at the lowest point when there is no floor peak. `ceilingHeight` is 2.7 m. Add warning `ceiling_missing`.
8. Points within 0.3 m below the floor or 0.3 m above the ceiling belong to that level for later stages.

Acceptance: two synthetic storeys, elevations within 0.05 m.

## Planar patches

Vertical structure only in this stage: normals within 15° of horizontal.

Prefer Open3D only after you have read the installed signature of its plane detector. Otherwise use this fallback, which is the default because it is deterministic:

1. Order points by a curvature proxy (smallest eigenvalue of the 30-neighbor covariance). Tie-break by index.
2. Seed the unused point with the lowest curvature.
3. Grow while the neighbor's normal is within `plane_angle_deg` and the point-to-plane distance is within `plane_dist_m`.
4. Fit the final plane by SVD. Reject the region if it has fewer than 200 points or an area under 0.5 m².
5. Stop when no seed remains, or after 400 planes.

Snap: if the plane's horizontal angle is within `manhattan_snap_deg` of +X or +Y, snap the normal to that axis and refit the offset. A plane 20° off-axis must not snap. A plane 7° off-axis must snap.

Merge two regions when their snapped normals match, their plane offsets differ by at most 0.03 m, and their footprints on the wall axis overlap or sit within 0.15 m.

## Thickness

For each vertical plane, look for a partner with normal dot product ≤ −0.95, plane-to-plane distance in `[thickness_min_m, thickness_max_m]`, and footprint overlap at least 50% of the shorter footprint.

- Paired: centerline is the midline, thickness is the distance, `confidence = 1`, `assumed` false. Kind is `exterior` if one side has no interior floor points within 0.5 m, otherwise `partition` if both sides are interior, otherwise `interior`.
- Unpaired: `assumed` true, `confidence = 0.4`, thickness `assumed_exterior_m` if the plane lies on the outer 2D hull of all wall planes, else `assumed_interior_m`. Issue `assumed_thickness`.

Drop fragments shorter than `min_wall_m`.

A sofa-sized cluster (about 2 m × 1 m, height under 1.2 m, not floor-to-ceiling) must not become a wall. Reject a plane whose vertical extent is under 1.2 m unless it is a sill or a bulkhead attached to a taller coplanar plane.

Acceptance on the clean synthetic floor: thickness MAE ≤ 0.02 m, wall angle error ≤ 1°.

## Cell complex and rooms

Centerlines become a planar graph.

1. Snap endpoints within `endpoint_snap_m`.
2. Split every centerline at intersections (Shapely `unary_union` of line strings, then node the result).
3. `polygonize` the arrangement. Each polygon is a cell. The exterior is the unbounded face.
4. Evidence per cell, using points of this level:
   - `floor_score`: count of upward normals inside the cell, divided by cell area.
   - `ceiling_score`: same for downward normals.
   - A cell is a **sure inside** when either score is above the median of the non-empty cells.
   - The unbounded face is **sure outside**.
5. Build a graph of cells. The capacity of an edge is high (1000) when the shared boundary has strong vertical points (a real wall) and low (1) when it does not.
6. `networkx.minimum_cut` between a super-source linked to sure-inside cells and a super-sink linked to sure-outside cells. Cells on the source side are inside.
7. A centerline is kept when it separates inside from outside, or two inside cells (a partition). A line between two outside cells is dropped. Issue `open_gap` when an inside cell is not closed by kept walls.
8. Write walls with thickness from the pairing step. Write one room seed at the centroid of each inside cell whose area is at least `min_room_m2`.

Room polygons for metrics and for the editor are not the raw cells. They are the **net** faces from the wall-join polygons below, so the stored seed must fall in the net face. Shrink the seed toward the cell centroid of the free space if the centerline cell centroid lands inside a wall.

Topology cleanup before writing:

- Merge collinear walls that share a vertex and have the same thickness and kind, when the angle is under 1°.
- Remove a wall that is a duplicate of another (same vertices, either direction).
- A vertex of degree 0 goes away.

Acceptance, clean synthetic apartment: room IoU ≥ 0.95, each room width and depth within 0.02 m, wall IoU ≥ 0.90. Noisy option: room IoU ≥ 0.85.

## Openings

For each wall, build an elevation image.

1. `u` runs from vertex `a` to `b`. `z` is height above the floor.
2. Take points within `thickness/2 + 0.05` of the center plane, `z` from 0.05 to `ceilingHeight - 0.05`.
3. Raster cell 0.02 m. A cell is solid when it holds at least 2 points. For a mesh, rasterize the wall triangles instead of the points.
4. Morphological close of 0.04 m (`cv2`) to fill scan pinholes. Do not close with a kernel larger than 0.06 m, or doors disappear.
5. A void is a run of columns with a stable empty `z` interval. Keep voids whose bbox is at least 70% empty. Below that, still emit the opening and add `low_confidence_opening`.

Classify:

| Kind | Sill | Head | Width |
| --- | --- | --- | --- |
| `door` | ≤ 0.15 | 1.90–2.40, and below the ceiling by ≥ 0.20 | 0.60–1.80 |
| `passage` | ≤ 0.15 | within 0.20 of the ceiling | ≥ 0.90 |
| `window` | ≥ 0.40 | ≤ ceiling − 0.05, height ≥ 0.40 | 0.40–3.00 |

A door wider than 1.20 m gets `swing: double`. Otherwise `swing: left`, `swingSide: positive`. Tests do not depend on hinge side.

`offset` is the void center along the wall. `width`, `sill`, and `head` come from the void. Clamp `head` to the ceiling.

Acceptance, clean synthetic: precision ≥ 0.85, recall ≥ 0.90, width and sill error ≤ 0.05 m. Match rule is in Metrics.

## Columns

A vertical patch not consumed by a paired wall, whose plan bounding box is between 0.15 m and 0.80 m on both sides, becomes a column. Width, depth, and `rotationDeg` come from the minimum rotated rectangle of its footprint.

## Stairs

Accept either evidence:

- A plane whose normal is 20–45° from +Z and whose area is at least 1 m², or
- At least four horizontal steps in that footprint, with risers 0.14–0.20 m.

The outline is the plan footprint. `direction` is the uphill gradient in XY, normalized. `riserCount` is the number of steps, or `round(height / median_riser)`.

Acceptance: footprint IoU ≥ 0.80 against the synthetic stair.

## Fixtures

Remove points that belong to floors, ceilings, walls, columns, and stairs. Cluster the rest with a 0.15 m Euclidean linkage (SciPy). Drop a cluster whose plan extent is under 0.30 m on both axes.

Fit an oriented box in XY (minimum rotated rectangle) and a height from the Z extent.

Classify only when width, depth, and height all fall in a row. If two rows match, pick the smaller area distance to the row's mid box and set confidence to 0.5. One row means confidence 0.8.

| Class | Symbol | Role | Width | Depth | Height |
| --- | --- | --- | --- | --- | --- |
| toilet | `toilet` | fixture | 0.35–0.45 | 0.60–0.80 | 0.35–0.55 |
| sink | `sink` | fixture | 0.40–0.80 | 0.35–0.55 | 0.10–0.25 |
| bathtub | `bathtub` | fixture | 0.70–0.90 | 1.40–1.90 | 0.40–0.60 |
| shower | `shower` | fixture | 0.70–1.20 | 0.70–1.20 | 0.05–0.30 |
| kitchen run | `kitchen-counter` | fixture | ≥ 1.20 | 0.50–0.70 | 0.80–1.00 |
| stove | `stove` | fixture | 0.55–0.65 | 0.55–0.65 | 0.85–1.00 |
| bed | `bed-double` | furniture | 1.30–2.00 | 1.90–2.20 | 0.40–0.70 |
| sofa | `sofa` | furniture | 0.80–1.10 | 1.40–2.80 | 0.70–1.00 |
| table | `table` | furniture | 0.60–1.40 | 0.60–2.20 | 0.65–0.80 |
| wardrobe | `wardrobe` | furniture | ≥ 0.80 | 0.50–0.70 | 1.80–2.40 |

Width and depth may be swapped before the test. Height is the vertical extent of the cluster, not the seat height, except the sink, which uses the basin body if the pedestal is a separate cluster. The synthetic generator must build boxes inside these ranges so the test is not ambiguous.

Unmatched clusters ≥ 0.30 m become symbol `block`, role `furniture`, confidence 0.3. A bare apartment produces an empty list.

## IFC

Use ifcopenshell. Convert with `ifcopenshell.util.unit.calculate_unit_scale` before any length is stored. Verify each helper against the installed package.

Per `IfcBuildingStorey`:

- Walls in that storey: centerline from the wall axis curve when it exists. Thickness from the material layer set total, else from the rectangular profile, else from the solid's short side. Kind from `IsExternal` when the property exists.
- If there is no axis curve, fit the centerline to the footprint's long side and add `ifc_wall_from_solid`.
- Doors and windows: width and height from the door/window attributes or the opening void. `offset` from the void's center projected onto the host wall. Host through the void relationship, not through a nearest-wall guess, when the relationship exists.
- `IfcSpace`: room seed at the footprint centroid, `name` from `LongName` or `Name`.
- Columns, stairs, and furnishing map to the same schema fields. Furnishing uses the closest symbol row by size, or `block`.

When a wall has an axis, the mesh detector must not be called for that wall.

Acceptance on the synthetic IFC: thickness within 0.01 m, room IoU ≥ 0.95, space names kept, millimetre files converted to metres.

## Underlay

Not geometry. A PNG for the editor.

- Section: 1.20 m above the level floor. Mesh: intersect triangles with that plane and rasterize at 0.02 m/pixel. Cloud: points within ±0.15 m, density raster.
- Top-down: all level points projected to XY, density raster.
- Draw the building bounds with a 1 m margin. Empty pixels are transparent.

## Editor geometry

Used by TypeScript from Phase 3 and by Python `planops` from Phase 11. Both must pass `shared/vectors/`.

### Wall polygons

Offset each centerline left and right by `thickness / 2`.

At an end of degree 1, close with a square cap.

At a corner, intersect this wall's left offset with the neighbor's matching offset. If the intersection is farther than `miter_limit * thickness` from the vertex, bevel: cut across the offset at the vertex. A 90° corner of equal thickness meets at a square outer corner. The poche polygon contains the centerline and does not self-intersect.

Where three or more wall ends meet at one vertex, each of those polygons also passes through the joint point between its two end corners. Otherwise two collinear walls with a partition between them leave a triangular gap at the joint, and the union has no free faces.

A T-junction is an endpoint that lands on another wall's interior, within `join_snap_m` of that centerline and not only at its ends. Extend the butt wall to the host centerline, build both polygons, then subtract the host polygon from the butt so the butt stops at the host face.

The union of the four wall polygons of the 5.00 × 4.00 m example, thickness 0.20 m, leaves a free rectangle of 4.80 × 3.80 m. Each wall is centred on its centerline, so the clear span is the centerline span minus one thickness, not two.

### Rooms

1. Union all wall polygons (`polygon-clipping` in TypeScript, Shapely in Python).
2. Cut the union with separator segments.
3. The free faces inside the outer boundary, each of area ≥ `min_room_m2`, are rooms.
4. A seed inside a face keeps that room's name and number. A seed that lands in a wall moves to the nearest face within 0.30 m. If none, issue `room_seed_lost`. Two seeds in one face: keep both and issue `room_not_split`.
5. Area is the net polygon area. Do not use the centerline rectangle.

### moveWall

The drag is perpendicular to the wall. Endpoints move by the same delta.

Collinear neighbors within `ortho_deg` of 180° that share a vertex are part of the run and take the same delta.

Any other neighbor keeps its far endpoint. If that neighbor was within `ortho_deg` of orthogonal to the moved wall, slide the shared vertex along the neighbor's original direction so it stays orthogonal. A rectangle's south wall moving north changes the depth and leaves the east and west walls vertical.

### Typed dimension

The segment's `a` reference stays fixed. Its `b` reference moves along `a → b` until the distance equals the typed length in metres (the UI converts from cm or mm). Translate the rigid component of vertices attached on the `b` side by that same vector. Vertices on the `a` side stay. Orthogonal neighbors that were orthogonal stay orthogonal.

### Grip operations

These back the Phase 18 grips and the Phase 19 tools. Each has a JSON case in `shared/vectors/` that the TypeScript kernel and Python `planops` both pass. The wall's left normal `n` is the unit vector 90° counter-clockwise from `a → b`. Its left face is the centerline offset by `+n · thickness / 2`.

- `setWallThicknessFromFace(wall, thickness, keep)`: `keep` is `left`, `right`, or `center`. The kept face (or the centerline) stays in place. For `keep = left` the centerline moves by `n · (old − new) / 2`; for `right` by `−n · (old − new) / 2`; for `center` it does not move. The centerline move is a `moveWall`, so orthogonal neighbors stay orthogonal. Then the thickness is set. Thickness must stay in the schema range (> 0 and ≤ 1.5).
- `setClearDistance(wall, other, distance)`: both walls within `ortho_deg` of parallel, otherwise an error. With `d` the signed distance from the wall centerline to the other centerline along `n`, the clear distance is `|d| − t_wall / 2 − t_other / 2`. Move the wall by `−sign(d) · n · (distance − clear)` with `moveWall`. `distance` must be > 0.
- `setOpeningEdge(opening, edge, delta)`: `edge` is `start` (closer to wall vertex `a`) or `end`. `delta` is metres of growth outward from the opening center (negative shrinks). The other edge stays. The width becomes `width + delta` and the center moves by `delta / 2` toward the moved edge. The result must keep `width > 0` and the whole opening on the wall centerline span, otherwise an error.
- `rehostOpening(opening, wall, point)`: the opening moves to `wall` with its center at the foot of `point` on that centerline, clamped so the opening stays on the span. Width, sill, head, swing, and side are kept. An opening whose width is not less than the target wall length is an error and the plan is unchanged.
- `moveSelection(items, delta)`: moves every vertex referenced by a selected vertex, wall, or separator, every selected fixture, column, and text insertion point, every selected stair outline, and every selected room seed, by exactly `delta`. Openings ride on their walls.
- `snapRotation(deg, free)`: without `free`, round to the nearest multiple of 15°.
- `snapFixtureToWall(fixture, toleranceM)`: find the wall face nearest to the fixture center whose distance from the fixture's back edge is within `toleranceM`. Rotate the fixture so local +Y points from the room toward that face, and move it along the face normal so the back edge lies on the face. No face within tolerance: unchanged.
- `wallFromLocation(p, q, thickness, location)`: `location` is `center`, `left`, or `right`. The clicked line `p → q` is that face. For `left` the centerline is the clicked line offset by `−n · thickness / 2`; for `right` by `+n · thickness / 2`. In a wall chain the shared vertex of two segments is the intersection of their two offset centerlines, and closing on the start point moves the start vertex to the intersection of the last and first centerlines. Drawn counter-clockwise, `left` makes the clicked box the clear room.
- `addRectangle(c1, c2, thickness, mode)`: four vertices and four closed walls, counter-clockwise. `mode = interior`: the box `c1, c2` is the clear room, so centerlines are offset outward by `thickness / 2`. `mode = centerline`: the box is the centerline. A 4.80 × 3.80 m interior box with 0.20 m walls has 5.00 × 4.00 m centerlines and 18.24 m² net.
- `placeOpeningAtDistance(wall, kind, end, distance, width)`: `end` is `a` or `b`. The inner corner at that end is the end vertex moved along the wall by half the thickest other wall meeting that vertex (zero if none). The near edge of the opening is placed `distance` from that corner along the wall.
- `addDimension(refs, offset)`: a chain through two or more references, `auto: false`.

### Snapping

A candidate must lie within `snap_px` of the cursor. Higher priority wins even if it is farther. Same priority: the nearest wins.

1. Vertex.
2. Wall midpoint.
3. Intersection of two centerlines.
4. Perpendicular foot on a centerline.
5. Extension of a centerline beyond an end, up to 2 m.
6. Alignment: the cursor's x is within `snap_px` of a vertex's x, or its y of a vertex's y. The point takes that coordinate and keeps the cursor's other one. When both an x and a y alignment exist, the point takes both, so the point can be up to √2 · `snap_px` from the cursor. The nearest vertex on each axis wins; the hit's id is the x-aligned vertex when there is one. The tool draws a dashed guide from each aligned vertex.
7. Angle lock to 0°, 45°, or 90° from the previous wall-tool segment.
8. Grid.

### Undo

`immer` patches, cap 100. A pointer drag is one transaction from pointer-down to pointer-up. An accepted AI proposal is one transaction.

## Metrics

Implement these in the test kit. Detection tests call them. They do not live inside the detector.

- **Wall IoU.** Buffer each centerline by half its thickness (round caps), unary union, intersection-over-union with the same union of the truth. Clean target ≥ 0.90.
- **Room IoU.** Net room polygons. Greedy match by IoU. Unmatched truth rooms count as 0. The score is the mean over truth rooms. Clean ≥ 0.95. Noisy ≥ 0.85.
- **Room dimensions.** For a rectangular truth room, width and depth of the matched net polygon within 0.02 m.
- **Opening match.** Same kind, center distance ≤ 0.25 m, absolute width difference ≤ 0.15 m. One-to-one. Precision = matches / predicted. Recall = matches / truth. Clean precision ≥ 0.85, recall ≥ 0.90.
- **Thickness MAE.** Mean absolute thickness error of walls whose centerlines overlap the truth. Clean ≤ 0.02 m. IFC ≤ 0.01 m.
- **Frame angle.** Smallest difference between `manhattanAngleDeg` values modulo 90°. Tilt test < 1°.
- **Stair IoU.** Footprint polygons. ≥ 0.80.

Truth compared with itself scores 1 on IoU and recall.
