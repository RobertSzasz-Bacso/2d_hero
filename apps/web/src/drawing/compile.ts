import { difference, type Polygon, type Ring } from "polygon-clipping"
import { openingEnds } from "@/editor/metrics.ts"
import { symbolPolylines } from "@/editor/symbols.ts"
import { add, dedupeRing, left, mul, rotate, sub, unit } from "@/core/geom.ts"
import type { Level, Plan, Point, TitleBlock } from "@/core/plan-types.ts"
import { roomLabelPoint } from "@/core/dimensions.ts"
import { extractRooms } from "@/core/rooms.ts"
import { wallPolygons } from "@/core/wall-polygons.ts"

const PORTRAIT_MM = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A2: { width: 420, height: 594 },
  A1: { width: 594, height: 841 },
} as const

const SCALES = [50, 100, 200] as const

const CUT_MM = 0.5
const VISIBLE_MM = 0.25
const THIN_MM = 0.13
const POCHE_OPACITY = 0.35

export type Scale = (typeof SCALES)[number]

export type DrawCommand =
  | {
      op: "fill"
      role: "poche"
      rings: Point[][]
      opacity: number
      clipped: boolean
    }
  | {
      op: "stroke"
      role: "cut-wall" | "visible" | "thin" | "separator" | "frame"
      points: Point[]
      strokeMm: number
      closed?: boolean
      dashMm?: number[]
      clipped: boolean
    }
  | {
      op: "text"
      role: "dimension" | "room" | "title" | "note"
      x: number
      y: number
      text: string
      heightMm: number
      rotationDeg: number
      anchor: "start" | "middle"
      clipped: boolean
    }

export type CompiledSheet = {
  paper: Plan["sheet"]["paper"]
  orientation: Plan["sheet"]["orientation"]
  widthMm: number
  heightMm: number
  scale: Scale
  sheetNumber: string
  commands: DrawCommand[]
  clip: { x: number; y: number; width: number; height: number }
}

export type CompileResult = {
  fits: boolean
  nextScale: Scale | null
  sheets: CompiledSheet[]
}

