import { describe, expect, it } from 'vitest'
import type { PostFilter } from '@/app/lib/calls/post-filters'
import { COMMUNITY_CREW_ID, crewIdsFromCell, dueOccurrences, isDue, refKeyFor, wantsCrew, type CrewLite, type RawEvent } from './schedule'

const now = new Date('2026-11-10T12:00:00Z')
const at = (min: number) => new Date(now.getTime() + min * 60_000)
const LEAD = 60 * 60_000
const crews: CrewLite[] = [
  { id: 'community_call', label: 'Community Call', event: '111111111111111111' },
  { id: 'ops', label: 'Ops Crew', event: '222222222222222222' },
  { id: 'hidden', label: 'Hidden', event: '333333333333333333' },
]
const filter: PostFilter = { excludedCrewIds: ['hidden'], excludedCrewLabelTerms: [], blockedTerms: [] }
const ev = (id: string, min: number, status = 1, name = ''): RawEvent => ({ id, name, status, startsAt: at(min) })
const due = (events: RawEvent[]) => dueOccurrences({ events, crews, filter, now, leadMs: LEAD })

describe('isDue window', () => {
  it('is due only when more than 5 and at most 60 minutes away', () => {
    expect(isDue(at(60), now, LEAD)).toBe(true)
    expect(isDue(at(55), now, LEAD)).toBe(true)
    expect(isDue(at(61), now, LEAD)).toBe(false)
    expect(isDue(at(5.01), now, LEAD)).toBe(true)
    expect(isDue(at(5), now, LEAD)).toBe(false)
    expect(isDue(at(0), now, LEAD)).toBe(false)
    expect(isDue(at(-3), now, LEAD)).toBe(false)
  })
})

describe('dueOccurrences', () => {
  it('maps events to crews and keys each occurrence by event id and start', () => {
    const [o] = due([ev('111111111111111111', 50)])
    expect(o).toMatchObject({ crewId: COMMUNITY_CREW_ID, crewLabel: 'Community Call', eventId: '111111111111111111' })
    expect(o.refKey).toBe(refKeyFor('111111111111111111', at(50)))
  })
  it('skips cancelled, completed and active events', () => {
    expect(due([ev('111111111111111111', 50, 4), ev('111111111111111111', 50, 3), ev('111111111111111111', 50, 2)])).toEqual([])
  })
  it('skips unmapped events and events of an excluded crew', () => {
    expect(due([ev('999999999999999999', 50, 1, 'Random hangout'), ev('333333333333333333', 50)])).toEqual([])
  })
  it('skips events outside the window', () => {
    expect(due([ev('111111111111111111', 4), ev('111111111111111111', 90)])).toEqual([])
  })
  it('a moved occurrence gets a new refKey; an unmoved one keeps its key', () => {
    const a = due([ev('111111111111111111', 50)])[0].refKey
    const moved = due([ev('111111111111111111', 40)])[0].refKey
    expect(moved).not.toBe(a)
    expect(due([ev('111111111111111111', 50)])[0].refKey).toBe(a)
  })
  it('uses an event already moved by the DST sync as is (its start time is the truth)', () => {
    const shifted = due([ev('111111111111111111', 58)])
    expect(shifted).toHaveLength(1)
    expect(shifted[0].startsAt).toEqual(at(58))
  })
  it('sorts soonest first', () => {
    const out = due([ev('222222222222222222', 50), ev('111111111111111111', 20)])
    expect(out.map((o) => o.crewId)).toEqual(['community_call', 'ops'])
  })
})

describe('wantsCrew (opt-in resolution)', () => {
  it('NONE wants nothing', () => {
    expect(wantsCrew({ calls: 'NONE', crewIds: [] }, 'community_call', ['community_call'])).toBe(false)
  })
  it('COMMUNITY wants only the Community Call', () => {
    expect(wantsCrew({ calls: 'COMMUNITY', crewIds: [] }, 'community_call', [])).toBe(true)
    expect(wantsCrew({ calls: 'COMMUNITY', crewIds: [] }, 'ops', ['ops'])).toBe(false)
  })
  it('MY_CREWS wants the Community Call plus the crews in the member row, resolved now', () => {
    expect(wantsCrew({ calls: 'MY_CREWS', crewIds: [] }, 'community_call', [])).toBe(true)
    expect(wantsCrew({ calls: 'MY_CREWS', crewIds: [] }, 'ops', ['ops'])).toBe(true)
    // A crew left since: no longer reminded.
    expect(wantsCrew({ calls: 'MY_CREWS', crewIds: [] }, 'ops', [])).toBe(false)
  })
  it('SELECTED wants the chosen crews', () => {
    expect(wantsCrew({ calls: 'SELECTED', crewIds: ['ops'] }, 'ops', [])).toBe(true)
    expect(wantsCrew({ calls: 'SELECTED', crewIds: ['ops'] }, 'community_call', [])).toBe(false)
  })
})

describe('crewIdsFromCell', () => {
  it('maps labels and ids, drops unknown names and "none"', () => {
    expect(crewIdsFromCell('Ops Crew, Community Call, Nope', crews)).toEqual(['ops', 'community_call'])
    expect(crewIdsFromCell('None', crews)).toEqual([])
    expect(crewIdsFromCell(undefined, crews)).toEqual([])
  })
})
