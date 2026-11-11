import { describe, expect, it } from 'vitest'
import { isClosedTask, tasksForGoal } from './goal-tasks'

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

describe('isClosedTask', () => {
  it('treats done and skipped stages as closed', () => {
    expect(isClosedTask({ stage: 'Done' })).toBe(true)
    expect(isClosedTask({ stage: ' skipped ' })).toBe(true)
    expect(isClosedTask({ stage: 'Doing' })).toBe(false)
    expect(isClosedTask({})).toBe(false)
  })
})
