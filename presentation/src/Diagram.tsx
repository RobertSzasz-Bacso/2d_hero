import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useState } from "react";
import {
  type ArchEdge,
  type ArchNode,
  type Stage,
  curveControl,
  graphFor,
  pointOnCurve,
} from "./content";

type Props = {
  stage: Stage;
  stageIndex: number;
  showPlanned: boolean;
  onTogglePlanned: (value: boolean) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  running: boolean;
  hop: number;
  flow: string[];
  onSimulate: () => void;
  onHopDone: () => void;
};

function Packet({
  from,
  to,
  onDone,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  onDone: () => void;
}) {
  const control = curveControl(from, to);
  const t = useMotionValue(0);
  const left = useTransform(t, (value) => `${pointOnCurve(from, control, to, value).x}%`);
  const top = useTransform(t, (value) => `${pointOnCurve(from, control, to, value).y}%`);

  useEffect(() => {
    const controls = animate(t, 1, {
      duration: 0.7,
      ease: [0.45, 0, 0.2, 1],
      onComplete: onDone,
    });
    return () => controls.stop();
  }, [control.x, control.y, from.x, from.y, onDone, t, to.x, to.y]);

  return (
    <motion.div
      className="pointer-events-none absolute z-30 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-100 shadow-[0_0_18px_5px_rgba(103,232,249,0.9)]"
      style={{ left, top }}
    />
  );
}

