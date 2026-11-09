import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  callRecording: { findUnique: vi.fn(), findMany: vi.fn() },
  callAttendance: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
  attendanceEdit: { findMany: vi.fn() },
}))
vi.mock('@/app/lib/db', () => ({ prisma: prismaMock }))
vi.mock('@/app/lib/attendance', () => ({ rebuildAttendanceSummaries: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({
  loadSettings: async () => new Map<string, unknown>([['calls.attendanceCrewAliases', 'community = community_call'], ['calls.attendanceMinMinutes', 5], ['calls.attendanceShortCallPercent', 50], ['calls.attendanceSpeakersAlwaysCount', true]]),
}))

import { attendeesOf, callDay, recordAttendanceForRecording, recordingAttendanceKey } from './attendance-from-recordings'
import { attendanceCrewId, crewIdsFor } from './crew-alias'
import { parseCrewAliases, SETTINGS } from '@/app/lib/settings/registry'
beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.callRecording.findMany.mockResolvedValue([])
  prismaMock.attendanceEdit.findMany.mockResolvedValue([])
})

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

describe('crew aliases', () => {
  it('parses lines, skips junk and self-maps, lower-cases', () => {
    const m = parseCrewAliases('community = community_call\nbad line\nOps=ops\n\nFoo = Bar')
    expect([...m]).toEqual([['community', 'community_call'], ['foo', 'bar']])
  })
  it('defaults to community -> community_call', () => {
    const def = (SETTINGS['calls.attendanceCrewAliases'] as { default: string }).default
    expect(attendanceCrewId('community', parseCrewAliases(def))).toBe('community_call')
    expect(attendanceCrewId('ops', parseCrewAliases(def))).toBe('ops')
  })
  it('crewIdsFor matches the canonical id and its aliases', () => {
    const al = parseCrewAliases('community = community_call')
    expect(crewIdsFor('community_call', al).sort()).toEqual(['community', 'community_call'])
  })
})

describe('Nov 8 scenario', () => {
  it('sheet rows under community_call and recording rows under community: no duplicates', async () => {
    const day = new Date('2026-11-08T00:00:00.000Z')
    const rows: Array<{ discordId: string; crewId: string; crewLabel: string; dailySheetId: string; callDate: Date }> = [
      { discordId: A, crewId: 'community_call', crewLabel: 'Community Call', dailySheetId: 'sheet1', callDate: day },
    ]
    prismaMock.callRecording.findUnique.mockResolvedValue({
      id: 'r1', durationSec: 3600, presence: [], crewId: 'community', crewLabel: 'community', startedAt: new Date('2026-11-09T00:30:00Z'), source: 'DISCORD', status: 'READY',
      participantIds: [A, B], speakers: [],
    })
    prismaMock.callAttendance.findMany.mockImplementation(async (q: { where: { crewId: { in: string[] }; discordId: { in: string[] } } }) =>
      rows.filter((r) => q.where.crewId.in.includes(r.crewId) && q.where.discordId.in.includes(r.discordId)).map((r) => ({ discordId: r.discordId })))
    prismaMock.callAttendance.createMany.mockImplementation(async ({ data }: { data: typeof rows }) => {
      rows.push(...data)
      return { count: data.length }
    })
    const res = await recordAttendanceForRecording('r1', { skipSummary: true })
    expect(res.created).toBe(1)
    expect(rows.filter((r) => r.discordId === A)).toHaveLength(1)
    const b = rows.find((r) => r.discordId === B)!
    expect(b.crewId).toBe('community_call')
    expect(b.crewLabel).toBe('Community Call')
    expect(b.dailySheetId).toBe('rec:community_call:2026-11-08')
  })
})
