import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { applyCameraClip, clearClip } from "./view3d-clipping.ts"

describe("3D preview clipping", () => {
  it("clips materials in front of the camera at the selected distance", () => {
    const object = new THREE.Group()
    const material = new THREE.MeshBasicMaterial()
    object.add(new THREE.Mesh(new THREE.BoxGeometry(), material))
    const pointsMaterial = new THREE.PointsMaterial()
    object.add(new THREE.Points(new THREE.BufferGeometry(), pointsMaterial))
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()

    const plane = applyCameraClip(object, camera, 5)

    expect(plane?.normal.x).toBeCloseTo(0)
    expect(plane?.normal.y).toBeCloseTo(0)
    expect(plane?.normal.z).toBeCloseTo(-1)
    expect(plane?.constant).toBe(5)
    expect(material.clippingPlanes).toEqual([plane])
    expect(pointsMaterial.clippingPlanes).toEqual([plane])
    expect(plane?.distanceToPoint(new THREE.Vector3(0, 0, 6))).toBeLessThan(0)
    expect(plane?.distanceToPoint(new THREE.Vector3(0, 0, 4))).toBeGreaterThan(0)

    clearClip(object)
    expect(material.clippingPlanes).toEqual([])
    expect(pointsMaterial.clippingPlanes).toEqual([])
  })

  it("disables clipping at distance zero", () => {
    const object = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    const camera = new THREE.PerspectiveCamera()

    expect(applyCameraClip(object, camera, 0)).toBeNull()
    expect((object.material as THREE.Material).clippingPlanes).toEqual([])
  })
})
