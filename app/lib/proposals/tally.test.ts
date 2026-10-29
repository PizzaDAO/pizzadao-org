// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { countBallots, tallyProposal, type PassRule } from './tally'

const rule: PassRule = { ayesNeeded: 15, countAbstains: true, requireAyesOverNays: true }
const closes = new Date('2026-11-10T00:00:00Z')
const after = new Date('2026-11-10T00:00:01Z')

describe('tallyProposal (pass rule)', () => {
  it('passes when ayes + abstains reach the threshold and ayes beat nays', () => {
    expect(tallyProposal({ ayes: 10, nays: 3, abstains: 5 }, rule, after, closes).outcome).toBe('passed')
  })
  it('counts abstains toward the threshold, but not as ayes against nays', () => {
    expect(tallyProposal({ ayes: 5, nays: 5, abstains: 20 }, rule, after, closes).outcome).toBe('failed') // ayes == nays
    expect(tallyProposal({ ayes: 6, nays: 5, abstains: 9 }, rule, after, closes).outcome).toBe('passed') // 15 counted
    expect(tallyProposal({ ayes: 6, nays: 5, abstains: 8 }, rule, after, closes).outcome).toBe('failed') // 14 counted
  })
  it('fails a proposal with enough turnout but more nays than ayes', () => {
    expect(tallyProposal({ ayes: 10, nays: 11, abstains: 10 }, rule, after, closes).outcome).toBe('failed')
  })
  it('honours the snapshotted rule (abstains off, nay rule off)', () => {
    expect(tallyProposal({ ayes: 10, nays: 0, abstains: 10 }, { ...rule, countAbstains: false }, after, closes).outcome).toBe('failed')
    expect(tallyProposal({ ayes: 15, nays: 20, abstains: 0 }, { ...rule, requireAyesOverNays: false }, after, closes).outcome).toBe('passed')
  })
  it('uses the tier threshold it is given (15/25/35 boundaries)', () => {
    for (const need of [15, 25, 35]) {
      expect(tallyProposal({ ayes: need, nays: 0, abstains: 0 }, { ...rule, ayesNeeded: need }, after, closes).outcome).toBe('passed')
      expect(tallyProposal({ ayes: need - 1, nays: 0, abstains: 0 }, { ...rule, ayesNeeded: need }, after, closes).outcome).toBe('failed')
    }
  })
  it('never decides before closesAt, however many votes are in', () => {
    expect(tallyProposal({ ayes: 100, nays: 0, abstains: 0 }, rule, new Date('2026-11-09T23:59:59Z'), closes).outcome).toBe('pending')
  })
  it('counts ballot rows by choice', () => {
    expect(countBallots([{ choice: 'AYE' }, { choice: 'NAY' }, { choice: 'ABSTAIN' }, { choice: 'AYE' }])).toEqual({ ayes: 2, nays: 1, abstains: 1 })
  })
})
