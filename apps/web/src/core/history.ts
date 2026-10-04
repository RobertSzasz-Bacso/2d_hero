import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer"
import type { Plan } from "./plan-types.ts"
import { editorTolerances } from "./tolerances.ts"

enablePatches()

type Step = {
  patches: Patch[]
  inverse: Patch[]
}

export class PlanHistory {
  private current: Plan
  private undoStack: Step[] = []
  private redoStack: Step[] = []
  private transactionBase: Plan | null = null

  constructor(plan: Plan) {
    this.current = plan
  }

  get plan(): Plan {
    return this.current
  }

  begin(): void {
    this.transactionBase = this.current
  }

  commitPlan(next: Plan): void {
    if (this.transactionBase) {
      this.current = next
      return
    }
    this.record(this.current, next)
  }

  end(): void {
    if (!this.transactionBase) {
      return
    }
    const base = this.transactionBase
    this.transactionBase = null
    this.record(base, this.current)
  }

  undo(): void {
    const step = this.undoStack.pop()
    if (!step) {
      return
    }
    this.current = applyPatches(this.current, step.inverse)
    this.redoStack.push(step)
  }

  redo(): void {
    const step = this.redoStack.pop()
    if (!step) {
      return
    }
    this.current = applyPatches(this.current, step.patches)
    this.undoStack.push(step)
  }

  private record(base: Plan, next: Plan): void {
    const [produced, patches, inverse] = produceWithPatches(base, (draft) => {
      draft.schemaVersion = next.schemaVersion
      draft.units = next.units
      draft.revision = next.revision
      draft.project = next.project
      draft.levels = next.levels
      draft.sheet = next.sheet
      draft.detection = next.detection
    })
    this.current = produced
    if (!patches || patches.length === 0 || !inverse) {
      return
    }
    this.undoStack.push({ patches, inverse })
    if (this.undoStack.length > editorTolerances.history_limit) {
      this.undoStack.shift()
    }
    this.redoStack = []
  }
}
