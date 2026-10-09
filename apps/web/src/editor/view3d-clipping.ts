import * as THREE from "three"

type MaterialObject = THREE.Object3D & {
  material?: THREE.Material | THREE.Material[]
}

/** Clip the camera-facing part of an object at a distance along the camera's view direction. */
export function applyCameraClip(object: THREE.Object3D, camera: THREE.Camera, distance: number): THREE.Plane | null {
  if (distance <= 0) {
    clearClip(object)
    return null
  }
  const plane = updateCameraClip(new THREE.Plane(), camera, distance)
  applyClipPlane(object, plane)
  return plane
}

export function updateCameraClip(plane: THREE.Plane, camera: THREE.Camera, distance: number): THREE.Plane {
  const direction = camera.getWorldDirection(new THREE.Vector3())
  const point = camera.position.clone().addScaledVector(direction, distance)
  return plane.setFromNormalAndCoplanarPoint(direction, point)
}

export function applyClipPlane(object: THREE.Object3D, plane: THREE.Plane): void {
  object.traverse((child) => {
    for (const material of materialsOf(child)) {
      material.clippingPlanes = [plane]
      material.needsUpdate = true
    }
  })
}

export function clearClip(object: THREE.Object3D): void {
  object.traverse((child) => {
    for (const material of materialsOf(child)) {
      material.clippingPlanes = []
      material.needsUpdate = true
    }
  })
}

function materialsOf(object: THREE.Object3D): THREE.Material[] {
  const material = (object as MaterialObject).material
  if (!material) {
    return []
  }
  return Array.isArray(material) ? material : [material]
}
