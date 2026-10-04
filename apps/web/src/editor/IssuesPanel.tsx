import type { Issue, Level } from "@/core/plan-types.ts"
import type { SelectionItem } from "./select.ts"
import { useEditor } from "./store.ts"

const noIssues: Issue[] = []

export default function IssuesPanel() {
  const issues = useEditor((state) => state.history?.plan.detection.issues ?? noIssues)
  if (issues.length === 0) {
    return null
  }
  return (
    <aside
      data-testid="issues-panel"
      className="absolute bottom-3 left-16 z-10 max-h-48 w-72 overflow-auto rounded border border-slate-200 bg-white p-2 text-sm shadow"
    >
      <p className="mb-1 font-medium text-slate-700">Issues</p>
      <ul className="space-y-1">
        {issues.map((issue) => (
          <li key={issue.id}>
            <button
              type="button"
              data-testid={`issue-${issue.id}`}
              className="w-full rounded px-2 py-1 text-left hover:bg-slate-100"
              onClick={() => selectIssue(issue)}
            >
              {issue.message}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function selectIssue(issue: Issue) {
  const plan = useEditor.getState().history?.plan
  if (!plan || !issue.elementId) {
    return
  }
  for (const level of plan.levels) {
    const kind = kindOf(level, issue.elementId)
    if (!kind) {
      continue
    }
    useEditor.getState().setActiveLevel(level.id)
    useEditor.getState().setSelection([{ kind, id: issue.elementId }])
    return
  }
}

function kindOf(level: Level, id: string): SelectionItem["kind"] | null {
  if (level.walls.some((wall) => wall.id === id)) {
    return "wall"
  }
  if (level.rooms.some((room) => room.id === id)) {
    return "room"
  }
  if (level.vertices.some((vertex) => vertex.id === id)) {
    return "vertex"
  }
  if (level.openings.some((opening) => opening.id === id)) {
    return "opening"
  }
  if (level.columns.some((column) => column.id === id)) {
    return "column"
  }
  if (level.fixtures.some((fixture) => fixture.id === id)) {
    return "fixture"
  }
  if (level.texts.some((text) => text.id === id)) {
    return "text"
  }
  if (level.separators.some((separator) => separator.id === id)) {
    return "separator"
  }
  if (level.stairs.some((stair) => stair.id === id)) {
    return "stair"
  }
  return null
}
