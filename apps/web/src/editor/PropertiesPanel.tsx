import { useEffect, useState } from "react"
import { flipSwing, mergeCollinearWall } from "@/core/draw.ts"
import { moveVertex, setFixtureRotation, setFixtureSize, setOpening, setRoomName, setTextContent, setWallThickness } from "@/core/ops.ts"
import type { Level, Plan } from "@/core/plan-types.ts"
import { useEditor } from "./store.ts"
import { SYMBOL_LABELS } from "./symbols.ts"

export default function PropertiesPanel() {
  const plan = useEditor((state) => state.history?.plan ?? null)
  const selection = useEditor((state) => state.selection)
  const activeLevelId = useEditor((state) => state.activeLevelId)
  const level = plan?.levels.find((item) => item.id === activeLevelId) ?? plan?.levels[0]
  const item = selection.length === 1 ? selection[0] : undefined

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <h2 className="font-medium">Properties</h2>
      {!item || !plan || !level ? (
        <p className="text-slate-500">{selection.length > 1 ? `${selection.length} selected` : "Nothing selected"}</p>
      ) : null}
      {item && plan && level && item.kind === "vertex" ? <VertexFields plan={plan} level={level} id={item.id} /> : null}
      {item && plan && level && item.kind === "wall" ? <WallFields plan={plan} level={level} id={item.id} /> : null}
      {item && plan && level && item.kind === "opening" ? <OpeningFields plan={plan} level={level} id={item.id} /> : null}
      {item && plan && level && item.kind === "fixture" ? <FixtureFields plan={plan} level={level} id={item.id} /> : null}
      {item && plan && level && item.kind === "text" ? <TextFields plan={plan} level={level} id={item.id} /> : null}
      {item && plan && level && item.kind === "room" ? <RoomFields plan={plan} level={level} id={item.id} /> : null}
    </div>
  )
}

function VertexFields({ plan, level, id }: { plan: Plan; level: Level; id: string }) {
  const vertex = level.vertices.find((item) => item.id === id)
  const [x, setX] = useState(vertex ? String(vertex.x) : "")
  const [y, setY] = useState(vertex ? String(vertex.y) : "")
  const [error, setError] = useState("")
  useEffect(() => {
    if (!vertex) {
      return
    }
    setX(String(vertex.x))
    setY(String(vertex.y))
  }, [vertex, vertex?.x, vertex?.y])
  if (!vertex) {
    return null
  }
  function commit() {
    const nextX = Number(x)
    const nextY = Number(y)
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) {
      setError("Coordinates must be finite numbers.")
      return
    }
    setError("")
    useEditor.getState().commit(moveVertex(plan, level.id, id, { x: nextX, y: nextY }))
  }
  return (
    <div className="flex flex-col gap-2">
      <Field label="X" value={x} onChange={setX} onCommit={commit} testId="prop-x" />
      <Field label="Y" value={y} onChange={setY} onCommit={commit} testId="prop-y" />
      {error ? <p className="text-red-700">{error}</p> : null}
    </div>
  )
}

function WallFields({ plan, level, id }: { plan: Plan; level: Level; id: string }) {
  const wall = level.walls.find((item) => item.id === id)
  const [thickness, setThickness] = useState(wall ? String(wall.thickness) : "")
  const [error, setError] = useState("")
  useEffect(() => {
    if (wall) {
      setThickness(String(wall.thickness))
    }
  }, [wall, wall?.thickness])
  if (!wall) {
    return null
  }
  function commit() {
    try {
      useEditor.getState().commit(setWallThickness(plan, level.id, id, Number(thickness)))
      setError("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Thickness was not applied.")
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <Field label="Thickness (m)" value={thickness} onChange={setThickness} onCommit={commit} testId="prop-thickness" />
      <button
        type="button"
        className="h-8 rounded border border-slate-300 bg-white px-2"
        data-testid="merge-wall"
        onClick={() => {
          try {
            useEditor.getState().commit(mergeCollinearWall(plan, level.id, id))
            setError("")
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "These walls are not collinear.")
          }
        }}
      >
        Merge collinear
      </button>
      {error ? <p className="text-red-700">{error}</p> : null}
    </div>
  )
}

