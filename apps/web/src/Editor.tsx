import { useEffect, useRef, useState } from "react";
import { Layer, Line, Stage } from "react-konva";
import { cleanPlan, downloadDxf, downloadPdf, downloadSvg, generatePlan, learnedCleanup, savePlan } from "./api";
import {
  addAnnotation,
  addDimension,
  addOpening,
  connectVertices,
  deleteAnnotation,
  deleteOpening,
  deleteVertex,
  deleteWall,
  detectRooms,
  dimensionLength,
  moveVertex,
  nameRoom,
  openingCenter,
  openingsOf,
  projectOnWall,
  updateAnnotation,
  type Plan,
} from "./plan";
import { useWorkspace, type Tool } from "./store";
import { SourceView } from "./SourceView";
import { sourceKind } from "./source";
import { fitView, toPlan, toScreen } from "./view";

function extent(vertices: { x: number; y: number }[], axis: "x" | "y") {
  if (vertices.length === 0) return 0;
  const values = vertices.map((vertex) => vertex[axis]);
  return Math.max(...values) - Math.min(...values);
}

const TOOLS: { id: Tool; label: string }[] = [
  { id: "select", label: "Move" },
  { id: "connect", label: "Connect" },
  { id: "door", label: "Door" },
  { id: "window", label: "Window" },
  { id: "dimension", label: "Measure" },
  { id: "annotate", label: "Label" },
  { id: "delete", label: "Delete" },
];

