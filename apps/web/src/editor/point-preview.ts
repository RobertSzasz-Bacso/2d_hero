import * as THREE from "three"

const MAGIC = [0x48, 0x45, 0x52, 0x4f, 0x50, 0x54, 0x53, 0x00]
export const POINT_SIZE_MIN_PX = 1
export const POINT_SIZE_MAX_PX = 10
export const DEFAULT_POINT_SIZE_PX = 4

export type PointPreview = {
  positions: Float32Array
  colors: Uint8Array | null
}

/** Little-endian XYZ from a `HEROPTS` preview. Flags 1 adds uint8 RGB. A mesh preview returns null. */
export function parsePointPreview(buffer: ArrayBuffer): PointPreview | null {
  if (buffer.byteLength < 16) {
    return null
  }
  const magic = new Uint8Array(buffer, 0, 8)
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (magic[index] !== MAGIC[index]) {
      return null
    }
  }
  const view = new DataView(buffer)
  const count = view.getUint32(8, true)
  const flags = view.getUint32(12, true)
  if (count === 0 || buffer.byteLength < 16 + count * 12) {
    return null
  }
  const positions = new Float32Array(buffer, 16, count * 3)
  if (flags !== 1) {
    return { positions, colors: null }
  }
  const colorStart = 16 + count * 12
  const colorBytes = count * 3
  if (buffer.byteLength < colorStart + colorBytes) {
    return { positions, colors: null }
  }
  return { positions, colors: new Uint8Array(buffer, colorStart, colorBytes) }
}

/** A fitted cloud. Point size is in pixels so a room stays visible when the camera frames it. */
export function pointCloudObject(
  positions: Float32Array,
  colors: Uint8Array | null = null,
  pointSize = DEFAULT_POINT_SIZE_PX,
): THREE.Group {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  const size = Math.min(POINT_SIZE_MAX_PX, Math.max(POINT_SIZE_MIN_PX, pointSize))
  const material = new THREE.PointsMaterial({ color: "#e2e8f0", size, sizeAttenuation: false })
  const colored = colors !== null && colors.length === positions.length
  if (colored && colors) {
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3, true))
    material.vertexColors = true
    material.color.set("#ffffff")
  }
  const points = new THREE.Points(geometry, material)
  const group = new THREE.Group()
  group.name = "point-preview"
  group.userData.colored = colored
  group.add(points)
  return group
}
