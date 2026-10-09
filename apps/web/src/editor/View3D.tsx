import { OrbitControls } from "@react-three/drei"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { Button } from "@/components/ui/button.tsx"
import { Spinner } from "@/components/Busy.tsx"
import type { Plan } from "@/core/plan-types.ts"
import { heroFetch } from "@/session.ts"
import {
  DEFAULT_POINT_SIZE_PX,
  POINT_SIZE_MAX_PX,
  POINT_SIZE_MIN_PX,
  parsePointPreview,
  pointCloudObject,
} from "./point-preview.ts"
import { useEditor } from "./store.ts"
import { applyClipPlane, clearClip, updateCameraClip } from "./view3d-clipping.ts"
import { floorCorners } from "./view3d-shot.ts"

type ViewShot = {
  image: string
  projection: number[]
  matrixWorld: number[]
  overheadImage: string
  overheadFrame: number[]
}

const DEFAULT_CLIP_DISTANCE_M = 0

export default function View3D({
  projectId,
  elevation,
  onPlan,
}: {
  projectId: string
  elevation: number
  onPlan: (plan: Plan) => void
}) {
  const [scene, setScene] = useState<THREE.Object3D | null>(null)
  const [preview, setPreview] = useState<"mesh" | "points" | null>(null)
  const [colored, setColored] = useState(false)
  const [pointSize, setPointSize] = useState(DEFAULT_POINT_SIZE_PX)
  const [clipDistance, setClipDistance] = useState(DEFAULT_CLIP_DISTANCE_M)
  const [clipMaxDistance, setClipMaxDistance] = useState(10)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [sent, setSent] = useState<string | null>(null)
  const capture = useRef<(() => ViewShot) | null>(null)
  const rememberShot = useCallback((shot: () => ViewShot) => {
    capture.current = shot
  }, [])

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setStatus("loading")
    setScene(null)
    setPreview(null)
    setColored(false)
    setClipDistance(DEFAULT_CLIP_DISTANCE_M)
    setClipMaxDistance(10)
    heroFetch(`/api/projects/${projectId}/preview`)
      .then(async (response) => {
        if (!response.ok) {
          return null
        }
        const type = response.headers.get("content-type") ?? ""
        if (type.includes("json")) {
          return null
        }
        const buffer = await response.arrayBuffer()
        const parsed = parsePointPreview(buffer)
        if (parsed) {
          return pointCloudObject(parsed.positions, parsed.colors)
        }
        if (buffer.byteLength < 16) {
          return null
        }
        objectUrl = URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }))
        const gltf = await new GLTFLoader().loadAsync(objectUrl)
        return gltf.scene
      })
      .then((object) => {
        if (!active) {
          return
        }
        if (!object) {
          setStatus("error")
          return
        }
        const bounds = new THREE.Box3().setFromObject(object)
        const modelExtent = bounds.getSize(new THREE.Vector3()).length()
        const maxDistance = Number.isFinite(modelExtent) ? Math.max(1, Math.ceil(modelExtent * 2 * 10) / 10) : 10
        setClipMaxDistance(maxDistance)
        setClipDistance(DEFAULT_CLIP_DISTANCE_M)
        setScene(object)
        setPreview(object.name === "point-preview" ? "points" : "mesh")
        setColored(object.userData.colored === true)
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

  useEffect(() => {
    if (!scene || preview !== "points") {
      return
    }
    scene.traverse((object) => {
      if (object instanceof THREE.Points && object.material instanceof THREE.PointsMaterial) {
        object.material.size = pointSize
      }
    })
  }, [pointSize, preview, scene])

  async function detect() {
    if (busy) {
      return
    }
    setError("")
    setNotice("")
    let shot: ViewShot
    try {
      const captured = capture.current?.()
      if (!captured) {
        setError("The 3D view is not ready yet.")
        return
      }
      shot = captured
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      setError(message || "The 3D view could not be captured.")
      return
    }
    setBusy(true)
    setSent(shot.image)
    try {
      const response = await heroFetch(`/api/projects/${projectId}/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: shot.image,
          projection: shot.projection,
          matrixWorld: shot.matrixWorld,
          floorZ: elevation,
          overheadImage: shot.overheadImage,
          overheadFrame: shot.overheadFrame,
        }),
      })
      const body = (await response.json()) as { cursorKeySet?: boolean; plan?: Plan; detail?: string }
      if (body.cursorKeySet === false) {
        setError(body.detail || "No Cursor key is saved. Open Settings and save a key.")
        return
      }
      if (!response.ok || !body.plan) {
        setError(body.detail || "Cursor could not identify the furniture.")
        return
      }
      const plan = body.plan
      onPlan(plan)
      const hidden = useEditor.getState().hideFurniture
      if (hidden) {
        useEditor.getState().setHideFurniture(false)
      }
      if (hidden) {
        useEditor.getState().setHideFurniture(true)
      }
      const names = plan.levels.flatMap((level) => level.fixtures.map((fixture) => fixture.symbol))
      setNotice(names.length > 0 ? `Found ${names.join(", ")}.` : "Nothing recognizable in this view.")
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      setError(message || "Cursor could not identify the furniture.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="view-3d"
      data-preview={preview ?? undefined}
      data-colored={colored ? "true" : "false"}
      className="fixed inset-0 z-40 bg-slate-900"
    >
      {preview ? (
        <div className="absolute top-3 left-3 z-20 w-64 rounded-md bg-slate-950/85 px-3 py-2 text-slate-100 shadow-lg">
          <label className="flex items-center justify-between gap-3 text-xs font-medium" htmlFor="clip-distance-slider">
            <span>Clip distance</span>
            <output data-testid="clip-distance-value">{clipDistance.toFixed(2)} m</output>
          </label>
          <input
            id="clip-distance-slider"
            data-testid="clip-distance-slider"
            type="range"
            min={0}
            max={clipMaxDistance}
            step={0.05}
            value={clipDistance}
            onChange={(event) => setClipDistance(Number(event.target.value))}
            className="mt-1 w-full accent-sky-400"
            aria-label="Clip distance from camera"
          />
          <p className="mt-1 text-[11px] text-slate-300">Remove geometry in front of the camera.</p>
          {preview === "points" ? (
            <>
              <label className="mt-2 flex items-center justify-between gap-3 text-xs font-medium" htmlFor="point-size-slider">
                <span>Point size</span>
                <output data-testid="point-size-value">{pointSize}px</output>
              </label>
              <input
                id="point-size-slider"
                data-testid="point-size-slider"
                type="range"
                min={POINT_SIZE_MIN_PX}
                max={POINT_SIZE_MAX_PX}
                step={0.5}
                value={pointSize}
                onChange={(event) => setPointSize(Number(event.target.value))}
                className="mt-1 w-full accent-sky-400"
                aria-label="Point size"
              />
            </>
          ) : null}
        </div>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="absolute top-3 right-3 z-20"
        data-testid="close-3d"
        onClick={() => useEditor.getState().setShow3d(false)}
      >
        Close
      </Button>
      <div className="absolute bottom-4 left-1/2 z-20 flex w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 flex-col gap-2 rounded-md bg-slate-950/85 p-3 text-slate-100 shadow-lg">
        <div className="flex items-center gap-3">
          <Button type="button" data-testid="identify-run" disabled={busy || status !== "ready"} onClick={() => void detect()}>
            {busy ? <Spinner /> : null}
            Detect furniture
          </Button>
          <p className="text-xs text-slate-300">Measures the room, draws the walls, then checks that picture with Cursor.</p>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-300" data-testid="identify-error">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="text-sm" data-testid="identify-status">
            {notice}
          </p>
        ) : null}
        {sent ? (
          <img
            data-testid="identification-image"
            src={sent}
            alt="Screenshot sent to Cursor"
            className="h-28 w-auto max-w-full border border-slate-600 bg-slate-900 object-contain"
          />
        ) : null}
      </div>
      {status === "loading" ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-slate-200">
          <Spinner className="size-6" />
        </div>
      ) : null}
      {status === "error" ? (
        <p className="absolute inset-x-3 bottom-3 z-10 text-center text-xs text-slate-300">The 3D preview could not be loaded.</p>
      ) : null}
      <Canvas
        camera={{ position: [8, -8, 6], fov: 45, up: [0, 0, 1] }}
        gl={{ preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true
        }}
      >
        <color attach="background" args={["#0f172a"]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[4, -6, 10]} intensity={0.9} />
        {scene ? <primitive object={scene} /> : null}
        {scene ? <Fit object={scene} /> : null}
        {scene ? <CameraClip object={scene} distance={clipDistance} /> : null}
        <ScreenshotSource floorZ={elevation} onReady={rememberShot} />
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  )
}

function CameraClip({ object, distance }: { object: THREE.Object3D; distance: number }) {
  const camera = useThree((state) => state.camera)
  const plane = useMemo(() => new THREE.Plane(), [])

  useEffect(() => {
    if (distance <= 0) {
      clearClip(object)
      return
    }
    applyClipPlane(object, plane)
    return () => clearClip(object)
  }, [distance, object, plane])

  useFrame(() => {
    if (distance > 0) {
      updateCameraClip(plane, camera, distance)
    }
  })
  return null
}

function ScreenshotSource({
  floorZ,
  onReady,
}: {
  floorZ: number
  onReady: (capture: () => ViewShot) => void
}) {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  useEffect(() => {
    onReady(() => {
      camera.updateMatrixWorld()
      if ("updateProjectionMatrix" in camera && typeof camera.updateProjectionMatrix === "function") {
        camera.updateProjectionMatrix()
      }
      gl.render(scene, camera)
      const overhead = captureOverhead(gl, scene, camera, floorZ)
      return {
        image: gl.domElement.toDataURL("image/png"),
        projection: Array.from(camera.projectionMatrix.elements),
        matrixWorld: Array.from(camera.matrixWorld.elements),
        overheadImage: overhead.image,
        overheadFrame: overhead.frame,
      }
    })
  }, [camera, floorZ, gl, onReady, scene])
  return null
}

function captureOverhead(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  floorZ: number,
): { image: string; frame: number[] } {
  const floor = new THREE.Plane(new THREE.Vector3(0, 0, 1), -floorZ)
  const raycaster = new THREE.Raycaster()
  const hits: THREE.Vector3[] = []
  const worldBounds = new THREE.Box3().setFromObject(scene)
  for (const [x, y] of [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
    const point = raycaster.ray.intersectPlane(floor, new THREE.Vector3())
    if (point) {
      hits.push(point)
    }
  }
  const corners = floorCorners(hits, worldBounds, floorZ)
  if (corners.length < 4) {
    throw new Error("Look down at the floor before detecting furniture.")
  }
  const screenRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
  screenRight.z = 0
  if (screenRight.lengthSq() < 1e-8) {
    throw new Error("The 3D view has no usable floor direction.")
  }
  const xAxis = screenRight.normalize()
  const yAxis = new THREE.Vector3(-xAxis.y, xAxis.x, 0)
  const screenUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
  screenUp.z = 0
  if (screenUp.dot(yAxis) < 0) {
    yAxis.negate()
  }
  const xValues = corners.map((point) => point.x * xAxis.x + point.y * xAxis.y)
  const yValues = corners.map((point) => point.x * yAxis.x + point.y * yAxis.y)
  const minX = Math.min(...xValues)
  const maxX = Math.max(...xValues)
  const minY = Math.min(...yValues)
  const maxY = Math.max(...yValues)
  const width = maxX - minX
  const height = maxY - minY
  if (width <= 1e-6 || height <= 1e-6) {
    throw new Error("The 3D view has no usable floor area.")
  }
  const origin = new THREE.Vector3(
    xAxis.x * minX + yAxis.x * minY,
    xAxis.y * minX + yAxis.y * minY,
    floorZ,
  )
  const centre = origin
    .clone()
    .addScaledVector(xAxis, width / 2)
    .addScaledVector(yAxis, height / 2)
  const topZ = Math.max(floorZ + 10, worldBounds.max.z + 10)
  const overhead = new THREE.OrthographicCamera(
    -width / 2,
    width / 2,
    height / 2,
    -height / 2,
    0.1,
    Math.max(100, topZ - floorZ + 100),
  )
  overhead.position.set(centre.x, centre.y, topZ)
  overhead.up.set(yAxis.x, yAxis.y, 0)
  overhead.lookAt(centre.x, centre.y, floorZ)
  overhead.updateProjectionMatrix()
  overhead.updateMatrixWorld()

  const size = 768
  const target = new THREE.WebGLRenderTarget(size, size)
  const previousTarget = gl.getRenderTarget()
  const previousViewport = gl.getViewport(new THREE.Vector4())
  const previousScissor = gl.getScissor(new THREE.Vector4())
  const previousScissorTest = gl.getScissorTest()
  gl.setRenderTarget(target)
  gl.clear()
  gl.render(scene, overhead)
  const pixels = new Uint8Array(size * size * 4)
  gl.readRenderTargetPixels(target, 0, 0, size, size, pixels)
  gl.setRenderTarget(previousTarget)
  gl.setViewport(previousViewport)
  gl.setScissor(previousScissor)
  gl.setScissorTest(previousScissorTest)
  target.dispose()

  const upright = new Uint8ClampedArray(pixels.length)
  for (let row = 0; row < size; row += 1) {
    const source = row * size * 4
    const destination = (size - row - 1) * size * 4
    upright.set(pixels.subarray(source, source + size * 4), destination)
  }
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  canvas.getContext("2d")?.putImageData(new ImageData(upright, size, size), 0, 0)
  return {
    image: canvas.toDataURL("image/png"),
    frame: [
      origin.x,
      origin.y,
      xAxis.x * width,
      xAxis.y * width,
      yAxis.x * height,
      yAxis.y * height,
    ],
  }
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
