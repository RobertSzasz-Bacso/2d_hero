import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { floorCorners, modelFootprint } from "./view3d-shot.ts"

describe("zoomed furniture capture", () => {
  it("frames the model when the camera cannot see the floor", () => {
    const bounds = new THREE.Box3(new THREE.Vector3(-1, 0, -0.5), new THREE.Vector3(1, 2, 2))
    const corners = floorCorners([], bounds, 0.2)
    expect(corners).toHaveLength(4)
    expect(corners.map((point) => point.z)).toEqual([0.2, 0.2, 0.2, 0.2])
    expect(Math.min(...corners.map((point) => point.x))).toBeCloseTo(-1.05)
    expect(Math.max(...corners.map((point) => point.y))).toBeCloseTo(2.05)
  })

  it("keeps the viewed floor patch when all four corners hit", () => {
    const hits = [
      new THREE.Vector3(0, 0, 0.2),
      new THREE.Vector3(1, 0, 0.2),
      new THREE.Vector3(1, 1, 0.2),
      new THREE.Vector3(0, 1, 0.2),
    ]
    const bounds = new THREE.Box3(new THREE.Vector3(-5, -5, 0), new THREE.Vector3(5, 5, 3))
    expect(floorCorners(hits, bounds, 0.2)).toBe(hits)
  })

  it("returns no footprint for an empty view", () => {
    expect(modelFootprint(new THREE.Box3(), 0, 0.05)).toEqual([])
  })
})
