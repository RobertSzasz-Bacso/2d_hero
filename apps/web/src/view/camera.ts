import type { Point } from "@/core/plan-types.ts"

/**
 * Screen mapping for the plan. Plan Y is up. Screen Y is down.
 * This is the only place that flip is applied.
 */
export type Camera = {
  pixelsPerMeter: number
  originX: number
  originY: number
}

export type Bounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function planToScreen(camera: Camera, point: Point): Point {
  return {
    x: camera.originX + point.x * camera.pixelsPerMeter,
    y: camera.originY - point.y * camera.pixelsPerMeter,
  }
}

export function screenToPlan(camera: Camera, point: Point): Point {
  return {
    x: (point.x - camera.originX) / camera.pixelsPerMeter,
    y: (camera.originY - point.y) / camera.pixelsPerMeter,
  }
}

/** Zoom while keeping the plan point under `cursor` fixed on screen. */
export function zoomAtCursor(camera: Camera, cursor: Point, factor: number): Camera {
  const plan = screenToPlan(camera, cursor)
  const pixelsPerMeter = camera.pixelsPerMeter * factor
  return {
    pixelsPerMeter,
    originX: cursor.x - plan.x * pixelsPerMeter,
    originY: cursor.y + plan.y * pixelsPerMeter,
  }
}

export function panCamera(camera: Camera, dx: number, dy: number): Camera {
  return {
    pixelsPerMeter: camera.pixelsPerMeter,
    originX: camera.originX + dx,
    originY: camera.originY + dy,
  }
}

export function fitCamera(bounds: Bounds, viewport: { width: number; height: number }, padding: number): Camera {
  const spanX = Math.max(bounds.maxX - bounds.minX, 0.01)
  const spanY = Math.max(bounds.maxY - bounds.minY, 0.01)
  const width = Math.max(viewport.width - padding * 2, 1)
  const height = Math.max(viewport.height - padding * 2, 1)
  const pixelsPerMeter = Math.min(width / spanX, height / spanY)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return {
    pixelsPerMeter,
    originX: viewport.width / 2 - centerX * pixelsPerMeter,
    originY: viewport.height / 2 + centerY * pixelsPerMeter,
  }
}

export function boundsOfPoints(points: readonly Point[]): Bounds | null {
  if (points.length === 0) {
    return null
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
