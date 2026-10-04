import { difference, union } from "polygon-clipping"
import type { Pair, Polygon, Ring } from "polygon-clipping"
import { add, dedupeRing, dist, footOnLine, left, lineIntersect, mul, right, sub, unit } from "./geom.ts"
import type { Level, Plan, Point, Wall } from "./plan-types.ts"
import { editorTolerances } from "./tolerances.ts"

export type WallPolygon = {
  wallId: string
  ring: Point[]
}

type EndName = "a" | "b"

type EndRef = {
  wallId: string
  end: EndName
  point: Point
}

type Cluster = {
  ends: EndRef[]
  joint: Point
  host: { wallId: string; foot: Point } | null
}

type SideName = "left" | "right"

type Corners = Record<EndName, Record<SideName, Point | null>>

function levelOf(plan: Plan, levelId: string): Level {
  const level = plan.levels.find((item) => item.id === levelId)
  if (!level) {
    throw new Error(`Unknown level ${levelId}`)
  }
  return level
}

function vertexMap(level: Level): Map<string, Point> {
  return new Map(level.vertices.map((vertex) => [vertex.id, { x: vertex.x, y: vertex.y }]))
}

function pointOf(vertices: Map<string, Point>, id: string): Point {
  const point = vertices.get(id)
  if (!point) {
    throw new Error(`Unknown vertex ${id}`)
  }
  return point
}

function clusterEnds(ends: EndRef[]): Cluster[] {
  const parent = ends.map((_, index) => index)
  const find = (index: number): number => {
    let cursor = index
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor] as number] as number
      cursor = parent[cursor] as number
    }
    return cursor
  }
  const unite = (leftIndex: number, rightIndex: number) => {
    parent[find(leftIndex)] = find(rightIndex)
  }
  for (let i = 0; i < ends.length; i += 1) {
    for (let j = i + 1; j < ends.length; j += 1) {
      const a = ends[i]
      const b = ends[j]
      if (!a || !b || a.wallId === b.wallId) {
        continue
      }
      if (dist(a.point, b.point) <= editorTolerances.join_snap_m) {
        unite(i, j)
      }
    }
  }
  const groups = new Map<number, EndRef[]>()
  for (let i = 0; i < ends.length; i += 1) {
    const end = ends[i]
    if (!end) {
      continue
    }
    const root = find(i)
    const list = groups.get(root) ?? []
    list.push(end)
    groups.set(root, list)
  }
  return [...groups.values()].map((members) => {
    const joint = {
      x: members.reduce((sum, end) => sum + end.point.x, 0) / members.length,
      y: members.reduce((sum, end) => sum + end.point.y, 0) / members.length,
    }
    return { ends: members, joint, host: null }
  })
}

function markJunctions(level: Level, vertices: Map<string, Point>, clusters: Cluster[]) {
  for (const cluster of clusters) {
    if (cluster.ends.length !== 1) {
      continue
    }
    const end = cluster.ends[0]
    if (!end) {
      continue
    }
    let best: { wallId: string; foot: Point; gap: number } | null = null
    for (const wall of level.walls) {
      if (wall.id === end.wallId) {
        continue
      }
      const a = pointOf(vertices, wall.a)
      const b = pointOf(vertices, wall.b)
      const foot = footOnLine(end.point, a, b)
      if (!foot || foot.t <= 0 || foot.t >= 1) {
        continue
      }
      const gap = dist(end.point, foot.point)
      if (gap > editorTolerances.join_snap_m) {
        continue
      }
      if (dist(foot.point, a) <= editorTolerances.join_snap_m || dist(foot.point, b) <= editorTolerances.join_snap_m) {
        continue
      }
      if (!best || gap < best.gap) {
        best = { wallId: wall.id, foot: foot.point, gap }
      }
    }
    if (best) {
      cluster.host = { wallId: best.wallId, foot: best.foot }
    }
  }
}

function emptyCorners(): Corners {
  return { a: { left: null, right: null }, b: { left: null, right: null } }
}

function toRing(points: Point[]): Ring {
  return points.map((point) => [point.x, point.y] as Pair)
}

