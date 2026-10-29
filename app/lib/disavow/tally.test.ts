// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { tallyRound, type TallyVote } from './tally'

const H = 3600_000
const opensAt = new Date('2026-11-01T00:00:00Z')
const closesAt = new Date(opensAt.getTime() + 14 * 24 * H)
const at = (hours: number) => new Date(opensAt.getTime() + hours * H)
const ctx = (now: Date, over: Partial<Parameters<typeof tallyRound>[1]> = {}) => ({
  nominatorId: 'nom', subjectIds: ['subj'], now, opensAt, closesAt, ...over,
})
const v = (n: number, choice: TallyVote['choice']): TallyVote[] =>
  Array.from({ length: n }, (_, i) => ({ voterDiscordId: `${choice}${i}`, choice }))

const D = 24
describe('tallyRound', () => {
  it('nothing is decided before day 7, however many votes are in', () => {
    expect(tallyRound(v(9, 'YES'), ctx(at(3 * D))).outcome).toBe('pending')
    expect(tallyRound(v(9, 'YES'), ctx(at(7 * D - 0.1))).outcome).toBe('pending')
    expect(tallyRound(v(9, 'YES'), ctx(at(7 * D))).outcome).toBe('passed')
  })
  it('2 yes is pending until the window closes, then fails', () => {
    expect(tallyRound(v(2, 'YES'), ctx(at(8 * D))).outcome).toBe('pending')
    expect(tallyRound(v(2, 'YES'), ctx(closesAt)).outcome).toBe('failed')
  })
  it('3 yes + 2 no passes from day 7', () => {
    expect(tallyRound([...v(3, 'YES'), ...v(2, 'NO')], ctx(at(7 * D))).outcome).toBe('passed')
  })
  it('3 yes + 3 no never passes and fails at close', () => {
    const votes = [...v(3, 'YES'), ...v(3, 'NO')]
    expect(tallyRound(votes, ctx(at(10 * D))).outcome).toBe('pending')
    expect(tallyRound(votes, ctx(closesAt)).outcome).toBe('failed')
  })
  it('quorum reached late (day 10) still passes before the 14-day close', () => {
    expect(tallyRound(v(3, 'YES'), ctx(at(10 * D))).outcome).toBe('passed')
  })
  it('passes exactly at the close boundary when the votes are there', () => {
    expect(tallyRound(v(3, 'YES'), ctx(closesAt)).outcome).toBe('passed')
  })
  it('ignores the nominator and the subject', () => {
    const votes: TallyVote[] = [
      ...v(2, 'YES'),
      { voterDiscordId: 'nom', choice: 'YES' },
      { voterDiscordId: 'subj', choice: 'YES' },
    ]
    const t = tallyRound(votes, ctx(at(8 * D)))
    expect(t.yes).toBe(2)
    expect(t.outcome).toBe('pending')
  })
  it('recusals and abstentions count as neither yes nor no', () => {
    const t = tallyRound([...v(3, 'YES'), ...v(4, 'RECUSE'), ...v(4, 'ABSTAIN')], ctx(at(8 * D)))
    expect(t).toMatchObject({ yes: 3, no: 0, recused: 4, abstain: 4, outcome: 'passed' })
  })
  it('counts one vote per voter (the latest)', () => {
    const votes: TallyVote[] = [
      { voterDiscordId: 'a', choice: 'NO' },
      { voterDiscordId: 'a', choice: 'YES' },
      ...v(2, 'YES'),
    ]
    expect(tallyRound(votes, ctx(at(8 * D))).yes).toBe(3)
  })

  it('a round counts under the rules it opened with, not the current defaults', () => {
    // opened with a threshold of 5 and 3 decision days
    const rules = { yesThreshold: 5, decisionDays: 3 }
    expect(tallyRound(v(4, 'YES'), ctx(at(5 * D), rules)).outcome).toBe('pending')
    expect(tallyRound(v(5, 'YES'), ctx(at(2 * D), rules)).outcome).toBe('pending') // not before day 3
    expect(tallyRound(v(5, 'YES'), ctx(at(3 * D), rules)).outcome).toBe('passed')
    expect(tallyRound(v(4, 'YES'), ctx(closesAt, rules)).outcome).toBe('failed')
  })
  it('a round with no snapshot (opened before it existed) keeps 3 votes and 7 days', () => {
    const none = { yesThreshold: null, decisionDays: null }
    expect(tallyRound(v(3, 'YES'), ctx(at(6 * D), none)).outcome).toBe('pending')
    expect(tallyRound(v(3, 'YES'), ctx(at(7 * D), none)).outcome).toBe('passed')
    expect(tallyRound(v(2, 'YES'), ctx(at(7 * D), none)).outcome).toBe('pending')
  })
})
