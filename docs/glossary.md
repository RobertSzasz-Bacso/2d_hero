# Glossary

**Assumed wall.** A wall seen from one side only. The thickness is the default, not a measurement, and the plan carries `assumed_thickness`.

**Cell.** A face of the 2D arrangement of wall centerlines. Inside cells become rooms. Outside cells are discarded.

**Centerline.** The line in the middle of a wall. The plan stores this plus a thickness. It is not the line that gets stroked on the PDF.

**Chain.** An automatic or manual run of dimensions along one straight side.

**Cut plane.** The horizontal section drawn in the 3D panel and used for the section underlay. Default 1.20 m above the finished floor. It is not the wall detector.

**Fixture.** A fixed sanitary or kitchen object (`role: fixture`). Furniture is `role: furniture` and can be hidden as a group.

**Issue.** A warning stored on the plan (`detection.issues`). The issues panel can select the element. Issues are not failures of the import.

**Level.** One storey in the plan: its own walls, rooms, and elevation.

**Manhattan frame.** The XY rotation that puts the dominant wall direction on +X and the second on +Y. Walls within 8° snap to it. A wall at 20° stays diagonal.

**Net area.** The floor area inside the wall faces, after poche is subtracted. This is the room area on the tag. The area inside the centerlines is not used.

**Poche.** The filled wall body on the sheet.

**Plan.** The schema v2 JSON document. Not a rendered image.

**Seed.** A point that holds a room's name. When walls move, the name stays with the face that contains the seed.

**Separator.** A zero-thickness line that splits one room into two. It is not a wall.

**Session token.** The process secret in `X-Hero-Token`. It is not the Cursor API key.

**Underlay.** A PNG of the scan, faded under the plan, for tracing. It is not editable geometry.

**Void.** An empty rectangle in a wall's elevation image. Classified as a door, a window, or a passage.
