import { moveWall, setOpening, setRoomName, setWallThickness, type OpeningPatch } from "./ops.ts"
import type { Opening, Plan } from "./plan-types.ts"

export type AiOp =
  | { op: "set_wall_thickness"; levelId: string; wallId: string; thickness: number }
  | { op: "move_wall"; levelId: string; wallId: string; dx: number; dy: number }
  | {
      op: "set_opening"
      levelId: string
      openingId: string
      kind?: Opening["kind"]
      offset?: number
      width?: number
      sill?: number
      head?: number
      swing?: Opening["swing"]
      swingSide?: Opening["swingSide"]
      confidence?: number
    }
  | { op: "set_room_name"; levelId: string; roomId: string; name: string; number?: string }

export function applyAiOps(plan: Plan, ops: AiOp[]): Plan {
  let next = plan
  for (const op of ops) {
    next = applyOne(next, op)
  }
  return next
}

export function changedWallIds(before: Plan, after: Plan): Set<string> {
  const ids = new Set<string>()
  for (const level of before.levels) {
    const nextLevel = after.levels.find((item) => item.id === level.id)
    if (!nextLevel) {
      continue
    }
    const beforeVertices = new Map(level.vertices.map((vertex) => [vertex.id, vertex]))
    const afterVertices = new Map(nextLevel.vertices.map((vertex) => [vertex.id, vertex]))
    for (const wall of level.walls) {
      const other = nextLevel.walls.find((item) => item.id === wall.id)
      if (!other || other.thickness !== wall.thickness || other.a !== wall.a || other.b !== wall.b) {
        ids.add(wall.id)
        continue
      }
      for (const vertexId of [wall.a, wall.b]) {
        const start = beforeVertices.get(vertexId)
        const end = afterVertices.get(vertexId)
        if (!start || !end || start.x !== end.x || start.y !== end.y) {
          ids.add(wall.id)
        }
      }
    }
  }
  return ids
}

function applyOne(plan: Plan, op: AiOp): Plan {
  if (op.op === "set_wall_thickness") {
    return setWallThickness(plan, op.levelId, op.wallId, op.thickness)
  }
  if (op.op === "move_wall") {
    return moveWall(plan, op.levelId, op.wallId, { x: op.dx, y: op.dy })
  }
  if (op.op === "set_room_name") {
    return setRoomName(plan, op.levelId, op.roomId, op.name, op.number)
  }
  const patch: OpeningPatch = {}
  if (op.kind !== undefined) {
    patch.kind = op.kind
  }
  if (op.offset !== undefined) {
    patch.offset = op.offset
  }
  if (op.width !== undefined) {
    patch.width = op.width
  }
  if (op.sill !== undefined) {
    patch.sill = op.sill
  }
  if (op.head !== undefined) {
    patch.head = op.head
  }
  if (op.swing !== undefined) {
    patch.swing = op.swing
  }
  if (op.swingSide !== undefined) {
    patch.swingSide = op.swingSide
  }
  if (op.confidence !== undefined) {
    patch.confidence = op.confidence
  }
  return setOpening(plan, op.levelId, op.openingId, patch)
}
