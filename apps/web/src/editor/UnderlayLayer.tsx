import { useEffect, useState } from "react"
import { Spinner } from "@/components/Busy.tsx"
import type { Bounds } from "@/view/camera.ts"
import { heroFetch } from "@/session.ts"
import { useEditor } from "./store.ts"

type Frame = Bounds & { id: string }

export default function UnderlayLayer({ projectId, levelId }: { projectId: string; levelId: string }) {
  const camera = useEditor((state) => state.camera)
  const visible = useEditor((state) => state.underlayVisible)
  const opacity = useEditor((state) => state.underlayOpacity)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setLoading(true)
    heroFetch(`/api/projects/${projectId}/underlay/frames.json`)
      .then(async (response) => {
        if (!response.ok) {
          return null
        }
        return (await response.json()) as { levels?: Frame[] }
      })
      .then(async (body) => {
        const found = body?.levels?.find((level) => level.id === levelId) ?? null
        if (!active) {
          return
        }
        setFrame(found)
        if (!found) {
          setUrl(null)
          return
        }
        useEditor.getState().setUnderlayBounds(found)
        const image = await heroFetch(`/api/projects/${projectId}/underlay/${levelId}.png`)
        if (!image.ok || !active) {
          return
        }
        const blob = await image.blob()
        objectUrl = URL.createObjectURL(blob)
        if (active) {
          setUrl(objectUrl)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })
    return () => {
      active = false
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [projectId, levelId])

  if (visible && loading && !url) {
    return (
      <span className="absolute left-3 top-3 z-10" data-testid="underlay-loading">
        <Spinner />
      </span>
    )
  }
  if (!visible || !frame || !url) {
    return null
  }
  const left = camera.originX + frame.minX * camera.pixelsPerMeter
  const top = camera.originY - frame.maxY * camera.pixelsPerMeter
  const width = (frame.maxX - frame.minX) * camera.pixelsPerMeter
  const height = (frame.maxY - frame.minY) * camera.pixelsPerMeter
  return (
    <img
      data-testid="underlay"
      alt=""
      src={url}
      className="pointer-events-none absolute max-w-none"
      style={{ left, top, width, height, opacity }}
    />
  )
}
