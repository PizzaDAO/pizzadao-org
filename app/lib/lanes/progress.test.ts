import { describe, it, expect } from 'vitest'
import { applyStepTick, computeProgress, pickPinned } from './progress'

const steps = [
  { id: 'a', kind: 'read' },
  { id: 'b', kind: 'do' },
  { id: 'c', kind: 'submit' },
]

describe('computeProgress', () => {
  it('counts ticked steps among the current steps only (deleted steps drop out)', () => {
    expect(computeProgress(steps, ['a', 'gone'])).toEqual({ done: 1, total: 3, doneIds: ['a'] })
  })
  it('a submit step follows the mission, not a tick', () => {
    expect(computeProgress(steps, ['a', 'b', 'c'], false).doneIds).toEqual(['a', 'b'])
    expect(computeProgress(steps, [], true)).toEqual({ done: 1, total: 3, doneIds: ['c'] })
  })
  it('handles a lane with no steps', () => {
    expect(computeProgress([], ['a'])).toEqual({ done: 0, total: 0, doneIds: [] })
  })
})

describe('pickPinned', () => {
  const d = (s: string) => new Date(s)
  it('the latest pinnedAt wins; never-pinned rows do not count', () => {
    const rows = [
      { laneSlug: 'host', pinnedAt: d('2026-01-01') },
      { laneSlug: 'build', pinnedAt: d('2026-03-01') },
      { laneSlug: 'grow', pinnedAt: null },
    ]
    expect(pickPinned(rows)?.laneSlug).toBe('build')
    expect(pickPinned([{ laneSlug: 'grow', pinnedAt: null }])).toBeNull()
    expect(pickPinned([])).toBeNull()
  })
})

describe('applyStepTick', () => {
  it('is idempotent and ignores unknown step ids', () => {
    expect(applyStepTick([], 'a', true, ['a', 'b'])).toEqual(['a'])
    expect(applyStepTick(['a'], 'a', true, ['a', 'b'])).toEqual(['a'])
    expect(applyStepTick(['a'], 'a', false, ['a', 'b'])).toEqual([])
    expect(applyStepTick(['a'], 'zzz', true, ['a', 'b'])).toEqual(['a'])
  })
  it('drops ids of deleted steps while saving', () => {
    expect(applyStepTick(['a', 'gone'], 'b', true, ['a', 'b'])).toEqual(['a', 'b'])
  })
})