function fromRing(ring: Ring): Point[] {
  return dedupeRing(ring.map(([x, y]) => ({ x, y })))
}

export function wallPolygons(plan: Plan, levelId: string): WallPolygon[] {
  const level = levelOf(plan, levelId)
  const vertices = vertexMap(level)
  const ends: EndRef[] = []
  for (const wall of level.walls) {
    ends.push({ wallId: wall.id, end: "a", point: pointOf(vertices, wall.a) })
    ends.push({ wallId: wall.id, end: "b", point: pointOf(vertices, wall.b) })
  }
  const clusters = clusterEnds(ends)
  markJunctions(level, vertices, clusters)
  const clusterByEnd = new Map<string, Cluster>()
  for (const cluster of clusters) {
    for (const end of cluster.ends) {
      clusterByEnd.set(`${end.wallId}:${end.end}`, cluster)
    }
  }

  const geomEnd = (wallId: string, end: EndName): Point => {
    const cluster = clusterByEnd.get(`${wallId}:${end}`)
    if (!cluster) {
      throw new Error(`Missing join for ${wallId}`)
    }
    return cluster.host?.foot ?? cluster.joint
  }

  const corners = new Map<string, Corners>()
  for (const wall of level.walls) {
    corners.set(wall.id, emptyCorners())
  }

  for (const cluster of clusters) {
    if (cluster.host || cluster.ends.length < 2) {
      continue
    }
    joinCluster(level, geomEnd, cluster, corners)
  }

  const hub = (wallId: string, end: EndName): Point | null => {
    const cluster = clusterByEnd.get(`${wallId}:${end}`)
    return cluster && !cluster.host && cluster.ends.length >= 3 ? cluster.joint : null
  }

  const polygons: WallPolygon[] = []
  for (const wall of level.walls) {
    const ring = squareOrJoined(wall, geomEnd, hub, corners.get(wall.id) as Corners)
    if (ring) {
      polygons.push({ wallId: wall.id, ring })
    }
  }

  for (const cluster of clusters) {
    if (!cluster.host) {
      continue
    }
    const butt = cluster.ends[0]
    if (!butt) {
      continue
    }
    const buttPoly = polygons.find((polygon) => polygon.wallId === butt.wallId)
    const hostPoly = polygons.find((polygon) => polygon.wallId === cluster.host?.wallId)
    if (!buttPoly || !hostPoly) {
      continue
    }
    const clipped = difference([toRing(buttPoly.ring)] as Polygon, [toRing(hostPoly.ring)] as Polygon)
    let best: Point[] | null = null
    let bestArea = -1
    for (const polygon of clipped) {
      const outer = polygon[0]
      if (!outer) {
        continue
      }
      const ring = fromRing(outer)
      const area = Math.abs(ringArea(ring))
      if (area > bestArea) {
        best = ring
        bestArea = area
      }
    }
    if (best && best.length >= 3) {
      buttPoly.ring = best
    }
  }

  return polygons
}

