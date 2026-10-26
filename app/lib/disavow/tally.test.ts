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

describe('tallyRound', () => {
  it('2 yes is pending', () => {
    expect(tallyRound(v(2, 'YES'), ctx(at(100))).outcome).toBe('pending')
  })
  it('3 yes + 2 no passes (after 72h)', () => {
    expect(tallyRound([...v(3, 'YES'), ...v(2, 'NO')], ctx(at(100))).outcome).toBe('passed')
  })
  it('3 yes + 3 no never passes and fails at close', () => {
    const votes = [...v(3, 'YES'), ...v(3, 'NO')]
    expect(tallyRound(votes, ctx(at(100))).outcome).toBe('pending')
    expect(tallyRound(votes, ctx(closesAt)).outcome).toBe('failed')
  })
  it('cannot pass before 72h even with enough yes', () => {
    expect(tallyRound(v(5, 'YES'), ctx(at(71.9))).outcome).toBe('pending')
    expect(tallyRound(v(5, 'YES'), ctx(at(72))).outcome).toBe('passed')
  })
  it('passes exactly at the close boundary when the votes are there', () => {
    expect(tallyRound(v(3, 'YES'), ctx(closesAt)).outcome).toBe('passed')
  })
  it('fails at close with too few yes', () => {
    expect(tallyRound(v(2, 'YES'), ctx(closesAt)).outcome).toBe('failed')
    expect(tallyRound(v(2, 'YES'), ctx(new Date(closesAt.getTime() - 1))).outcome).toBe('pending')
  })
  it('ignores the nominator and the subject', () => {
    const votes: TallyVote[] = [
      ...v(2, 'YES'),
      { voterDiscordId: 'nom', choice: 'YES' },
      { voterDiscordId: 'subj', choice: 'YES' },
    ]
    const t = tallyRound(votes, ctx(at(100)))
    expect(t.yes).toBe(2)
    expect(t.outcome).toBe('pending')
  })
  it('recusals and abstentions count as neither yes nor no', () => {
    const t = tallyRound([...v(3, 'YES'), ...v(4, 'RECUSE'), ...v(4, 'ABSTAIN')], ctx(at(100)))
    expect(t).toMatchObject({ yes: 3, no: 0, recused: 4, abstain: 4, outcome: 'passed' })
  })
  it('counts one vote per voter (the latest)', () => {
    const votes: TallyVote[] = [
      { voterDiscordId: 'a', choice: 'NO' },
      { voterDiscordId: 'a', choice: 'YES' },
      ...v(2, 'YES'),
    ]
    expect(tallyRound(votes, ctx(at(100))).yes).toBe(3)
  })
  it('the same rule serves REMOVE / REAFFIRM (caller decides what pass means)', () => {
    expect(tallyRound(v(3, 'YES'), ctx(at(100))).outcome).toBe('passed')
    expect(tallyRound(v(1, 'YES'), ctx(closesAt)).outcome).toBe('failed')
  })
})
