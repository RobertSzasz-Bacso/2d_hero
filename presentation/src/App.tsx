import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import Diagram from "./Diagram";
import { type Stage, stages } from "./content";

export default function App() {
  const [index, setIndex] = useState(0);
  const [showPlanned, setShowPlanned] = useState(false);
  const [selected, setSelected] = useState(stages[0].flow[0]);
  const [running, setRunning] = useState(false);
  const [hop, setHop] = useState(0);
  const narrativeRef = useRef<HTMLDivElement>(null);
  const hopLock = useRef(false);
  const hopRef = useRef(0);
  const stage = stages[index];
  const flow = showPlanned && stage.flowPlanned ? stage.flowPlanned : stage.flow;
  const flowRef = useRef(flow);
  flowRef.current = flow;

  const go = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(stages.length - 1, next));
    setIndex(clamped);
    setRunning(false);
    setHop(0);
    const nextStage = stages[clamped];
    const nextFlow = showPlanned && nextStage.flowPlanned ? nextStage.flowPlanned : nextStage.flow;
    setSelected(nextFlow[0]);
  }, [showPlanned]);

  useEffect(() => {
    narrativeRef.current?.scrollTo({ top: 0 });
  }, [index]);

  useEffect(() => {
    hopRef.current = hop;
    hopLock.current = false;
  }, [hop, running]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        go(index + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(index - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index]);

  const onHopDone = useCallback(() => {
    if (hopLock.current) return;
    hopLock.current = true;
    const path = flowRef.current;
    const next = hopRef.current + 1;
    if (next >= path.length - 1) {
      setHop(path.length - 1);
      setSelected(path[path.length - 1]);
      setRunning(false);
      return;
    }
    setHop(next);
    setSelected(path[next]);
  }, []);

  function simulate() {
    if (flow.length < 2) {
      setSelected(flow[0]);
      return;
    }
    hopLock.current = false;
    setSelected(flow[0]);
    setHop(0);
    setRunning(true);
  }

  function choose(id: string) {
    setRunning(false);
    setSelected(id);
  }

  function togglePlanned(value: boolean) {
    setShowPlanned(value);
    setRunning(false);
    const nextFlow = value && stage.flowPlanned ? stage.flowPlanned : stage.flow;
    setHop(0);
    setSelected((current) => (nextFlow.includes(current) ? current : nextFlow[0]));
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-white/10 bg-[#070b14]/80 px-5 py-3 backdrop-blur">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-white">2D Hero</h1>
            <span className="hidden font-mono text-[10px] text-slate-500 sm:inline">schema v2 · metres · Z up</span>
          </div>
        </div>
        <span className="hidden rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-[11px] text-cyan-50 md:inline">
          Phases 1–16 shipped · Phase 17 in design
        </span>
        <nav className="ml-auto flex items-center gap-2" aria-label="Stages">
          {stages.map((item, itemIndex) => (
            <button
              key={item.id}
              type="button"
              aria-label={item.title}
              aria-current={itemIndex === index ? "step" : undefined}
              onClick={() => go(itemIndex)}
              className="group flex items-center gap-2"
            >
              <span
                className={`block h-2.5 w-2.5 rounded-full transition ${
                  itemIndex === index
                    ? "bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.9)]"
                    : itemIndex < index
                      ? "bg-cyan-300/50"
                      : "bg-white/20"
                }`}
              />
              <span className={`hidden text-[11px] lg:inline ${itemIndex === index ? "text-white" : "text-slate-500"}`}>
                {item.short}
              </span>
            </button>
          ))}
        </nav>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(300px,35%)_minmax(0,65%)]">
        <div ref={narrativeRef} className="min-h-0 overflow-y-auto border-white/10 lg:border-r">
          <AnimatePresence mode="wait">
            <motion.article
              key={stage.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28 }}
              className="px-6 py-6"
            >
              <Narrative stage={stage} />
            </motion.article>
          </AnimatePresence>
        </div>
        <Diagram
          stage={stage}
          stageIndex={index}
          showPlanned={showPlanned}
          onTogglePlanned={togglePlanned}
          selectedId={selected}
          onSelect={choose}
          running={running}
          hop={hop}
          flow={flow}
          onSimulate={simulate}
          onHopDone={onHopDone}
        />
      </main>

      <footer className="flex items-center gap-3 border-t border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          className="rounded-full border border-white/15 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-30"
        >
          ← Prev
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-cyan-300 transition-all"
              style={{ width: `${((index + 1) / stages.length) * 100}%` }}
            />
          </div>
          <p className="truncate text-center font-mono text-[11px] text-slate-400">
            {String(index + 1).padStart(2, "0")} / {String(stages.length).padStart(2, "0")} · {stage.title}
          </p>
        </div>
        <div className="hidden items-center gap-1.5 text-[11px] text-slate-500 md:flex">
          <span className="kbd">←</span>
          <span className="kbd">→</span>
          <span className="kbd">space</span>
        </div>
        <button
          type="button"
          onClick={() => go(index + 1)}
          disabled={index === stages.length - 1}
          className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-slate-950 disabled:opacity-30"
        >
          Next →
        </button>
      </footer>
    </div>
  );
}

function Narrative({ stage }: { stage: Stage }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <header>
        <p className="font-mono text-[11px] tracking-[0.18em] text-cyan-200/80 uppercase">{stage.eyebrow}</p>
        <h2 className="mt-2 text-3xl leading-tight font-semibold text-white">{stage.title}</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-300">{stage.summary}</p>
      </header>

      <section>
        <h3 className="text-xs tracking-[0.16em] text-slate-500 uppercase">Purpose</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{stage.purpose}</p>
      </section>

      <section>
        <h3 className="text-xs tracking-[0.16em] text-slate-500 uppercase">Technical challenges</h3>
        <ul className="mt-3 flex flex-col gap-3">
          {stage.challenges.map((item) => (
            <li key={item.title} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
              <p className="text-sm font-semibold text-white">{item.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-xs tracking-[0.16em] text-slate-500 uppercase">Architectural decisions</h3>
        <ul className="mt-3 flex flex-col gap-3">
          {stage.decisions.map((item) => (
            <li key={item.title}>
              <p className="text-sm font-semibold text-cyan-100">{item.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-xs tracking-[0.16em] text-slate-500 uppercase">Implementation status</h3>
        <ul className="mt-3 flex flex-col gap-2">
          {stage.statusNotes.map((note) => (
            <li key={note.text} className="flex gap-2 text-sm leading-relaxed text-slate-300">
              <span
                className={`mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] tracking-wide uppercase ${
                  note.status === "planned"
                    ? "bg-violet-400/15 text-violet-200"
                    : "bg-emerald-400/15 text-emerald-200"
                }`}
              >
                {note.status === "planned" ? "Planned" : "Implemented"}
              </span>
              <span>{note.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
