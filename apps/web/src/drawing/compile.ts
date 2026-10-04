import { symbolPolylines } from "@/editor/symbols.ts"
import { add, left, mul, rotate, sub, unit } from "@/core/geom.ts"
import type { Level, Plan, Point, TitleBlock } from "@/core/plan-types.ts"
import { wallPolygons } from "@/core/wall-polygons.ts"
import {
  buildScene,
  columnRing,
  dimensionEndpoint,
  formatDimension,
  openingGraphics,
  openingRect,
  placeSymbol,
  THIN_MM,
  VISIBLE_MM,
  type SceneItem,
} from "./scene.ts"

export { formatDimension }

const PORTRAIT_MM = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A2: { width: 420, height: 594 },
  A1: { width: 594, height: 841 },
} as const

const SCALES = [50, 100, 200] as const

export type Scale = (typeof SCALES)[number]

export type DrawCommand =
  | {
      op: "fill"
      role: "poche"
      rings: Point[][]
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
    const scene = buildScene(input.plan, input.level, { scale, unit: input.unit, hideFurniture: input.options.hideFurniture === true })
    commands.push(...scene.map((item) => toCommand(item, map)))
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

function toCommand(item: SceneItem, map: (point: Point) => Point): DrawCommand {
  if (item.type === "fill") {
    return { op: "fill", role: "poche", rings: item.rings.map((ring) => ring.map(map)), clipped: true }
  }
  if (item.type === "stroke") {
    return stroke(item.points.map(map), item.role, item.weightMm, item.closed, true, item.dashMm)
  }
  const at = map(item.at)
  return text(at.x, at.y + item.liftMm, item.text, item.heightMm, item.role, item.rotationDeg, "middle", true)
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

function contentBounds(plan: Plan, level: Level, hideFurniture: boolean): Bounds {
  const points: Point[] = []
  for (const polygon of wallPolygons(plan, level.id)) {
    points.push(...polygon.ring)
    for (const opening of level.openings.filter((item) => item.wall === polygon.wallId)) {
      const rect = openingRect(level, opening)
      if (rect) {
        points.push(...rect)
      }
      for (const item of openingGraphics(level, opening)) {
        points.push(...item.points)
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
      const a = dimensionEndpoint(level, segment.a)
      const b = dimensionEndpoint(level, segment.b)
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