function ringArea(ring: Point[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (!a || !b) {
      continue
    }
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

/**
 * Where three or more walls meet, each ring passes through the joint so the
 * union has no gap between collinear neighbours.
 */
function squareOrJoined(
  wall: Wall,
  geomEnd: (wallId: string, end: EndName) => Point,
  hub: (wallId: string, end: EndName) => Point | null,
  corners: Corners,
): Point[] | null {
  const a = geomEnd(wall.id, "a")
  const b = geomEnd(wall.id, "b")
  const direction = unit(sub(b, a))
  if (direction.x === 0 && direction.y === 0) {
    return null
  }
  const half = wall.thickness / 2
  const normal = left(direction)
  const cap = (end: EndName, side: SideName): Point => {
    const origin = end === "a" ? a : b
    const sign = side === "left" ? 1 : -1
    return add(origin, mul(normal, sign * half))
  }
  const hubA = hub(wall.id, "a")
  const hubB = hub(wall.id, "b")
  const ring = dedupeRing([
    corners.a.right ?? cap("a", "right"),
    corners.b.right ?? cap("b", "right"),
    ...(hubB ? [hubB] : []),
    corners.b.left ?? cap("b", "left"),
    corners.a.left ?? cap("a", "left"),
    ...(hubA ? [hubA] : []),
  ])
  return ring.length >= 3 ? ring : null
}

type HalfEdge = {
  wallId: string
  end: EndName
  dir: Point
  half: number
  thickness: number
  angle: number
}

function joinCluster(
  level: Level,
  geomEnd: (wallId: string, end: EndName) => Point,
  cluster: Cluster,
  corners: Map<string, Corners>,
) {
  const edges: HalfEdge[] = []
  for (const end of cluster.ends) {
    const wall = level.walls.find((item) => item.id === end.wallId)
    if (!wall) {
      continue
    }
    const here = cluster.joint
    const other = geomEnd(wall.id, end.end === "a" ? "b" : "a")
    const dir = unit(sub(other, here))
    if (dir.x === 0 && dir.y === 0) {
      continue
    }
    edges.push({
      wallId: wall.id,
      end: end.end,
      dir,
      half: wall.thickness / 2,
      thickness: wall.thickness,
      angle: Math.atan2(dir.y, dir.x),
    })
  }
  edges.sort((a, b) => a.angle - b.angle)
  if (edges.length < 2) {
    return
  }
  for (let i = 0; i < edges.length; i += 1) {
    const start = edges[i]
    const next = edges[(i + 1) % edges.length]
    if (!start || !next) {
      continue
    }
    const startPoint = add(cluster.joint, mul(left(start.dir), start.half))
    const nextPoint = add(cluster.joint, mul(right(next.dir), next.half))
    const hit = lineIntersect(startPoint, start.dir, nextPoint, next.dir)
    const limit = editorTolerances.miter_limit * Math.min(start.thickness, next.thickness)
    const useMiter = hit !== null && dist(hit, cluster.joint) <= limit
    assignSide(corners, start, "left", useMiter && hit ? hit : startPoint)
    assignSide(corners, next, "right", useMiter && hit ? hit : nextPoint)
  }
}

function assignSide(corners: Map<string, Corners>, edge: HalfEdge, sideOfOutgoing: "left" | "right", point: Point) {
  const box = corners.get(edge.wallId)
  if (!box) {
    return
  }
  const wallSide: SideName =
    (edge.end === "a" && sideOfOutgoing === "left") || (edge.end === "b" && sideOfOutgoing === "right") ? "left" : "right"
  box[edge.end][wallSide] = point
}

export function maxJoinSpikeM(plan: Plan, levelId: string, polygons: readonly WallPolygon[]): number {
  const level = levelOf(plan, levelId)
  const vertices = vertexMap(level)
  const ends: EndRef[] = []
  for (const wall of level.walls) {
    ends.push({ wallId: wall.id, end: "a", point: pointOf(vertices, wall.a) })
    ends.push({ wallId: wall.id, end: "b", point: pointOf(vertices, wall.b) })
  }
  const clusters = clusterEnds(ends)
  let max = 0
  for (const cluster of clusters) {
    for (const end of cluster.ends) {
      const wall = level.walls.find((item) => item.id === end.wallId)
      const polygon = polygons.find((item) => item.wallId === end.wallId)
      if (!wall || !polygon) {
        continue
      }
      const otherId = end.end === "a" ? wall.b : wall.a
      const other = pointOf(vertices, otherId)
      for (const point of polygon.ring) {
        if (dist(point, cluster.joint) > dist(point, other)) {
          continue
        }
        max = Math.max(max, dist(point, cluster.joint))
      }
    }
  }
  return max
}

export function wallUnion(polygons: readonly WallPolygon[]): Polygon[] {
  if (polygons.length === 0) {
    return []
  }
  const geoms = polygons.map((polygon) => [toRing(polygon.ring)] as Polygon)
  const first = geoms[0]
  if (!first) {
    return []
  }
  return union(first, ...geoms.slice(1))
}

export function freeFaces(polygons: readonly WallPolygon[]): Point[][] {
  const faces: Point[][] = []
  for (const polygon of wallUnion(polygons)) {
    for (const hole of polygon.slice(1)) {
      const ring = fromRing(hole)
      if (ring.length >= 3) {
        faces.push(ring)
      }
    }
  }
  return faces
}
