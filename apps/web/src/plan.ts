export type Vertex = { id: string; x: number; y: number };
export type Wall = { id: string; a: string; b: string };
export type Annotation = { id: string; x: number; y: number; text: string };
export type Opening = {
  id: string;
  wall: string;
  kind: "door" | "window";
  offset: number;
  width: number;
};
export type Dimension = { id: string; a: string; b: string; offset: number };
export type RoomLabel = { id: string; name: string; vertices: string[] };
export type Plan = {
  units: "m";
  vertices: Vertex[];
  walls: Wall[];
  annotations: Annotation[];
  openings?: Opening[];
  dimensions?: Dimension[];
  rooms?: RoomLabel[];
};

export type DetectedRoom = {
  id: string;
  vertices: string[];
  area: number;
  centroid: { x: number; y: number };
  name: string;
};

export function openingsOf(plan: Plan): Opening[] {
  return plan.openings ?? [];
}

export function dimensionsOf(plan: Plan): Dimension[] {
  return plan.dimensions ?? [];
}

export function roomsOf(plan: Plan): RoomLabel[] {
  return plan.rooms ?? [];
}

export function moveVertex(plan: Plan, id: string, x: number, y: number): Plan {
  return {
    ...plan,
    vertices: plan.vertices.map((vertex) => (vertex.id === id ? { ...vertex, x, y } : vertex)),
  };
}

export function openingCenter(plan: Plan, opening: Opening): { x: number; y: number } | null {
  const wall = plan.walls.find((item) => item.id === opening.wall);
  if (!wall) return null;
  const start = plan.vertices.find((vertex) => vertex.id === wall.a);
  const end = plan.vertices.find((vertex) => vertex.id === wall.b);
  if (!start || !end) return null;
  return {
    x: start.x + (end.x - start.x) * opening.offset,
    y: start.y + (end.y - start.y) * opening.offset,
  };
}

export function projectOnWall(plan: Plan, wallId: string, x: number, y: number): number | null {
  const wall = plan.walls.find((item) => item.id === wallId);
  if (!wall) return null;
  const start = plan.vertices.find((vertex) => vertex.id === wall.a);
  const end = plan.vertices.find((vertex) => vertex.id === wall.b);
  if (!start || !end) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length2 = dx * dx + dy * dy;
  if (length2 < 1e-8) return null;
  const offset = ((x - start.x) * dx + (y - start.y) * dy) / length2;
  return Math.min(0.92, Math.max(0.08, offset));
}

export function addOpening(plan: Plan, opening: Opening): Plan {
  return { ...plan, openings: [...openingsOf(plan), opening] };
}

export function deleteOpening(plan: Plan, id: string): Plan {
  return { ...plan, openings: openingsOf(plan).filter((opening) => opening.id !== id) };
}

export function addDimension(plan: Plan, dimension: Dimension): Plan {
  return { ...plan, dimensions: [...dimensionsOf(plan), dimension] };
}

export function dimensionLength(plan: Plan, dimension: Dimension): number | null {
  const start = plan.vertices.find((vertex) => vertex.id === dimension.a);
  const end = plan.vertices.find((vertex) => vertex.id === dimension.b);
  if (!start || !end) return null;
  return Math.hypot(end.x - start.x, end.y - start.y);
}

