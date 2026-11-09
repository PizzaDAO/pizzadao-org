import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  callRecording: { findUnique: vi.fn(), findMany: vi.fn() },
  callAttendance: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
  attendanceEdit: { findMany: vi.fn() },
}))
vi.mock('@/app/lib/db', () => ({ prisma: prismaMock }))
vi.mock('@/app/lib/attendance', () => ({ rebuildAttendanceSummaries: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({ loadSettings: async () => new Map<string, unknown>([['calls.attendanceCrewAliases', ''], ['calls.attendanceMinMinutes', 5], ['calls.attendanceShortCallPercent', 50], ['calls.attendanceSpeakersAlwaysCount', true]]) }))

import { countedAttendees, DEFAULT_THRESHOLDS, recordAttendanceForRecording, thresholdSec, type CountedRecording } from './attendance-from-recordings'
import { SETTINGS } from '@/app/lib/settings/registry'

const A = '111111111111111111'
const B = '222222222222222222'
const C = '333333333333333333'
const D = '444444444444444444'
const rec = (over: Partial<CountedRecording> = {}): CountedRecording => ({
  source: 'DISCORD',
  durationSec: 3600,
  participantIds: [],
  speakers: [],
  presence: [],
  ...over,
})
const ids = (m: Map<string, unknown>) => [...m.keys()].sort()

describe('settings defaults (Snax, 2026-11-09)', () => {
  it('5 minutes, 50 percent, speakers always count', () => {
    expect((SETTINGS['calls.attendanceMinMinutes'] as { default: number }).default).toBe(5)
    expect((SETTINGS['calls.attendanceShortCallPercent'] as { default: number }).default).toBe(50)
    expect((SETTINGS['calls.attendanceSpeakersAlwaysCount'] as { default: boolean }).default).toBe(true)
  })
})

describe('thresholdSec', () => {
  it('is the minimum for a normal call and a share of the call when it is under twice the minimum', () => {
    expect(thresholdSec(3600, DEFAULT_THRESHOLDS)).toBe(300)
    expect(thresholdSec(600, DEFAULT_THRESHOLDS)).toBe(300) // exactly 2x: still the minimum
    expect(thresholdSec(480, DEFAULT_THRESHOLDS)).toBe(240) // 50% of 8 min
    expect(thresholdSec(480, { ...DEFAULT_THRESHOLDS, shortCallPercent: 0 })).toBe(0)
  })
  it('0 minutes means anyone seen counts', () => {
    expect(thresholdSec(3600, { ...DEFAULT_THRESHOLDS, minMinutes: 0 })).toBe(0)
  })
})

describe('countedAttendees', () => {
  it('drops people under the minimum and keeps people over it', () => {
    const m = countedAttendees(
      [rec({ presence: [{ discordId: A, presentSec: 1800 }, { discordId: B, presentSec: 299 }, { discordId: C, presentSec: 300 }] })],
      DEFAULT_THRESHOLDS,
    )
    expect(ids(m)).toEqual([A, C])
    expect(m.get(A)?.presentSec).toBe(1800)
  })

  it('adds minutes up across split recordings of the same day', () => {
    const m = countedAttendees(
      [
        rec({ durationSec: 1800, presence: [{ discordId: A, presentSec: 200 }, { discordId: B, presentSec: 100 }] }),
        rec({ durationSec: 1800, presence: [{ discordId: A, presentSec: 200 }, { discordId: B, presentSec: 100 }] }),
      ],
      DEFAULT_THRESHOLDS,
    )
    expect(ids(m)).toEqual([A]) // 400 s is over 300; B has 200 s
    expect(m.get(A)?.presentSec).toBe(400)
  })

  it('uses the short-call share when the whole day is under twice the minimum', () => {
    const m = countedAttendees([rec({ durationSec: 480, presence: [{ discordId: A, presentSec: 250 }, { discordId: B, presentSec: 200 }] })], DEFAULT_THRESHOLDS)
    expect(ids(m)).toEqual([A]) // 240 s needed
  })

  it('speakers always count, unless switched off', () => {
    const r = rec({ presence: [{ discordId: A, presentSec: 60 }], speakers: [{ discordId: A, displayName: 'Ann', talkTimeSec: 20 }] })
    expect(ids(countedAttendees([r], DEFAULT_THRESHOLDS))).toEqual([A])
    expect(countedAttendees([r], DEFAULT_THRESHOLDS).get(A)?.name).toBe('Ann')
    expect(ids(countedAttendees([r], { ...DEFAULT_THRESHOLDS, speakersAlwaysCount: false }))).toEqual([])
  })

  it('a speaker missing from the presence list still counts with the setting on', () => {
    const r = rec({ presence: [{ discordId: A, presentSec: 900 }], speakers: [{ discordId: B, displayName: null, talkTimeSec: 5 }] })
    expect(ids(countedAttendees([r], DEFAULT_THRESHOLDS))).toEqual([A, B])
  })

  it('a recording without presence data keeps the old rule: everyone seen counts', () => {
    const m = countedAttendees([rec({ participantIds: [A, B], speakers: [{ discordId: C, displayName: null, talkTimeSec: 3 }] })], DEFAULT_THRESHOLDS)
    expect(ids(m)).toEqual([A, B, C])
    expect(m.get(A)?.presentSec).toBeNull()
  })

  it('mixes an old-rule recording and a measured one on the same day', () => {
    const m = countedAttendees(
      [rec({ participantIds: [A] }), rec({ presence: [{ discordId: B, presentSec: 1000 }, { discordId: D, presentSec: 10 }] })],
      DEFAULT_THRESHOLDS,
    )
    expect(ids(m)).toEqual([A, B])
  })

  it('0 minutes counts anyone seen, even for 0 seconds', () => {
    const m = countedAttendees([rec({ presence: [{ discordId: A, presentSec: 0 }] })], { ...DEFAULT_THRESHOLDS, minMinutes: 0 })
    expect(ids(m)).toEqual([A])
  })

  it('ignores non-Discord ids', () => {
    expect(ids(countedAttendees([rec({ presence: [{ discordId: 'xs:1', presentSec: 9999 }] })], DEFAULT_THRESHOLDS))).toEqual([])
  })
})

describe('recordAttendanceForRecording with measured presence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.attendanceEdit.findMany.mockResolvedValue([])
    prismaMock.callAttendance.findMany.mockResolvedValue([])
    prismaMock.callAttendance.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }))
  })
  const part = (id: string, startedAt: string, presence: Array<{ discordId: string; presentSec: number }>) => ({
    id, crewId: 'ops', crewLabel: 'Ops', startedAt: new Date(startedAt), durationSec: 1800, source: 'DISCORD', participantIds: [], status: 'READY', speakers: [], presence,
  })

  it('a later part pushes someone over the threshold: a row is added with the day total', async () => {
    const p1 = part('r1', '2026-11-03T00:30:00Z', [{ discordId: A, presentSec: 1700 }, { discordId: B, presentSec: 200 }])
    const p2 = part('r2', '2026-11-03T01:10:00Z', [{ discordId: A, presentSec: 1700 }, { discordId: B, presentSec: 200 }])
    prismaMock.callRecording.findUnique.mockResolvedValue(p1)
    prismaMock.callRecording.findMany.mockResolvedValue([p1])
    const first = await recordAttendanceForRecording('r1', { skipSummary: true })
    expect(first.created).toBe(1) // only A: B has 200 s of the 300 s needed
    prismaMock.callRecording.findUnique.mockResolvedValue(p2)
    prismaMock.callRecording.findMany.mockResolvedValue([p1, p2])
    prismaMock.callAttendance.findMany.mockResolvedValue([{ id: 1, discordId: A, source: 'recording', presentSec: 1700 }])
    const second = await recordAttendanceForRecording('r2', { skipSummary: true })
    expect(second.created).toBe(1) // B now has 400 s
    const rows = prismaMock.callAttendance.createMany.mock.calls[1][0].data as Array<{ discordId: string; presentSec: number; dailySheetId: string; recordingId: string }>
    expect(rows[0]).toMatchObject({ discordId: B, presentSec: 400, dailySheetId: 'rec:ops:2026-11-02', recordingId: 'r2' })
    // A's minutes on the existing recording row follow the day total.
    expect(prismaMock.callAttendance.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { presentSec: 3400 } })
  })

  it('does not add back someone an admin removed for that crew and day', async () => {
    const p1 = part('r1', '2026-11-03T00:30:00Z', [{ discordId: A, presentSec: 1700 }, { discordId: B, presentSec: 1700 }])
    prismaMock.callRecording.findUnique.mockResolvedValue(p1)
    prismaMock.callRecording.findMany.mockResolvedValue([p1])
    prismaMock.attendanceEdit.findMany.mockResolvedValue([
      { discordId: A, action: 'remove' },
      { discordId: B, action: 'remove' },
      { discordId: B, action: 'add' },
    ])
    await recordAttendanceForRecording('r1', { skipSummary: true })
    const rows = prismaMock.callAttendance.createMany.mock.calls[0][0].data as Array<{ discordId: string }>
    expect(rows.map((r) => r.discordId)).toEqual([B])
  })

  it('never touches sheet rows', async () => {
    const p1 = part('r1', '2026-11-03T00:30:00Z', [{ discordId: A, presentSec: 1700 }])
    prismaMock.callRecording.findUnique.mockResolvedValue(p1)
    prismaMock.callRecording.findMany.mockResolvedValue([p1])
    prismaMock.callAttendance.findMany.mockResolvedValue([{ id: 9, discordId: A, source: 'sheet', presentSec: null }])
    const res = await recordAttendanceForRecording('r1', { skipSummary: true })
    expect(res.created).toBe(0)
    expect(prismaMock.callAttendance.update).not.toHaveBeenCalled()
  })
})
