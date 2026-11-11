/**
 * Crew tasks carry their goal as free text (CrewTask.goal, no foreign key), so a goal's tasks are
 * the tasks whose goal text equals the goal's description once case and spacing are ignored.
 */
export const normalizeGoalText = (s: string | null | undefined): string => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

export function tasksForGoal<T extends { goal?: string }>(goal: { description: string }, tasks: T[]): T[] {
  const key = normalizeGoalText(goal.description)
  if (!key) return []
  return tasks.filter((t) => normalizeGoalText(t.goal) === key)
}

/** Done or skipped (the same stages the task list treats as closed). */
export const isClosedTask = (t: { stage?: string }): boolean => {
  const s = (t.stage ?? '').trim().toLowerCase()
  return s === 'done' || s === 'complete' || s === 'completed' || s === 'skip' || s === 'skipped'
}