export function connectVertices(plan: Plan, idA: string, idB: string): Plan {
  if (idA === idB) return plan;
  const first = plan.vertices.find((vertex) => vertex.id === idA);
  const second = plan.vertices.find((vertex) => vertex.id === idB);
  if (!first || !second) return plan;
  const merged: Vertex = {
    id: idA,
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
  const vertices = plan.vertices
    .filter((vertex) => vertex.id !== idB)
    .map((vertex) => (vertex.id === idA ? merged : vertex));
  const seen = new Set<string>();
  const walls: Wall[] = [];
  for (const wall of plan.walls) {
    const start = wall.a === idB ? idA : wall.a;
    const end = wall.b === idB ? idA : wall.b;
    if (start === end) continue;
    const key = [start, end].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    walls.push({ ...wall, a: start, b: end });
  }
  const kept = new Set(walls.map((wall) => wall.id));
  const remap = (id: string) => (id === idB ? idA : id);
  return {
    ...plan,
    vertices,
    walls,
    openings: openingsOf(plan).filter((opening) => kept.has(opening.wall)),
    dimensions: dimensionsOf(plan)
      .map((dimension) => ({ ...dimension, a: remap(dimension.a), b: remap(dimension.b) }))
      .filter((dimension) => dimension.a !== dimension.b),
    rooms: roomsOf(plan)
      .map((room) => ({ ...room, vertices: [...new Set(room.vertices.map(remap))] }))
      .filter((room) => room.vertices.length >= 3),
  };
}

export function deleteVertex(plan: Plan, id: string): Plan {
  const removed = new Set(plan.walls.filter((wall) => wall.a === id || wall.b === id).map((wall) => wall.id));
  return {
    ...plan,
    vertices: plan.vertices.filter((vertex) => vertex.id !== id),
    walls: plan.walls.filter((wall) => wall.a !== id && wall.b !== id),
    openings: openingsOf(plan).filter((opening) => !removed.has(opening.wall)),
    dimensions: dimensionsOf(plan).filter((dimension) => dimension.a !== id && dimension.b !== id),
    rooms: roomsOf(plan)
      .map((room) => ({ ...room, vertices: room.vertices.filter((vertexId) => vertexId !== id) }))
      .filter((room) => room.vertices.length >= 3),
  };
}

export function deleteWall(plan: Plan, id: string): Plan {
  return {
    ...plan,
    walls: plan.walls.filter((wall) => wall.id !== id),
    openings: openingsOf(plan).filter((opening) => opening.wall !== id),
  };
}

export function addAnnotation(plan: Plan, annotation: Annotation): Plan {
  return { ...plan, annotations: [...plan.annotations, annotation] };
}

export function updateAnnotation(plan: Plan, id: string, text: string): Plan {
  return {
    ...plan,
    annotations: plan.annotations.map((note) => (note.id === id ? { ...note, text } : note)),
  };
}

export function deleteAnnotation(plan: Plan, id: string): Plan {
  return { ...plan, annotations: plan.annotations.filter((note) => note.id !== id) };
}

export function nameRoom(plan: Plan, vertices: string[], name: string): Plan {
  const key = [...vertices].sort().join("|");
  const rooms = roomsOf(plan).filter((room) => [...room.vertices].sort().join("|") !== key);
  const trimmed = name.trim();
  if (trimmed) {
    rooms.push({ id: `room-${[...vertices].sort().join("-")}`, name: trimmed, vertices: [...vertices] });
  }
  return { ...plan, rooms };
}

export function detectRooms(plan: Plan): DetectedRoom[] {
  const positions = new Map(plan.vertices.map((vertex) => [vertex.id, vertex]));
  const neighbors = new Map<string, string[]>();
  for (const vertex of plan.vertices) neighbors.set(vertex.id, []);
  for (const wall of plan.walls) {
    if (!positions.has(wall.a) || !positions.has(wall.b) || wall.a === wall.b) continue;
    neighbors.get(wall.a)?.push(wall.b);
    neighbors.get(wall.b)?.push(wall.a);
  }
  const ordered = new Map<string, string[]>();
  for (const [vertexId, ends] of neighbors) {
    const origin = positions.get(vertexId);
    if (!origin) continue;
    ordered.set(
      vertexId,
      [...ends].sort((left, right) => {
        const a = positions.get(left)!;
        const b = positions.get(right)!;
        return Math.atan2(a.y - origin.y, a.x - origin.x) - Math.atan2(b.y - origin.y, b.x - origin.x);
      }),
    );
  }
  const turn = (previous: string, current: string) => {
    const ends = ordered.get(current) ?? [];
    const index = ends.indexOf(previous);
    if (index < 0 || ends.length === 0) return null;
    return ends[(index - 1 + ends.length) % ends.length];
  };
  const seen = new Set<string>();
  const cycles: string[][] = [];
  for (const wall of plan.walls) {
    for (const [start, next] of [
      [wall.a, wall.b],
      [wall.b, wall.a],
    ] as const) {
      const mark = `${start}>${next}`;
      if (seen.has(mark) || !positions.has(start)) continue;
      const cycle = [start];
      let previous = start;
      let current = next;
      let closed = false;
      for (let guard = 0; guard < 10000; guard += 1) {
        seen.add(`${previous}>${current}`);
        if (current === start) {
          closed = true;
          break;
        }
        cycle.push(current);
        const following = turn(previous, current);
        if (!following) break;
        previous = current;
        current = following;
      }
      if (closed && cycle.length >= 3) cycles.push(cycle);
    }
  }
  const unique: string[][] = [];
  const fingerprints = new Set<string>();
  for (const cycle of cycles) {
    const fingerprint = [...new Set(cycle)].sort().join("|");
    if (new Set(cycle).size < 3 || fingerprints.has(fingerprint)) continue;
    fingerprints.add(fingerprint);
    unique.push(cycle);
  }
  const measured = unique
    .map((cycle) => {
      const polygon = cycle.map((id) => positions.get(id)!).filter(Boolean);
      const area = shoelace(polygon);
      return {
        vertices: cycle,
        area,
        centroid: {
          x: polygon.reduce((sum, vertex) => sum + vertex.x, 0) / polygon.length,
          y: polygon.reduce((sum, vertex) => sum + vertex.y, 0) / polygon.length,
        },
      };
    })
    .filter((room) => room.area >= 1e-4);
  let rooms = measured;
  if (rooms.length > 1) {
    const largest = Math.max(...rooms.map((room) => room.area));
    const others = rooms.reduce((sum, room) => sum + room.area, 0) - largest;
    if (largest >= others * 0.9) rooms = rooms.filter((room) => Math.abs(room.area - largest) > 1e-6);
  }
  return rooms
    .sort((left, right) => right.area - left.area || left.vertices.join().localeCompare(right.vertices.join()))
    .map((room) => {
      const key = [...room.vertices].sort().join("|");
      const named = roomsOf(plan).find((item) => [...item.vertices].sort().join("|") === key);
      return {
        id: named?.id ?? `room-${[...room.vertices].sort().join("-")}`,
        vertices: room.vertices,
        area: room.area,
        centroid: room.centroid,
        name: named?.name ?? "",
      };
    });
}

function shoelace(polygon: Vertex[]): number {
  let total = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    total += current.x * next.y - next.x * current.y;
  }
  return Math.abs(total) / 2;
}
