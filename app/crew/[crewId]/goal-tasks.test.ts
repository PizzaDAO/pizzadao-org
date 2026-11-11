import { describe, expect, it } from 'vitest'
import { tasksForGoal } from './goal-tasks'

describe('tasksForGoal', () => {
  const tasks = [
    { task: 'A', goal: 'Grow the  crew' },
    { task: 'B', goal: 'other' },
    { task: 'C', goal: ' grow the crew ' },
    { task: 'D' },
  ]
  it('matches on the goal text ignoring case and spacing', () => {
    expect(tasksForGoal({ description: 'Grow the crew' }, tasks).map((t) => t.task)).toEqual(['A', 'C'])
  })
  it('returns nothing for an empty goal or no matches', () => {
    expect(tasksForGoal({ description: '' }, tasks)).toEqual([])
    expect(tasksForGoal({ description: 'Missing' }, tasks)).toEqual([])
  })
})
