// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const BOT = '222222222222222222'
const A = '111111111111111111'
const state = vi.hoisted(() => ({ unreadable: false }))
const prismaMock = vi.hoisted(() => ({
  callRecording: { findUnique: vi.fn(), findMany: vi.fn() },
  callAttendance: { findMany: vi.fn(), findFirst: vi.fn(), createMany: vi.fn(), update: vi.fn() },
  attendanceEdit: { findMany: vi.fn() },
}))
vi.mock('@/app/lib/db', () => ({ prisma: prismaMock }))
vi.mock('@/app/lib/attendance', () => ({ rebuildAttendanceSummaries: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({
  loadSettings: async () => ({
    readFailed: state.unreadable,
    invalidKeys: [],
    isSet: () => false,
    get: (k: string) => ({ 'calls.attendanceCrewAliases': '', 'calls.attendanceMinMinutes': 5, 'calls.attendanceShortCallPercent': 50, 'calls.attendanceSpeakersAlwaysCount': true, 'calls.attendanceExcludeIds': BOT })[k] ?? '',
  }),
}))

import { recordAttendanceForRecording } from './attendance-from-recordings'
import { editAttendance } from './attendance-compare'

const rec = { id: 'r1', crewId: 'ops', crewLabel: 'Ops', startedAt: new Date('2026-11-03T00:30:00Z'), durationSec: 1800, scheduledSec: null, source: 'DISCORD', participantIds: [], status: 'READY', speakers: [], presence: [{ discordId: A, presentSec: 1700 }, { discordId: BOT, presentSec: 1700 }] }

beforeEach(() => {
  vi.clearAllMocks()
  state.unreadable = false
  prismaMock.callRecording.findUnique.mockResolvedValue(rec)
  prismaMock.callRecording.findMany.mockResolvedValue([rec])
  prismaMock.attendanceEdit.findMany.mockResolvedValue([])
  prismaMock.callAttendance.findMany.mockResolvedValue([])
  prismaMock.callAttendance.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }))
})

describe('excluded accounts when writing attendance', () => {
  it('never writes a row for an excluded id', async () => {
    const r = await recordAttendanceForRecording('r1', { skipSummary: true })
    expect(r.created).toBe(1)
    expect((prismaMock.callAttendance.createMany.mock.calls[0][0].data as Array<{ discordId: string }>).map((d) => d.discordId)).toEqual([A])
  })

  it('writes nothing when the settings are unreadable and the list was never seen', async () => {
    state.unreadable = true
    const r = await recordAttendanceForRecording('r1', { skipSummary: true })
    expect(r.skipped).toBe('settings-unreadable')
    expect(prismaMock.callAttendance.createMany).not.toHaveBeenCalled()
  })

  it('refuses a manual add of an excluded id', async () => {
    const out = await editAttendance({ action: 'add', discordId: BOT, crewId: 'ops', date: '2026-11-03', actorId: A })
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect(prismaMock.callAttendance.findFirst).not.toHaveBeenCalled()
  })
})