function OpeningFields({ plan, level, id }: { plan: Plan; level: Level; id: string }) {
  const opening = level.openings.find((item) => item.id === id)
  const [width, setWidth] = useState(opening ? String(opening.width) : "")
  const [sill, setSill] = useState(opening ? String(opening.sill) : "")
  const [head, setHead] = useState(opening ? String(opening.head) : "")
  const [swing, setSwing] = useState(opening?.swing ?? "left")
  const [error, setError] = useState("")
  useEffect(() => {
    if (!opening) {
      return
    }
    setWidth(String(opening.width))
    setSill(String(opening.sill))
    setHead(String(opening.head))
    setSwing(opening.swing)
  }, [opening, opening?.width, opening?.sill, opening?.head, opening?.swing])
  if (!opening) {
    return null
  }
  function commit(nextSwing = swing) {
    try {
      useEditor.getState().commit(
        setOpening(plan, level.id, id, {
          width: Number(width),
          sill: Number(sill),
          head: Number(head),
          swing: nextSwing,
        }),
      )
      setError("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Opening was not applied.")
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <Field label="Width (m)" value={width} onChange={setWidth} onCommit={() => commit()} testId="prop-width" />
      <Field label="Sill (m)" value={sill} onChange={setSill} onCommit={() => commit()} testId="prop-sill" />
      <Field label="Head (m)" value={head} onChange={setHead} onCommit={() => commit()} testId="prop-head" />
      <label className="flex flex-col gap-1">
        Swing
        <select
          className="h-8 rounded border border-slate-300 bg-white px-2"
          value={swing}
          data-testid="prop-swing"
          onChange={(event) => {
            const next = event.target.value as typeof swing
            setSwing(next)
            commit(next)
          }}
        >
          <option value="left">left</option>
          <option value="right">right</option>
          <option value="double">double</option>
          <option value="sliding">sliding</option>
          <option value="none">none</option>
        </select>
      </label>
      <button
        type="button"
        className="h-8 rounded border border-slate-300 bg-white px-2"
        data-testid="flip-swing"
        onClick={() => {
          try {
            useEditor.getState().commit(flipSwing(plan, level.id, id))
            setError("")
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Swing was not flipped.")
          }
        }}
      >
        Flip swing
      </button>
      {error ? <p className="text-red-700">{error}</p> : null}
    </div>
  )
}

function FixtureFields({ plan, level, id }: { plan: Plan; level: Level; id: string }) {
  const fixture = level.fixtures.find((item) => item.id === id)
  const [rotation, setRotation] = useState(fixture ? String(fixture.rotationDeg) : "")
  const [width, setWidth] = useState(fixture ? String(fixture.width) : "")
  const [depth, setDepth] = useState(fixture ? String(fixture.depth) : "")
  const [error, setError] = useState("")
  useEffect(() => {
    if (fixture) {
      setRotation(String(fixture.rotationDeg))
      setWidth(String(fixture.width))
      setDepth(String(fixture.depth))
    }
  }, [fixture, fixture?.rotationDeg, fixture?.width, fixture?.depth])
  if (!fixture) {
    return null
  }
  function commit() {
    try {
      useEditor.getState().commit(setFixtureRotation(plan, level.id, id, Number(rotation)))
      setError("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rotation was not applied.")
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span>Name</span>
        <output className="flex h-8 items-center rounded border border-slate-200 bg-slate-100 px-2" data-testid="prop-fixture-name">
          {SYMBOL_LABELS[fixture.symbol]}
        </output>
      </div>
      <Field label="Rotation (deg)" value={rotation} onChange={setRotation} onCommit={commit} testId="prop-rotation" />
      <Field
        label="Width (m)"
        value={width}
        onChange={setWidth}
        onCommit={() => {
          try {
            useEditor.getState().commit(setFixtureSize(plan, level.id, id, Number(width), Number(depth)))
            setError("")
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Size was not applied.")
          }
        }}
        testId="prop-fixture-width"
      />
      <Field
        label="Depth (m)"
        value={depth}
        onChange={setDepth}
        onCommit={() => {
          try {
            useEditor.getState().commit(setFixtureSize(plan, level.id, id, Number(width), Number(depth)))
            setError("")
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Size was not applied.")
          }
        }}
        testId="prop-fixture-depth"
      />
      {error ? <p className="text-red-700">{error}</p> : null}
    </div>
  )
}

function TextFields({ plan, level, id }: { plan: Plan; level: Level; id: string }) {
  const text = level.texts.find((item) => item.id === id)
  const [value, setValue] = useState(text?.text ?? "")
  useEffect(() => {
    if (text) {
      setValue(text.text)
    }
  }, [text, text?.text])
  if (!text) {
    return null
  }
  return (
    <label className="flex flex-col gap-1">
      Text
      <input
        className="h-8 rounded border border-slate-300 bg-white px-2"
        data-testid="prop-text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => useEditor.getState().commit(setTextContent(plan, level.id, id, value))}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            useEditor.getState().commit(setTextContent(plan, level.id, id, value))
          }
        }}
      />
    </label>
  )
}

function RoomFields({ plan, level, id }: { plan: Plan; level: Level; id: string }) {
  const room = level.rooms.find((item) => item.id === id)
  const [name, setName] = useState(room?.name ?? "")
  const [number, setNumber] = useState(room?.number ?? "")
  useEffect(() => {
    if (!room) {
      return
    }
    setName(room.name)
    setNumber(room.number)
  }, [room, room?.name, room?.number])
  if (!room) {
    return null
  }
  function commit() {
    useEditor.getState().commit(setRoomName(plan, level.id, id, name, number))
  }
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        Name
        <input className="h-8 rounded border border-slate-300 bg-white px-2" data-testid="room-name" value={name} onChange={(event) => setName(event.target.value)} onBlur={commit} onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit()
          }
        }} />
      </label>
      <label className="flex flex-col gap-1">
        Number
        <input className="h-8 rounded border border-slate-300 bg-white px-2" data-testid="room-number" value={number} onChange={(event) => setNumber(event.target.value)} onBlur={commit} onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit()
          }
        }} />
      </label>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  onCommit,
  testId,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  testId: string
}) {
  return (
    <label className="flex flex-col gap-1">
      {label}
      <input
        className="h-8 rounded border border-slate-300 bg-white px-2"
        data-testid={testId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onCommit()
          }
        }}
      />
    </label>
  )
}
