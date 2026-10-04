import { OrbitControls } from "@react-three/drei"
import { Canvas, useThree } from "@react-three/fiber"
import { useEffect, useState } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { Spinner } from "@/components/Busy.tsx"
import { heroFetch } from "@/session.ts"

export default function View3D({ projectId, elevation }: { projectId: string; elevation: number }) {
  const [scene, setScene] = useState<THREE.Group | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setStatus("loading")
    setScene(null)
    heroFetch(`/api/projects/${projectId}/preview`)
      .then(async (response) => {
        if (!response.ok) {
          return null
        }
        const blob = await response.blob()
        if (blob.type.includes("json") || blob.size < 16) {
          return null
        }
        objectUrl = URL.createObjectURL(blob)
        return new GLTFLoader().loadAsync(objectUrl)
      })
      .then((gltf) => {
        if (!active) {
          return
        }
        if (!gltf) {
          setStatus("error")
          return
        }
        setScene(gltf.scene)
        setStatus("ready")
      })
      .catch(() => {
        if (active) {
          setStatus("error")
        }
      })
    return () => {
      active = false
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [projectId])

  return (
    <div data-testid="view-3d" className="relative h-72 w-80 shrink-0 border-l border-slate-200 bg-slate-900">
      {status === "loading" ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-slate-200">
          <Spinner className="size-6" />
        </div>
      ) : null}
      {status === "error" ? (
        <p className="absolute inset-x-3 bottom-3 z-10 text-center text-xs text-slate-300">The 3D preview could not be loaded.</p>
      ) : null}
      <Canvas camera={{ position: [8, -8, 6], fov: 45, up: [0, 0, 1] }}>
        <color attach="background" args={["#0f172a"]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[4, -6, 10]} intensity={0.9} />
        {scene ? <primitive object={scene} /> : null}
        {scene ? <Fit object={scene} /> : null}
        <mesh position={[0, 0, elevation + 1.2]}>
          <planeGeometry args={[30, 30]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.28} side={THREE.DoubleSide} />
        </mesh>
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  )
}

function Fit({ object }: { object: THREE.Object3D }) {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as { target: THREE.Vector3; update: () => void } | null
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(object)
    if (box.isEmpty()) {
      return
    }
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.x, size.y, size.z, 1)
    camera.up.set(0, 0, 1)
    camera.position.set(center.x + radius, center.y - radius, center.z + radius * 0.7)
    camera.lookAt(center)
    camera.updateProjectionMatrix()
    if (controls && "target" in controls) {
      controls.target.copy(center)
      controls.update()
    }
  }, [object, camera, controls])
  return null
}
