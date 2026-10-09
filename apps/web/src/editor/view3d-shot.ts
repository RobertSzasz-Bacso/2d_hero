import * as THREE from "three"

/** Floor rectangle of the model, used when the zoomed camera no longer sees the floor. */
export function modelFootprint(bounds: THREE.Box3, floorZ: number, margin: number): THREE.Vector3[] {
  if (bounds.isEmpty()) {
    return []
  }
  const minX = bounds.min.x - margin
  const maxX = bounds.max.x + margin
  const minY = bounds.min.y - margin
  const maxY = bounds.max.y + margin
  return [
    new THREE.Vector3(minX, minY, floorZ),
    new THREE.Vector3(maxX, minY, floorZ),
    new THREE.Vector3(maxX, maxY, floorZ),
    new THREE.Vector3(minX, maxY, floorZ),
  ]
}

/** Keep a complete view patch. Otherwise frame the model so a zoomed-in click still has a picture. */
export function floorCorners(hits: THREE.Vector3[], bounds: THREE.Box3, floorZ: number): THREE.Vector3[] {
  if (hits.length === 4) {
    return hits
  }
  return modelFootprint(bounds, floorZ, 0.05)
}
