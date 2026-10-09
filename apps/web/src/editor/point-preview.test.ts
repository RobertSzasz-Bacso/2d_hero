import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { parsePointPreview, pointCloudObject } from "./point-preview.ts"

function coloredPointFile(coords: number[], colors: number[]): ArrayBuffer {
  const count = coords.length / 3
  const buffer = new ArrayBuffer(16 + count * 12 + colors.length)
  new Uint8Array(buffer, 0, 8).set([0x48, 0x45, 0x52, 0x4f, 0x50, 0x54, 0x53, 0x00])
  const view = new DataView(buffer)
  view.setUint32(8, count, true)
  view.setUint32(12, 1, true)
  new Float32Array(buffer, 16, count * 3).set(coords)
  new Uint8Array(buffer, 16 + count * 12).set(colors)
  return buffer
}

function pointFile(count: number, coords: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(16 + count * 12)
  new Uint8Array(buffer, 0, 8).set([0x48, 0x45, 0x52, 0x4f, 0x50, 0x54, 0x53, 0x00])
  const view = new DataView(buffer)
  view.setUint32(8, count, true)
  view.setUint32(12, 0, true)
  new Float32Array(buffer, 16, count * 3).set(coords)
  return buffer
}

describe("parsePointPreview", () => {
  it("reads little-endian XYZ after the 16-byte HEROPTS header", () => {
    const parsed = parsePointPreview(pointFile(2, [1, 2, 3, 4, 5, 6]))
    expect(parsed).not.toBeNull()
    expect(parsed?.colors).toBeNull()
    expect(Array.from(parsed?.positions ?? [])).toEqual([1, 2, 3, 4, 5, 6])
    const cloud = pointCloudObject(parsed?.positions ?? new Float32Array(), null, 7)
    expect((cloud.children[0] as THREE.Points).material).toMatchObject({ size: 7, sizeAttenuation: false })
    const box = new THREE.Box3().setFromObject(cloud)
    expect(box.min.x).toBeCloseTo(1)
    expect(box.max.x).toBeCloseTo(4)
    expect(box.min.z).toBeCloseTo(3)
    expect(box.max.z).toBeCloseTo(6)
  })

  it("reads uint8 RGB when the color flag is set", () => {
    const parsed = parsePointPreview(coloredPointFile([1, 2, 3, 4, 5, 6], [255, 0, 0, 0, 0, 255]))
    expect(Array.from(parsed?.colors ?? [])).toEqual([255, 0, 0, 0, 0, 255])
    const cloud = pointCloudObject(parsed?.positions ?? new Float32Array(), parsed?.colors ?? null)
    const points = cloud.children[0] as THREE.Points
    const material = points.material as THREE.PointsMaterial
    const color = points.geometry.getAttribute("color")
    expect(material.vertexColors).toBe(true)
    expect(color.getX(0)).toBeCloseTo(1)
    expect(color.getZ(1)).toBeCloseTo(1)
  })

  it("rejects a GLB payload", () => {
    const buffer = new ArrayBuffer(32)
    new Uint8Array(buffer).set([0x67, 0x6c, 0x54, 0x46])
    expect(parsePointPreview(buffer)).toBeNull()
  })
})
