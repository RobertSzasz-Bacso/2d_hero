import { dot, sub } from "@/core/geom.ts"
import { snapRotation, type FaceKeep } from "@/core/grips.ts"
import type { Point } from "@/core/plan-types.ts"

type Frame = { a: Point; normal: Point; thickness: number }

/** Fixture rotation that points local +Y (the back) from the center toward the cursor. */
export function rotationFromGrip(center: Point, cursor: Point, free: boolean): number {
  const u = sub(cursor, center)
  const raw = (Math.atan2(-u.x, u.y) * 180) / Math.PI
  const snapped = snapRotation(raw, free)
  return ((snapped % 360) + 360) % 360
}

/**
 * Thickness from dragging one face of a wall. The opposite face stays, or with
 * `alt` the centerline stays. Rounded to the millimetre.
 */
export function faceDragThickness(frame: Frame, cursor: Point, face: "left" | "right", alt: boolean): { thickness: number; keep: FaceKeep } {
  const s = dot(sub(cursor, frame.a), frame.normal)
  const half = frame.thickness / 2
  const raw = alt ? 2 * Math.abs(s) : face === "left" ? s + half : half - s
  const thickness = Math.min(1.5, Math.max(0.01, Math.round(raw * 1000) / 1000))
  return { thickness, keep: alt ? "center" : face === "left" ? "right" : "left" }
}