export function Editor() {
  const projectId = useWorkspace((state) => state.projectId)!;
  const filename = useWorkspace((state) => state.filename)!;
  const plan = useWorkspace((state) => state.plan)!;
  const tool = useWorkspace((state) => state.tool);
  const error = useWorkspace((state) => state.error);
  const busy = useWorkspace((state) => state.busy);
  const setTool = useWorkspace((state) => state.setTool);
  const setPlan = useWorkspace((state) => state.setPlan);
  const setError = useWorkspace((state) => state.setError);
  const setBusy = useWorkspace((state) => state.setBusy);
  const closeProject = useWorkspace((state) => state.closeProject);

  const frame = useRef<HTMLDivElement>(null);
  const planRef = useRef(plan);
  planRef.current = plan;
  const dragId = useRef<string | null>(null);
  const [size, setSize] = useState({ width: 640, height: 480 });
  const [pending, setPending] = useState<string | null>(null);
  const [measureFrom, setMeasureFrom] = useState<string | null>(null);
  const [sliceHeight, setSliceHeight] = useState(1.2);
  const sliceTimer = useRef<number | null>(null);
  const drawToken = useRef(0);
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [label, setLabel] = useState("");

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const kind = sourceKind(filename);
  const mesh = kind !== "ifc";
  const view = fitView(plan.vertices, size.width, size.height);
  const byId = new Map(plan.vertices.map((vertex) => [vertex.id, vertex]));

  async function commit(next: Plan) {
    setBusy(true);
    setError(null);
    try {
      const saved = await savePlan(projectId, next);
      planRef.current = saved;
      setPlan(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the plan.");
    } finally {
      setBusy(false);
    }
  }

  function onVertexPointerDown(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    event.stopPropagation();
    if (tool === "select") {
      dragId.current = id;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === "delete") {
      void commit(deleteVertex(planRef.current, id));
      return;
    }
    if (tool === "dimension") {
      if (!measureFrom || measureFrom === id) {
        setMeasureFrom(measureFrom === id ? null : id);
        return;
      }
      const next = addDimension(planRef.current, {
        id: `d${crypto.randomUUID().slice(0, 8)}`,
        a: measureFrom,
        b: id,
        offset: 0.45,
      });
      setMeasureFrom(null);
      void commit(next);
      return;
    }
    if (tool !== "connect") return;
    if (!pending || pending === id) {
      setPending(pending === id ? null : id);
      return;
    }
    const next = connectVertices(planRef.current, pending, id);
    setPending(null);
    void commit(next);
  }

  function onVertexPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!dragId.current || !frame.current) return;
    const rect = frame.current.getBoundingClientRect();
    const point = toPlan(event.clientX - rect.left, event.clientY - rect.top, view);
    const next = moveVertex(planRef.current, dragId.current, point.x, point.y);
    planRef.current = next;
    setPlan(next);
  }

  function onVertexPointerUp() {
    if (!dragId.current) return;
    dragId.current = null;
    void commit(planRef.current);
  }

  function onSurfaceClick(event: React.MouseEvent<HTMLDivElement>) {
    if (tool !== "annotate" || !frame.current) return;
    if ((event.target as HTMLElement).closest("[data-vertex]")) return;
    const rect = frame.current.getBoundingClientRect();
    setDraft(toPlan(event.clientX - rect.left, event.clientY - rect.top, view));
  }

  async function placeLabel() {
    if (!draft || !label.trim()) return;
    const next = addAnnotation(planRef.current, {
      id: `a${crypto.randomUUID().slice(0, 8)}`,
      x: draft.x,
      y: draft.y,
      text: label.trim(),
    });
    setLabel("");
    setDraft(null);
    await commit(next);
  }

  async function redraw(height = sliceHeight) {
    const token = ++drawToken.current;
    setBusy(true);
    setError(null);
    try {
      const next = await generatePlan(projectId, height);
      if (token !== drawToken.current) return;
      planRef.current = next;
      setPlan(next);
    } catch (caught) {
      if (token !== drawToken.current) return;
      setError(caught instanceof Error ? caught.message : "Could not redraw the plan.");
    } finally {
      if (token === drawToken.current) setBusy(false);
    }
  }

  function onSliceHeight(value: number) {
    setSliceHeight(value);
    if (!Number.isFinite(value)) return;
    if (sliceTimer.current) window.clearTimeout(sliceTimer.current);
    sliceTimer.current = window.setTimeout(() => {
      void redraw(value);
    }, 250);
  }

  async function applyCleanup() {
    setBusy(true);
    setError(null);
    try {
      const next = await learnedCleanup(projectId);
      planRef.current = next;
      setPlan(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Learned cleanup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function applyAi() {
    if (!instruction.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await cleanPlan(projectId, instruction.trim());
      planRef.current = next;
      setPlan(next);
      setInstruction("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI cleanup failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace">
      <aside className="tools" aria-label="Tools">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`tool-${item.id}`}
            className={tool === item.id ? "tool active" : "tool"}
            onClick={() => {
              setTool(item.id);
              setPending(null);
              setMeasureFrom(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </aside>
      <section className="stage-wrap">
        <header className="bar">
          <div>
            <p className="eyebrow">2D Hero</p>
            <h1>{filename}</h1>
          </div>
          <p data-testid="plan-summary" className="summary">
            {plan.walls.length} walls · {plan.vertices.length} corners
            <span
              data-testid="plan-extents"
              data-x={extent(plan.vertices, "x").toFixed(3)}
              data-y={extent(plan.vertices, "y").toFixed(3)}
            >
              {extent(plan.vertices, "x").toFixed(2)} m by {extent(plan.vertices, "y").toFixed(2)} m
            </span>
            {kind === "cloud" ? (
              <span data-testid="source-kind" className="kind">
                Point cloud
              </span>
            ) : null}
          </p>
          <div className="bar-actions">
            <button type="button" onClick={closeProject}>
              New file
            </button>
            <button
              type="button"
              data-testid="export-pdf"
              disabled={busy}
              onClick={() => {
                void downloadPdf(projectId).catch((caught: unknown) => {
                  setError(caught instanceof Error ? caught.message : "Could not export the PDF.");
                });
              }}
            >
              Export PDF
            </button>
            <button
              type="button"
              data-testid="export-dxf"
              disabled={busy}
              onClick={() => {
                void downloadDxf(projectId).catch((caught: unknown) => {
                  setError(caught instanceof Error ? caught.message : "Could not export the DXF.");
                });
              }}
            >
              DXF
            </button>
            <button
              type="button"
              data-testid="export-svg"
              disabled={busy}
              onClick={() => {
                void downloadSvg(projectId).catch((caught: unknown) => {
                  setError(caught instanceof Error ? caught.message : "Could not export the SVG.");
                });
              }}
            >
              SVG
            </button>
          </div>
        </header>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="views">
        <div ref={frame} className="canvas" data-testid="canvas-surface" onClick={onSurfaceClick}>
          <Stage width={size.width} height={size.height}>
            <Layer>
              {plan.walls.map((wall) => {
                const start = byId.get(wall.a);
                const end = byId.get(wall.b);
                if (!start || !end) return null;
                const from = toScreen(start.x, start.y, view);
                const to = toScreen(end.x, end.y, view);
                return (
                  <Line
                    key={wall.id}
                    points={[from.sx, from.sy, to.sx, to.sy]}
                    stroke="#1f2933"
                    strokeWidth={3}
                  />
                );
              })}
            </Layer>
          </Stage>
          {plan.vertices.map((vertex) => {
            const point = toScreen(vertex.x, vertex.y, view);
            return (
              <button
                key={vertex.id}
                type="button"
                data-vertex="true"
                data-testid={`vertex-${vertex.id}`}
                data-x={vertex.x}
                data-y={vertex.y}
                className={pending === vertex.id ? "handle pending" : "handle"}
                style={{ left: point.sx, top: point.sy }}
                aria-label={`Corner ${vertex.id}`}
                onPointerDown={(event) => onVertexPointerDown(event, vertex.id)}
                onPointerMove={onVertexPointerMove}
                onPointerUp={onVertexPointerUp}
              />
            );
          })}
          <svg className="overlay" viewBox={`0 0 ${size.width} ${size.height}`}>
            {plan.walls.map((wall) => {
              const start = byId.get(wall.a);
              const end = byId.get(wall.b);
              if (!start || !end) return null;
              const from = toScreen(start.x, start.y, view);
              const to = toScreen(end.x, end.y, view);
              const dx = to.sx - from.sx;
              const dy = to.sy - from.sy;
              const span = Math.hypot(dx, dy) || 1;
              const inset = Math.min(18, span / 3);
              const ax = from.sx + (dx / span) * inset;
              const ay = from.sy + (dy / span) * inset;
              const bx = to.sx - (dx / span) * inset;
              const by = to.sy - (dy / span) * inset;
              const nx = (-dy / span) * 12;
              const ny = (dx / span) * 12;
              return (
                <polygon
                  key={wall.id}
                  data-testid={`wall-${wall.id}`}
                  points={`${ax + nx},${ay + ny} ${bx + nx},${by + ny} ${bx - nx},${by - ny} ${ax - nx},${ay - ny}`}
                  className="wall-hit"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (tool === "delete") {
                      void commit(deleteWall(planRef.current, wall.id));
                      return;
                    }
                    if (tool !== "door" && tool !== "window") return;
                    const rect = frame.current?.getBoundingClientRect();
                    if (!rect) return;
                    const point = toPlan(event.clientX - rect.left, event.clientY - rect.top, view);
                    const offset = projectOnWall(planRef.current, wall.id, point.x, point.y);
                    if (offset == null) return;
                    const next = addOpening(planRef.current, {
                      id: `o${crypto.randomUUID().slice(0, 8)}`,
                      wall: wall.id,
                      kind: tool,
                      offset,
                      width: tool === "door" ? 0.9 : 1.2,
                    });
                    void commit(next);
                  }}
                />
              );
            })}
            {openingsOf(plan).map((opening) => {
              const center = openingCenter(plan, opening);
              const wall = plan.walls.find((item) => item.id === opening.wall);
              const start = wall ? byId.get(wall.a) : undefined;
              const end = wall ? byId.get(wall.b) : undefined;
              if (!center || !start || !end) return null;
              const point = toScreen(center.x, center.y, view);
              const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
              const dx = ((end.x - start.x) / length) * view.scale;
              const dy = ((start.y - end.y) / length) * view.scale;
              const half = (opening.width * view.scale) / 2;
              const nx = (-dy / (Math.hypot(dx, dy) || 1)) * half;
              const ny = (dx / (Math.hypot(dx, dy) || 1)) * half;
              return (
                <g
                  key={opening.id}
                  data-testid={`opening-${opening.id}`}
                  data-kind={opening.kind}
                  data-offset={opening.offset}
                  data-wall={opening.wall}
                >
                  {opening.kind === "door" ? (
                    <path
                      d={`M ${point.sx - dx * (half / (Math.hypot(dx, dy) || 1))} ${point.sy - dy * (half / (Math.hypot(dx, dy) || 1))} a ${half} ${half} 0 0 1 ${nx} ${ny}`}
                      className="door-swing"
                    />
                  ) : (
                    <line
                      x1={point.sx - (dx * half) / (Math.hypot(dx, dy) || 1)}
                      y1={point.sy - (dy * half) / (Math.hypot(dx, dy) || 1)}
                      x2={point.sx + (dx * half) / (Math.hypot(dx, dy) || 1)}
                      y2={point.sy + (dy * half) / (Math.hypot(dx, dy) || 1)}
                      className="window-mark"
                    />
                  )}
                  {tool === "delete" ? (
                    <circle
                      cx={point.sx}
                      cy={point.sy}
                      r={8}
                      className="opening-hit"
                      onClick={(event) => {
                        event.stopPropagation();
                        void commit(deleteOpening(planRef.current, opening.id));
                      }}
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>
          {plan.dimensions?.map((dimension) => {
            const start = byId.get(dimension.a);
            const end = byId.get(dimension.b);
            const length = dimensionLength(plan, dimension);
            if (!start || !end || length == null) return null;
            const point = toScreen((start.x + end.x) / 2, (start.y + end.y) / 2, view);
            return (
              <span
                key={dimension.id}
                data-testid={`dimension-${dimension.id}`}
                className="dimension"
                style={{ left: point.sx, top: point.sy }}
              >
                {length.toFixed(2)} m
              </span>
            );
          })}
          {plan.annotations.map((note) => {
            const point = toScreen(note.x, note.y, view);
            return (
              <span key={note.id} className="note" style={{ left: point.sx, top: point.sy }}>
                {note.text}
              </span>
            );
          })}
        </div>
        <SourceView projectId={projectId} sliceHeight={sliceHeight} />
        </div>
      </section>
      <aside className="side">
        {mesh ? (
          <label className="field">
            Slice height (m above the floor)
            <input
              data-testid="slice-height"
              type="number"
              min={0.2}
              max={3}
              step={0.1}
              value={sliceHeight}
              onChange={(event) => onSliceHeight(Number(event.target.value))}
            />
            <button type="button" onClick={() => void redraw()} disabled={busy}>
              Redraw from model
            </button>
          </label>
        ) : (
          <p className="hint">IFC walls come from the model, so there is no slice height.</p>
        )}
        <div className="field">
          <p className="field-label">Rooms</p>
          <ul className="notes" data-testid="room-list">
            {detectRooms(plan).map((room) => (
              <li key={room.id}>
                <span data-testid="room-area" data-area={room.area.toFixed(3)}>
                  {room.area.toFixed(1)} m²
                </span>
                <input
                  data-testid={`room-name-${room.id}`}
                  aria-label="Room name"
                  placeholder="Room name"
                  value={room.name}
                  onChange={(event) => {
                    const next = nameRoom(planRef.current, room.vertices, event.target.value);
                    planRef.current = next;
                    setPlan(next);
                  }}
                  onBlur={() => void commit(planRef.current)}
                />
              </li>
            ))}
          </ul>
          {detectRooms(plan).length === 0 ? <p className="hint">Close a loop to see its area.</p> : null}
        </div>
        <div className="field">
          <p className="field-label">Label</p>
          {draft ? (
            <>
              <input
                data-testid="annotation-text"
                value={label}
                placeholder="Kitchen"
                onChange={(event) => setLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void placeLabel();
                }}
              />
              <button type="button" data-testid="annotation-add" onClick={() => void placeLabel()} disabled={busy}>
                Add label
              </button>
            </>
          ) : (
            <p className="hint">Choose Label, then click the plan.</p>
          )}
          <ul className="notes">
            {plan.annotations.map((note) => (
              <li key={note.id} data-testid={`annotation-${note.id}`}>
                <input
                  aria-label={`Edit ${note.text}`}
                  value={note.text}
                  onChange={(event) => {
                    const next = updateAnnotation(planRef.current, note.id, event.target.value);
                    planRef.current = next;
                    setPlan(next);
                  }}
                  onBlur={() => void commit(planRef.current)}
                />
                <button type="button" onClick={() => void commit(deleteAnnotation(plan, note.id))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="field">
          <p className="field-label">Learned cleanup</p>
          <button type="button" data-testid="learned-cleanup" onClick={() => void applyCleanup()} disabled={busy}>
            Clean draft
          </button>
          <p className="hint">Snaps near-axis walls and closes small gaps on this machine. It does not download a model.</p>
        </div>
        <label className="field">
          Clean with AI
          <textarea
            data-testid="ai-instruction"
            rows={4}
            value={instruction}
            placeholder="Close the gap by the entrance and straighten the south wall."
            onChange={(event) => setInstruction(event.target.value)}
          />
          <button type="button" data-testid="ai-apply" onClick={() => void applyAi()} disabled={busy || !instruction.trim()}>
            Apply
          </button>
          <p className="hint">Uses the Cursor SDK when CURSOR_API_KEY is set.</p>
        </label>
      </aside>
    </div>
  );
}
