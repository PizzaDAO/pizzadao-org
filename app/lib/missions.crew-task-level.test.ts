// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { computeCurrentLevel } from './missions'

// Level 3 gains a required third mission (L3.2 "Complete a task from a crew", id 12) after some members
// were already paid for L3 with only L3.0 and L3.1 approved.
const MISSIONS = [
  { id: 1, level: 1 },
  { id: 2, level: 2 },
  { id: 10, level: 3 },
  { id: 11, level: 3 },
  { id: 12, level: 3 }, // the new required mission
  { id: 20, level: 4 },
]

describe('adding the required L3.2 mission', () => {
  it('a member who already got the L3 reward stays at their level (L4)', () => {
    const approved = new Set([1, 2, 10, 11])
    expect(computeCurrentLevel(MISSIONS, approved, new Set([1, 2, 3]))).toBe(4)
  })
  it('keeps them there even with later levels partly done', () => {
    expect(computeCurrentLevel(MISSIONS, new Set([1, 2, 10, 11, 20]), new Set([1, 2, 3]))).toBe(5)
  })
  it('a member not yet paid for L3 now needs the new mission', () => {
    const approved = new Set([1, 2, 10, 11])
    expect(computeCurrentLevel(MISSIONS, approved, new Set([1, 2]))).toBe(3)
    expect(computeCurrentLevel(MISSIONS, new Set([...approved, 12]), new Set([1, 2]))).toBe(4)
  })
})
