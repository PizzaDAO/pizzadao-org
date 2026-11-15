/**
 * Pure guide/pin logic (plans/lane-cards-mission-onboarding.md): progress counts and which of a
 * member's lane rows is the pinned one. No I/O, client-safe.
 */
export interface StepLike {
  id: string
  kind: string
}

/**
 * Progress over the CURRENT steps: ids of deleted steps drop out. A `submit` step counts as done
 * when the mission completion is pending or approved (`submitDone`), not from a tick.
 */
export function computeProgress(steps: StepLike[], doneStepIds: string[], submitDone = false): { done: number; total: number; doneIds: string[] } {
  const ticked = new Set(doneStepIds)
  const doneIds = steps.filter((s) => (s.kind === 'submit' ? submitDone : ticked.has(s.id))).map((s) => s.id)
  return { done: doneIds.length, total: steps.length, doneIds }
}

export interface MemberLaneRow {
  laneSlug: string
  pinnedAt: Date | null
}

/** The pinned lane is the row with the latest `pinnedAt`; rows never pinned don't count. */
export function pickPinned<T extends MemberLaneRow>(rows: T[]): T | null {
  let best: T | null = null
  for (const r of rows) {
    if (!r.pinnedAt) continue
    if (!best || r.pinnedAt.getTime() > (best.pinnedAt as Date).getTime()) best = r
  }
  return best
}

/** Add or remove a step id (idempotent), keeping only ids of current steps. */
export function applyStepTick(current: string[], stepId: string, done: boolean, validStepIds: string[]): string[] {
  const valid = new Set(validStepIds)
  const next = new Set(current.filter((id) => valid.has(id)))
  if (!valid.has(stepId)) return [...next]
  if (done) next.add(stepId)
  else next.delete(stepId)
  return [...next]
}
