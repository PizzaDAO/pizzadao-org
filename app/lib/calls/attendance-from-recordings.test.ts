import { describe, expect, it } from 'vitest'
import { attendeesOf, callDay, recordingAttendanceKey } from './attendance-from-recordings'

const A = '111111111111111111'
const B = '222222222222222222'
const C = '333333333333333333'

describe('attendeesOf', () => {
  it('counts silent participants and speakers once', () => {
    const m = attendeesOf({
      source: 'DISCORD',
      participantIds: [A, B],
      speakers: [
        { discordId: B, displayName: 'Bee', talkTimeSec: 30 },
        { discordId: C, displayName: 'Cee', talkTimeSec: 5 },
      ],
    })
    expect([...m.keys()].sort()).toEqual([A, B, C])
    expect(m.get(B)).toBe('Bee')
    expect(m.get(A)).toBeNull()
  })
  it('ignores chat-only speakers and non-Discord ids', () => {
    const m = attendeesOf({
      source: 'DISCORD',
      participantIds: [],
      speakers: [
        { discordId: A, displayName: null, talkTimeSec: 0 },
        { discordId: 'xs:1', displayName: null, talkTimeSec: 9 },
      ],
    })
    expect(m.size).toBe(0)
  })
  it('skips imported calls without participant ids, keeps them with', () => {
    const sp = [{ discordId: A, displayName: null, talkTimeSec: 10 }]
    expect(attendeesOf({ source: 'X', participantIds: [], speakers: sp }).size).toBe(0)
    expect([...attendeesOf({ source: 'X', participantIds: [B], speakers: sp }).keys()].sort()).toEqual([A, B])
  })
})

describe('call day', () => {
  it('uses the Eastern calendar day, so two parts of an evening call share a key', () => {
    const part1 = callDay(new Date('2026-11-03T00:30:00Z')) // Nov 2, 7:30pm ET
    const part2 = callDay(new Date('2026-11-03T02:10:00Z')) // Nov 2, 9:10pm ET
    expect(part1.toISOString()).toBe('2026-11-02T00:00:00.000Z')
    expect(recordingAttendanceKey('ops', part1)).toBe(recordingAttendanceKey('ops', part2))
    expect(recordingAttendanceKey('ops', part1)).toBe('rec:ops:2026-11-02')
  })
})