export type CompileOptions = {
  scale?: Scale
  tile?: boolean
  dimensionUnit?: "cm" | "mm"
  levelId?: string
  hideFurniture?: boolean
  titleDefaults?: Partial<TitleBlock>
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

type Frame = {
  inner: Bounds
  title: { x: number; y: number; w: number; h: number }
  drawable: Bounds
}

export function formatDimension(metres: number, unit: "cm" | "mm"): string {
  const factor = unit === "mm" ? 1000 : 100
  return String(Math.round(metres * factor))
}

export function nextSmallerScale(scale: Scale): Scale | null {
  const index = SCALES.indexOf(scale)
  return SCALES[index + 1] ?? null
}

export function compilePlan(plan: Plan, options: CompileOptions = {}): CompileResult {
  const scale = options.scale ?? plan.sheet.scale
  const unit = options.dimensionUnit ?? "cm"
  const paper = paperSize(plan.sheet.paper, plan.sheet.orientation)
  const frame = sheetFrame(paper.width, paper.height)
  const level = pickLevel(plan, options.levelId)
  const bounds = level ? contentBounds(plan, level, options.hideFurniture === true) : null
  const mmPerM = 1000 / scale
  const pad = 8
  const drawableW = frame.drawable.maxX - frame.drawable.minX - pad * 2
  const drawableH = frame.drawable.maxY - frame.drawable.minY - pad * 2
  const contentW = bounds ? (bounds.maxX - bounds.minX) * mmPerM : 0
  const contentH = bounds ? (bounds.maxY - bounds.minY) * mmPerM : 0
  const fits = bounds === null || (contentW <= drawableW + 0.5 && contentH <= drawableH + 0.5)
  const windows = bounds ? tileWindows(bounds, mmPerM, drawableW, drawableH, options.tile === true) : [null]
  const sheets = windows.map((window, index) => {
    const sheetNumber = windows.length > 1 ? `${titleValue(plan, options, "sheetNumber")}${sheetSuffix(index)}` : titleValue(plan, options, "sheetNumber")
    return buildSheet({
      plan,
      options,
      level,
      scale,
      unit,
      paper,
      frame,
      bounds,
      window,
      sheetNumber,
      pad,
    })
  })
  return { fits, nextScale: nextSmallerScale(scale), sheets }
}

function paperSize(paper: Plan["sheet"]["paper"], orientation: Plan["sheet"]["orientation"]) {
  const portrait = PORTRAIT_MM[paper]
  if (orientation === "landscape") {
    return { width: portrait.height, height: portrait.width }
  }
  return { width: portrait.width, height: portrait.height }
}

function sheetFrame(width: number, height: number): Frame {
  const inner = { minX: 20, minY: 10, maxX: width - 10, maxY: height - 10 }
  const title = { x: inner.maxX - 180, y: inner.minY, w: 180, h: 50 }
  return {
    inner,
    title,
    drawable: {
      minX: inner.minX,
      minY: inner.minY + title.h,
      maxX: inner.maxX,
      maxY: inner.maxY,
    },
  }
}

function pickLevel(plan: Plan, levelId: string | undefined): Level | null {
  if (plan.levels.length === 0) {
    return null
  }
  if (levelId) {
    return plan.levels.find((level) => level.id === levelId) ?? plan.levels[0] ?? null
  }
  return plan.levels[0] ?? null
}

function sheetSuffix(index: number): string {
  let value = index
  let suffix = ""
  do {
    suffix = String.fromCharCode(97 + (value % 26)) + suffix
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return suffix
}

function tileWindows(bounds: Bounds, mmPerM: number, drawableW: number, drawableH: number, tile: boolean): (Bounds | null)[] {
  if (!tile) {
    return [null]
  }
  const contentW = (bounds.maxX - bounds.minX) * mmPerM
  const contentH = (bounds.maxY - bounds.minY) * mmPerM
  const overlap = 20
  const stepX = Math.max(1, drawableW - overlap)
  const stepY = Math.max(1, drawableH - overlap)
  const cols = Math.max(1, Math.ceil(Math.max(0, contentW - overlap) / stepX))
  const rows = Math.max(1, Math.ceil(Math.max(0, contentH - overlap) / stepY))
  const windows: Bounds[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      windows.push({
        minX: bounds.minX + (col * stepX) / mmPerM,
        minY: bounds.minY + (row * stepY) / mmPerM,
        maxX: bounds.minX + (col * stepX + drawableW) / mmPerM,
        maxY: bounds.minY + (row * stepY + drawableH) / mmPerM,
      })
    }
  }
  return windows
}

function buildSheet(input: {
  plan: Plan
  options: CompileOptions
  level: Level | null
  scale: Scale
  unit: "cm" | "mm"
  paper: { width: number; height: number }
  frame: Frame
  bounds: Bounds | null
  window: Bounds | null
  sheetNumber: string
  pad: number
}): CompiledSheet {
  const { plan, frame, paper, scale, bounds, window, pad } = input
  const mmPerM = 1000 / scale
  const view = window ?? bounds
  let originX = frame.drawable.minX + pad
  let originY = frame.drawable.minY + pad
  if (view && bounds) {
    const contentW = (bounds.maxX - bounds.minX) * mmPerM
    const contentH = (bounds.maxY - bounds.minY) * mmPerM
    const drawableW = frame.drawable.maxX - frame.drawable.minX - pad * 2
    const drawableH = frame.drawable.maxY - frame.drawable.minY - pad * 2
    const shiftX = window ? 0 : Math.max(0, (drawableW - contentW) / 2)
    const shiftY = window ? 0 : Math.max(0, (drawableH - contentH) / 2)
    originX = frame.drawable.minX + pad + shiftX - view.minX * mmPerM
    originY = frame.drawable.minY + pad + shiftY - view.minY * mmPerM
  }
  const map = (point: Point): Point => ({ x: originX + point.x * mmPerM, y: originY + point.y * mmPerM })
  const commands: DrawCommand[] = []
  commands.push(...frameCommands(plan, input.options, frame, scale, input.unit, input.sheetNumber))
  if (input.level) {
    commands.push(...modelCommands(input.plan, input.level, map, scale, input.unit, input.options.hideFurniture === true))
  }
  return {
    paper: plan.sheet.paper,
    orientation: plan.sheet.orientation,
    widthMm: paper.width,
    heightMm: paper.height,
    scale,
    sheetNumber: input.sheetNumber,
    commands,
    clip: {
      x: frame.drawable.minX,
      y: frame.drawable.minY,
      width: frame.drawable.maxX - frame.drawable.minX,
      height: frame.drawable.maxY - frame.drawable.minY,
    },
  }
}

function frameCommands(
  plan: Plan,
  options: CompileOptions,
  frame: Frame,
  scale: Scale,
  unit: "cm" | "mm",
  sheetNumber: string,
): DrawCommand[] {
  const inner = frame.inner
  return [
    stroke([
      { x: inner.minX, y: inner.minY },
      { x: inner.maxX, y: inner.minY },
      { x: inner.maxX, y: inner.maxY },
      { x: inner.minX, y: inner.maxY },
    ], "frame", VISIBLE_MM, true, false),
    ...titleBlock(plan, options, frame.title, scale, unit, sheetNumber),
    ...northArrow(plan.project.northAngleDeg, inner),
    ...scaleBar(scale, inner, frame.title.x),
  ]
}

function titleValue(plan: Plan, options: CompileOptions, key: keyof TitleBlock): string {
  const own = plan.sheet.titleBlock[key].trim()
  if (own.length > 0) {
    return plan.sheet.titleBlock[key]
  }
  const fallback = options.titleDefaults?.[key]
  return fallback?.trim() ? fallback : ""
}

function titleBlock(
  plan: Plan,
  options: CompileOptions,
  box: { x: number; y: number; w: number; h: number },
  scale: Scale,
  unit: "cm" | "mm",
  sheetNumber: string,
): DrawCommand[] {
  const commands: DrawCommand[] = []
  commands.push(stroke([
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ], "frame", VISIBLE_MM, true, false))
  const rows: { left: string; right: string; height: number }[] = [
    { left: titleValue(plan, options, "project"), right: titleValue(plan, options, "address"), height: 3.5 },
    { left: titleValue(plan, options, "sheetTitle"), right: titleValue(plan, options, "company"), height: 2.5 },
    { left: titleValue(plan, options, "drawnBy"), right: titleValue(plan, options, "date"), height: 2.5 },
    { left: `1:${scale}`, right: sheetNumber, height: 2.5 },
    { left: titleValue(plan, options, "revisionNote"), right: unit === "mm" ? "Dimensions in mm" : "Dimensions in cm", height: 2.5 },
  ]
  let y = box.y + box.h - 4
  for (const row of rows) {
    if (row.left.length > 0) {
      commands.push(text(box.x + 3, y, row.left, row.height, "title", 0, "start", false))
    }
    if (row.right.length > 0) {
      commands.push(text(box.x + box.w / 2 + 2, y, row.right, row.height, "title", 0, "start", false))
    }
    y -= 8
  }
  return commands
}

function northArrow(angleDeg: number, inner: Bounds): DrawCommand[] {
  const origin = { x: inner.maxX - 14, y: inner.maxY - 18 }
  const tip = add(origin, rotate({ x: 0, y: 8 }, angleDeg))
  const leftWing = add(origin, rotate({ x: -2.2, y: 2.5 }, angleDeg))
  const rightWing = add(origin, rotate({ x: 2.2, y: 2.5 }, angleDeg))
  const label = add(origin, rotate({ x: 0, y: 11 }, angleDeg))
  return [
    stroke([origin, tip], "visible", VISIBLE_MM, false, false),
    stroke([leftWing, tip, rightWing], "visible", VISIBLE_MM, false, false),
    text(label.x, label.y, "N", 3.5, "note", angleDeg, "middle", false),
  ]
}

function scaleBar(scale: Scale, inner: Bounds, titleX: number): DrawCommand[] {
  const mmPerM = 1000 / scale
  const available = titleX - inner.minX - 12
  const metres = [10, 5, 2, 1].find((length) => length * mmPerM <= available) ?? 1
  const lengthMm = metres * mmPerM
  const x = inner.minX + 4
  const y = inner.minY + 8
  return [
    stroke([{ x, y }, { x: x + lengthMm, y }], "thin", THIN_MM, false, false),
    stroke([{ x, y: y - 1.5 }, { x, y: y + 1.5 }], "thin", THIN_MM, false, false),
    stroke([{ x: x + lengthMm, y: y - 1.5 }, { x: x + lengthMm, y: y + 1.5 }], "thin", THIN_MM, false, false),
    text(x + lengthMm / 2, y + 3.2, `${metres} m`, 2.5, "note", 0, "middle", false),
  ]
}

function modelCommands(
  plan: Plan,
  level: Level,
  map: (point: Point) => Point,
  scale: Scale,
  unit: "cm" | "mm",
  hideFurniture: boolean,
): DrawCommand[] {
  const commands: DrawCommand[] = []
  for (const polygon of wallPolygons(plan, level.id)) {
    const holes = level.openings
      .filter((opening) => opening.wall === polygon.wallId)
      .map((opening) => openingRect(level, opening))
      .filter((ring): ring is Point[] => ring !== null)
    for (const piece of cutRing(polygon.ring, holes)) {
      commands.push({
        op: "fill",
        role: "poche",
        rings: [piece.outer, ...piece.holes].map((ring) => ring.map(map)),
        opacity: POCHE_OPACITY,
        clipped: true,
      })
      commands.push(stroke(piece.outer.map(map), "cut-wall", CUT_MM, true, true))
      for (const hole of piece.holes) {
        commands.push(stroke(hole.map(map), "cut-wall", CUT_MM, true, true))
      }
    }
  }
  for (const opening of level.openings) {
    commands.push(...openingGraphics(level, opening, map))
  }
  for (const column of level.columns) {
    const ring = columnRing(column).map(map)
    commands.push({ op: "fill", role: "poche", rings: [ring], opacity: POCHE_OPACITY, clipped: true })
    commands.push(stroke(ring, "cut-wall", CUT_MM, true, true))
  }
  for (const stair of level.stairs) {
    commands.push(...stairGraphics(level, stair, map))
  }
  for (const fixture of level.fixtures) {
    if (hideFurniture && fixture.role === "furniture") {
      continue
    }
    const dashed = fixture.symbol === "block"
    for (const line of symbolPolylines(fixture.symbol)) {
      const placed = line.map((point) => map(placeSymbol(fixture, point)))
      commands.push(stroke(placed, "visible", VISIBLE_MM, false, true, dashed ? [2, 1] : undefined))
    }
  }
  const vertices = new Map(level.vertices.map((vertex) => [vertex.id, { x: vertex.x, y: vertex.y }]))
  for (const separator of level.separators) {
    const a = vertices.get(separator.a)
    const b = vertices.get(separator.b)
    if (!a || !b) {
      continue
    }
    commands.push(stroke([map(a), map(b)], "separator", THIN_MM, false, true, [4, 1, 0.5, 1]))
  }
  for (const dimension of level.dimensions) {
    commands.push(...dimensionGraphics(level, dimension, map, scale, unit))
  }
  for (const room of extractRooms(plan, level.id).rooms) {
    commands.push(...roomTag(room.polygon, room.name, room.number, room.area, map))
  }
  for (const note of level.texts) {
    const at = map({ x: note.x, y: note.y })
    commands.push(text(at.x, at.y, note.text, note.heightM * (1000 / scale), "note", 0, "middle", true))
  }
  return commands
}

function openingRect(level: Level, opening: Level["openings"][number]): Point[] | null {
  const ends = openingEnds(level, opening)
  const wall = level.walls.find((item) => item.id === opening.wall)
  if (!ends || !wall) {
    return null
  }
  const direction = unit(sub(ends.b, ends.a))
  if (direction.x === 0 && direction.y === 0) {
    return null
  }
  const normal = left(direction)
  const half = wall.thickness / 2 + 0.002
  return [
    add(ends.a, mul(normal, half)),
    add(ends.b, mul(normal, half)),
    add(ends.b, mul(normal, -half)),
    add(ends.a, mul(normal, -half)),
  ]
}

function openingGraphics(level: Level, opening: Level["openings"][number], map: (point: Point) => Point): DrawCommand[] {
  const ends = openingEnds(level, opening)
  const wall = level.walls.find((item) => item.id === opening.wall)
  if (!ends || !wall) {
    return []
  }
  const direction = unit(sub(ends.b, ends.a))
  if (direction.x === 0 && direction.y === 0) {
    return []
  }
  const normal = left(direction)
  const side = opening.swingSide === "positive" ? 1 : -1
  const swing = mul(normal, side)
  if (opening.kind === "window") {
    const half = wall.thickness / 2
    return [
      stroke([map(add(ends.a, mul(normal, half))), map(add(ends.b, mul(normal, half)))], "visible", VISIBLE_MM, false, true),
      stroke([map(add(ends.a, mul(normal, -half))), map(add(ends.b, mul(normal, -half)))], "visible", VISIBLE_MM, false, true),
      stroke([map(ends.a), map(ends.b)], "thin", THIN_MM, false, true),
    ]
  }
  if (opening.kind !== "door" || opening.swing === "none") {
    return []
  }
  if (opening.swing === "sliding") {
    const rect = [
      add(ends.a, mul(swing, 0.02)),
      add(ends.b, mul(swing, 0.02)),
      add(ends.b, mul(swing, 0.08)),
      add(ends.a, mul(swing, 0.08)),
    ]
    return [stroke(rect.map(map), "visible", VISIBLE_MM, true, true)]
  }
  const hinges = opening.swing === "double" ? [ends.a, ends.b] : opening.swing === "right" ? [ends.b] : [ends.a]
  const leaf = opening.swing === "double" ? opening.width / 2 : opening.width
  const commands: DrawCommand[] = []
  for (const hinge of hinges) {
    const other = hinge === ends.a ? ends.b : ends.a
    const closed = unit(sub(other, hinge))
    const openEnd = add(hinge, mul(swing, leaf))
    commands.push(stroke([map(hinge), map(openEnd)], "visible", VISIBLE_MM, false, true))
    commands.push(stroke(arcPoints(hinge, closed, swing, leaf).map(map), "thin", THIN_MM, false, true))
  }
  return commands
}

function arcPoints(origin: Point, from: Point, to: Point, radius: number): Point[] {
  const start = Math.atan2(from.y, from.x)
  let delta = Math.atan2(to.y, to.x) - start
  while (delta > Math.PI) {
    delta -= Math.PI * 2
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2
  }
  const points: Point[] = []
  for (let step = 0; step <= 8; step += 1) {
    const angle = start + (delta * step) / 8
    points.push({ x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius })
  }
  return points
}

function columnRing(column: Level["columns"][number]): Point[] {
  const halfW = column.width / 2
  const halfD = column.depth / 2
  const corners = [
    { x: -halfW, y: -halfD },
    { x: halfW, y: -halfD },
    { x: halfW, y: halfD },
    { x: -halfW, y: halfD },
  ]
  return corners.map((corner) => add({ x: column.x, y: column.y }, rotate(corner, column.rotationDeg)))
}

function stairGraphics(level: Level, stair: Level["stairs"][number], map: (point: Point) => Point): DrawCommand[] {
  const commands: DrawCommand[] = []
  if (stair.outline.length >= 2) {
    commands.push(stroke(stair.outline.map(map), "visible", VISIBLE_MM, true, true))
  }
  const direction = unit(stair.direction)
  if ((direction.x === 0 && direction.y === 0) || stair.outline.length === 0) {
    return commands
  }
  const normal = left(direction)
  let minU = Number.POSITIVE_INFINITY
  let maxU = Number.NEGATIVE_INFINITY
  let minV = Number.POSITIVE_INFINITY
  let maxV = Number.NEGATIVE_INFINITY
  for (const point of stair.outline) {
    const u = point.x * direction.x + point.y * direction.y
    const v = point.x * normal.x + point.y * normal.y
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }
  const count = Math.max(1, stair.riserCount)
  for (let index = 1; index < count; index += 1) {
    const u = minU + ((maxU - minU) * index) / count
    const a = add(mul(direction, u), mul(normal, minV))
    const b = add(mul(direction, u), mul(normal, maxV))
    commands.push(stroke([map(a), map(b)], "thin", THIN_MM, false, true))
  }
  const midV = (minV + maxV) / 2
  const tail = add(mul(direction, minU), mul(normal, midV))
  const head = add(mul(direction, maxU), mul(normal, midV))
  commands.push(stroke([map(tail), map(head)], "visible", VISIBLE_MM, false, true))
  const headBack = add(head, mul(direction, -0.25))
  commands.push(stroke([
    map(add(headBack, mul(normal, 0.12))),
    map(head),
    map(add(headBack, mul(normal, -0.12))),
  ], "visible", VISIBLE_MM, false, true))
  if (stair.toElevation > level.ceilingHeight || stair.fromElevation < 0) {
    const u = (minU + maxU) / 2
    const zig = [0, 0.15, -0.15, 0.15, 0].map((offset, index) => {
      const along = add(mul(direction, u + (index - 2) * 0.12), mul(normal, midV + offset))
      return map(along)
    })
    commands.push(stroke(zig, "thin", THIN_MM, false, true))
  }
  return commands
}

function placeSymbol(fixture: Level["fixtures"][number], point: Point): Point {
  const scaled = { x: point.x * fixture.width, y: point.y * fixture.depth }
  return add({ x: fixture.x, y: fixture.y }, rotate(scaled, fixture.rotationDeg))
}

function dimensionGraphics(
  level: Level,
  dimension: Level["dimensions"][number],
  map: (point: Point) => Point,
  scale: Scale,
  displayUnit: "cm" | "mm",
): DrawCommand[] {
  const commands: DrawCommand[] = []
  const gapM = (2 * scale) / 1000
  const tickM = (2.5 * scale) / 1000
  for (const segment of dimension.segments) {
    const a = endpoint(level, segment.a)
    const b = endpoint(level, segment.b)
    if (!a || !b) {
      continue
    }
    const delta = sub(b, a)
    const length = Math.hypot(delta.x, delta.y)
    if (length === 0) {
      continue
    }
    const direction = unit(delta)
    const normal = left(direction)
    const offset = mul(normal, dimension.offset)
    const aLine = add(a, offset)
    const bLine = add(b, offset)
    const beyond = dimension.offset === 0 ? normal : unit(offset)
    commands.push(stroke([map(add(a, mul(beyond, gapM))), map(add(aLine, mul(beyond, gapM)))], "thin", THIN_MM, false, true))
    commands.push(stroke([map(add(b, mul(beyond, gapM))), map(add(bLine, mul(beyond, gapM)))], "thin", THIN_MM, false, true))
    commands.push(stroke([map(aLine), map(bLine)], "thin", THIN_MM, false, true))
    const tick = rotate(direction, 45)
    const half = mul(tick, tickM / 2)
    commands.push(stroke([map(sub(aLine, half)), map(add(aLine, half))], "thin", THIN_MM, false, true))
    commands.push(stroke([map(sub(bLine, half)), map(add(bLine, half))], "thin", THIN_MM, false, true))
    const mid = { x: (aLine.x + bLine.x) / 2, y: (aLine.y + bLine.y) / 2 }
    const label = add(mid, mul(beyond, (1.6 * scale) / 1000))
    const paper = map(label)
    let rotation = (Math.atan2(direction.y, direction.x) * 180) / Math.PI
    if (rotation > 90 || rotation < -90) {
      rotation -= 180
    }
    commands.push(text(paper.x, paper.y, formatDimension(length, displayUnit), 2.5, "dimension", rotation, "middle", true))
  }
  return commands
}

function endpoint(level: Level, ref: Level["dimensions"][number]["segments"][number]["a"]): Point | null {
  if (ref.type === "vertex") {
    const vertex = level.vertices.find((item) => item.id === ref.id)
    return vertex ? { x: vertex.x, y: vertex.y } : null
  }
  const opening = level.openings.find((item) => item.id === ref.id)
  if (!opening) {
    return null
  }
  const ends = openingEnds(level, opening)
  if (!ends) {
    return null
  }
  return ref.edge === "start" ? ends.a : ends.b
}

function roomTag(polygon: Point[], name: string, number: string, area: number, map: (point: Point) => Point): DrawCommand[] {
  const at = map(roomLabelPoint(polygon))
  const commands: DrawCommand[] = [
    text(at.x, at.y + 4.5, name.trim().length > 0 ? name : "Room", 5, "room", 0, "middle", true),
  ]
  if (number.trim().length > 0) {
    commands.push(text(at.x, at.y, number, 3.5, "room", 0, "middle", true))
  }
  commands.push(text(at.x, at.y - 4.5, `${area.toFixed(1)} m²`, 3.5, "room", 0, "middle", true))
  return commands
}

function contentBounds(plan: Plan, level: Level, hideFurniture: boolean): Bounds {
  const points: Point[] = []
  for (const polygon of wallPolygons(plan, level.id)) {
    points.push(...polygon.ring)
    for (const opening of level.openings.filter((item) => item.wall === polygon.wallId)) {
      const rect = openingRect(level, opening)
      if (rect) {
        points.push(...rect)
      }
      for (const command of openingGraphics(level, opening, (point) => point)) {
        if (command.op === "stroke") {
          points.push(...command.points)
        }
      }
    }
  }
  for (const column of level.columns) {
    points.push(...columnRing(column))
  }
  for (const stair of level.stairs) {
    points.push(...stair.outline)
  }
  for (const fixture of level.fixtures) {
    if (hideFurniture && fixture.role === "furniture") {
      continue
    }
    for (const line of symbolPolylines(fixture.symbol)) {
      points.push(...line.map((point) => placeSymbol(fixture, point)))
    }
  }
  const vertices = new Map(level.vertices.map((vertex) => [vertex.id, { x: vertex.x, y: vertex.y }]))
  for (const separator of level.separators) {
    const a = vertices.get(separator.a)
    const b = vertices.get(separator.b)
    if (a && b) {
      points.push(a, b)
    }
  }
  for (const dimension of level.dimensions) {
    for (const segment of dimension.segments) {
      const a = endpoint(level, segment.a)
      const b = endpoint(level, segment.b)
      if (!a || !b) {
        continue
      }
      const delta = sub(b, a)
      const length = Math.hypot(delta.x, delta.y)
      if (length === 0) {
        continue
      }
      const normal = left(unit(delta))
      points.push(add(a, mul(normal, dimension.offset)), add(b, mul(normal, dimension.offset)))
    }
  }
  for (const note of level.texts) {
    points.push({ x: note.x, y: note.y })
  }
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return { minX, minY, maxX, maxY }
}

function cutRing(ring: Point[], holes: Point[][]): { outer: Point[]; holes: Point[][] }[] {
  if (holes.length === 0) {
    const outer = dedupeRing(ring)
    return outer.length >= 3 ? [{ outer, holes: [] }] : []
  }
  let current: Polygon[] = [[toRing(ring)]]
  for (const hole of holes) {
    const next: Polygon[] = []
    const cutter: Polygon = [toRing(hole)]
    for (const polygon of current) {
      next.push(...difference(polygon, cutter))
    }
    current = next
  }
  const pieces: { outer: Point[]; holes: Point[][] }[] = []
  for (const polygon of current) {
    const outer = fromRing(polygon[0] ?? [])
    if (outer.length < 3) {
      continue
    }
    pieces.push({ outer, holes: polygon.slice(1).map((hole) => fromRing(hole)).filter((hole) => hole.length >= 3) })
  }
  return pieces
}

function toRing(points: readonly Point[]): Ring {
  return points.map((point) => [point.x, point.y])
}

function fromRing(ring: Ring): Point[] {
  return dedupeRing(ring.map(([x, y]) => ({ x: x ?? 0, y: y ?? 0 })))
}

function stroke(
  points: Point[],
  role: "cut-wall" | "visible" | "thin" | "separator" | "frame",
  strokeMm: number,
  closed: boolean,
  clipped: boolean,
  dashMm?: number[],
): DrawCommand {
  return { op: "stroke", role, points, strokeMm, closed, clipped, dashMm }
}

function text(
  x: number,
  y: number,
  value: string,
  heightMm: number,
  role: "dimension" | "room" | "title" | "note",
  rotationDeg: number,
  anchor: "start" | "middle",
  clipped: boolean,
): DrawCommand {
  return { op: "text", role, x, y, text: value, heightMm, rotationDeg, anchor, clipped }
}