export default function Diagram({
  stage,
  stageIndex,
  showPlanned,
  onTogglePlanned,
  selectedId,
  onSelect,
  running,
  hop,
  flow,
  onSimulate,
  onHopDone,
}: Props) {
  const { nodes, edges } = graphFor(stage);
  const visible = new Set(
    nodes.filter((node) => showPlanned || node.status === "implemented").map((node) => node.id),
  );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selected = byId.get(selectedId);
  const liveFrom = running ? flow[hop] : undefined;
  const liveTo = running ? flow[hop + 1] : undefined;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] tracking-[0.16em] text-cyan-200/80 uppercase">Interactive model</p>
          <h2 className="truncate text-sm font-semibold text-white">{stage.diagramTitle}</h2>
        </div>
        <div className="flex rounded-full border border-white/10 bg-black/30 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => onTogglePlanned(false)}
            className={`rounded-full px-3 py-1.5 transition ${showPlanned ? "text-slate-400" : "bg-cyan-300/15 text-cyan-50"}`}
          >
            Current implementation
          </button>
          <button
            type="button"
            onClick={() => onTogglePlanned(true)}
            className={`rounded-full px-3 py-1.5 transition ${showPlanned ? "bg-violet-300/15 text-violet-50" : "text-slate-400"}`}
          >
            Full target architecture
          </button>
        </div>
        <button
          type="button"
          onClick={onSimulate}
          className="rounded-full bg-cyan-300 px-3.5 py-1.5 text-xs font-semibold text-slate-950 shadow-[0_0_24px_rgba(103,232,249,0.35)]"
        >
          {running ? "Simulating…" : "Simulate flow"}
        </button>
      </div>

      <p className="px-4 pt-3 text-xs leading-relaxed text-slate-400">{stage.diagramNote}</p>

      <div className="flex gap-1.5 overflow-x-auto px-4 pt-3">
        {flow.map((id, index) => {
          const node = byId.get(id);
          const here = running ? index === hop : id === selectedId;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-wide ${
                here
                  ? "border-cyan-300/70 bg-cyan-300/15 text-cyan-50"
                  : "border-white/10 text-slate-400"
              }`}
            >
              {index + 1} {node?.title ?? id}
            </button>
          );
        })}
      </div>

      <div className="blueprint relative mx-4 mt-3 h-[500px] shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-[#0a1020]/80">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {edges.map((edge) => (
            <Edge
              key={`${edge.from}-${edge.to}`}
              edge={edge}
              byId={byId}
              visible={visible}
              flow={flow}
              selectedId={running ? "" : selectedId}
              live={edge.from === liveFrom && edge.to === liveTo}
            />
          ))}
        </svg>

        {edges.map((edge) => {
          if (!visible.has(edge.from) || !visible.has(edge.to) || !edge.label) return null;
          const a = byId.get(edge.from);
          const b = byId.get(edge.to);
          if (!a || !b) return null;
          const liveEdge = edge.from === liveFrom && edge.to === liveTo;
          if (!liveEdge) return null;
          const mid = pointOnCurve(a, curveControl(a, b), b, 0.5);
          return (
            <div
              key={`${edge.from}-${edge.to}-label`}
              className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-[140%] rounded-full border border-white/10 bg-[#0b1222]/95 px-1.5 py-0.5 font-mono text-[9px] text-slate-200"
              style={{ left: `${mid.x}%`, top: `${mid.y}%` }}
            >
              {edge.label}
            </div>
          );
        })}

        {nodes.map((node) =>
          visible.has(node.id) ? (
            <NodeCard
              key={node.id}
              node={node}
              active={node.stages.includes(stageIndex)}
              selected={node.id === selectedId}
              onSelect={onSelect}
            />
          ) : null,
        )}

        {running && liveFrom && liveTo && byId.get(liveFrom) && byId.get(liveTo) ? (
          <Packet
            key={`${liveFrom}-${liveTo}-${hop}`}
            from={byId.get(liveFrom)!}
            to={byId.get(liveTo)!}
            onDone={onHopDone}
          />
        ) : null}

      </div>

      <Payload node={selected} />
    </section>
  );
}

function onFlow(flow: string[], from: string, to: string): boolean {
  for (let index = 0; index < flow.length - 1; index += 1) {
    const left = flow[index];
    const right = flow[index + 1];
    if ((left === from && right === to) || (left === to && right === from)) return true;
  }
  return false;
}

function Edge({
  edge,
  byId,
  visible,
  flow,
  selectedId,
  live,
}: {
  edge: ArchEdge;
  byId: Map<string, ArchNode>;
  visible: Set<string>;
  flow: string[];
  selectedId: string;
  live: boolean;
}) {
  if (!visible.has(edge.from) || !visible.has(edge.to)) return null;
  const a = byId.get(edge.from);
  const b = byId.get(edge.to);
  if (!a || !b) return null;
  const touched = a.id === selectedId || b.id === selectedId;
  const routed = onFlow(flow, edge.from, edge.to);
  if (!live && !touched && !routed) return null;
  const c = curveControl(a, b);
  const planned = edge.status === "planned" || a.status === "planned" || b.status === "planned";
  const color = live ? "#ecfeff" : planned ? "#c4b5fd" : routed ? "#67e8f9" : "rgba(186,210,235,0.45)";
  return (
    <path
      d={`M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`}
      fill="none"
      stroke={color}
      strokeWidth={live ? 2.4 : 1.5}
      vectorEffect="non-scaling-stroke"
      strokeDasharray={planned ? "5 5" : live ? "7 6" : undefined}
    />
  );
}

function NodeCard({
  node,
  active,
  selected,
  onSelect,
}: {
  node: ArchNode;
  active: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const planned = node.status === "planned";
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className={`absolute z-20 w-[116px] -translate-x-1/2 -translate-y-1/2 rounded-xl border px-2 py-1.5 text-left transition ${
        planned
          ? "border-dashed border-violet-300/70 bg-[#161228]/95"
          : active
            ? "border-cyan-300/70 bg-[#10202c]/95 shadow-[0_0_24px_rgba(34,211,238,0.12)]"
            : "border-white/10 bg-[#121826]/90"
      } ${selected ? "ring-2 ring-cyan-200/80" : ""} ${active ? "opacity-100" : "opacity-40"}`}
      style={{ left: `${node.x}%`, top: `${node.y}%` }}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-mono text-[9px] tracking-[0.14em] text-slate-400 uppercase">{node.kicker}</span>
        <span
          className={`rounded px-1 py-px text-[8px] tracking-wide uppercase ${
            planned ? "bg-violet-400/15 text-violet-200" : "bg-emerald-400/15 text-emerald-200"
          }`}
        >
          {planned ? "Planned" : "Built"}
        </span>
      </div>
      <div className="mt-1 line-clamp-2 text-[12px] leading-tight font-semibold text-white">{node.title}</div>
      <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-400">{node.detail}</div>
    </button>
  );
}

function Payload({ node }: { node: ArchNode | undefined }) {
  const [tab, setTab] = useState<"input" | "transform" | "output">("transform");

  if (!node) {
    return (
      <div className="mx-4 mt-3 mb-3 rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-400">
        Select a node to read its sample input, the transformation, and the output.
      </div>
    );
  }

  const body =
    tab === "input" ? node.payload.input : tab === "output" ? node.payload.output : node.payload.transform;

  return (
    <div className="mx-4 mt-3 mb-3 overflow-hidden rounded-xl border border-white/10 bg-black/25">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="text-xs font-semibold text-white">{node.title}</span>
        <span className="font-mono text-[10px] text-slate-500">
          {node.status === "planned" ? "[Planned / In Design]" : "[Implemented]"}
        </span>
        <div className="ml-auto flex gap-1">
          {(
            [
              ["input", "Input"],
              ["transform", "Transform"],
              ["output", "Output"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-md px-2 py-1 font-mono text-[10px] tracking-wide uppercase ${
                tab === id ? "bg-white/10 text-cyan-50" : "text-slate-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <pre className="payload-pre max-h-32 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-300">
        {body}
      </pre>
    </div>
  );
}
