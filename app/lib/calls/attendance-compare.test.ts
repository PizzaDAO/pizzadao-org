// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => {
  const m = {
    callRecording: { findMany: vi.fn() },
    callAttendance: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn((a: unknown) => ({ op: 'create', a })), deleteMany: vi.fn((a: unknown) => ({ op: 'deleteMany', a })) },
    attendanceEdit: { findMany: vi.fn(), create: vi.fn((a: unknown) => ({ op: 'edit', a })) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  }
  return m
})
const requireCallReviewer = vi.hoisted(() => vi.fn())
const rebuild = vi.hoisted(() => vi.fn())
vi.mock('@/app/lib/db', () => ({ prisma: prismaMock }))
vi.mock('@/app/lib/attendance', () => ({ rebuildAttendanceSummaries: rebuild }))
vi.mock('@/app/lib/calls/access', () => ({ requireCallReviewer }))
vi.mock('@/app/lib/settings', () => ({
  loadSettings: async () => new Map<string, unknown>([['calls.attendanceCrewAliases', 'community = community_call'], ['calls.attendanceMinMinutes', 5], ['calls.attendanceShortCallPercent', 50], ['calls.attendanceSpeakersAlwaysCount', true]]),
}))

import { buildCompareReport, compareDay, editAttendance } from './attendance-compare'
import { GET, POST } from '@/app/api/admin/calls/attendance/route'

const A = '111111111111111111'
const B = '222222222222222222'
const C = '333333333333333333'
const D = '444444444444444444'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.callRecording.findMany.mockResolvedValue([])
  prismaMock.callAttendance.findMany.mockResolvedValue([])
  prismaMock.callAttendance.findFirst.mockResolvedValue(null)
  prismaMock.attendanceEdit.findMany.mockResolvedValue([])
  rebuild.mockResolvedValue(0)
  requireCallReviewer.mockResolvedValue({ ok: true, session: { discordId: '999999999999999999' } })
})

describe('compareDay', () => {
  it('splits people into both, recording-only, sheet-only and manual', () => {
    const r = compareDay({
      recording: new Map([[A, { name: 'Ann', presentSec: 1800 }], [B, { name: 'Bo', presentSec: 600 }], [D, { name: 'Di', presentSec: 400 }]]),
      sheet: [{ discordId: A, displayName: 'Ann' }, { discordId: C, displayName: 'Cy' }],
      manual: [{ discordId: D, displayName: 'Di' }],
    })
    expect(r.both).toEqual([{ discordId: A, name: 'Ann', minutes: 30 }])
    expect(r.recordingOnly).toEqual([{ discordId: B, name: 'Bo', minutes: 10 }])
    expect(r.sheetOnly).toEqual([{ discordId: C, name: 'Cy', minutes: null }])
    expect(r.manual.map((p) => p.discordId)).toEqual([D])
  })

  it('a person an admin removed leaves the recording side', () => {
    const r = compareDay({ recording: new Map([[A, { name: 'Ann', presentSec: 900 }]]), sheet: [], manual: [], removed: new Set([A]) })
    expect(r.recordingOnly).toEqual([])
    expect(r.both).toEqual([])
  })
})

describe('buildCompareReport', () => {
  it('compares recordings (thresholds applied) with sheet rows under the canonical crew id', async () => {
    prismaMock.callRecording.findMany.mockResolvedValue([
      {
        crewId: 'community', crewLabel: 'Community', startedAt: new Date('2026-11-09T00:30:00Z'), durationSec: 3600, source: 'DISCORD', participantIds: [],
        speakers: [], presence: [{ discordId: A, presentSec: 3000 }, { discordId: B, presentSec: 60 }, { discordId: D, presentSec: 900 }],
      },
    ])
    prismaMock.callAttendance.findMany.mockResolvedValue([
      { discordId: A, displayName: 'Ann', crewId: 'community_call', crewLabel: 'Community Call', callDate: new Date('2026-11-08T00:00:00Z'), source: 'sheet' },
      { discordId: C, displayName: 'Cy', crewId: 'community_call', crewLabel: 'Community Call', callDate: new Date('2026-11-08T00:00:00Z'), source: 'sheet' },
    ])
    const report = await buildCompareReport({ days: 30, now: new Date('2026-11-10T00:00:00Z') })
    expect(report).toHaveLength(1)
    const day = report[0]
    expect(day).toMatchObject({ crewId: 'community_call', date: '2026-11-08', recordings: 1 })
    expect(day.both.map((p) => p.discordId)).toEqual([A])
    expect(day.recordingOnly.map((p) => p.discordId)).toEqual([D]) // B was under 5 minutes
    expect(day.sheetOnly.map((p) => p.discordId)).toEqual([C])
  })
})

describe('editAttendance', () => {
  const base = { discordId: A, crewId: 'ops', date: '2026-11-02', actorId: '999999999999999999' }

  it('add writes a manual row and an audit row, then rebuilds the summary', async () => {
    const res = await editAttendance({ ...base, action: 'add', reason: 'was on the call' })
    expect(res).toEqual({ ok: true, changed: true })
    const ops = prismaMock.$transaction.mock.calls[0][0] as Array<{ op: string; a: { data: Record<string, unknown> } }>
    expect(ops[0].a.data).toMatchObject({ discordId: A, crewId: 'ops', source: 'manual', dailySheetId: 'manual:ops:2026-11-02' })
    expect(ops[1].a.data).toMatchObject({ action: 'add', actorId: base.actorId, reason: 'was on the call' })
    expect(rebuild).toHaveBeenCalledWith([A])
  })

  it('add refuses someone already counted that day', async () => {
    prismaMock.callAttendance.findFirst.mockResolvedValueOnce({ id: 1 })
    expect(await editAttendance({ ...base, action: 'add' })).toMatchObject({ ok: false, status: 409 })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('add under an aliased crew id lands on the canonical crew', async () => {
    await editAttendance({ ...base, crewId: 'community', action: 'add' })
    const ops = prismaMock.$transaction.mock.calls[0][0] as Array<{ a: { data: Record<string, unknown> } }>
    expect(ops[0].a.data.crewId).toBe('community_call')
  })

  it('remove deletes a recording or manual row and records who and what', async () => {
    prismaMock.callAttendance.findMany.mockResolvedValueOnce([{ id: 7, source: 'recording' }])
    expect(await editAttendance({ ...base, action: 'remove', reason: 'wrong person' })).toEqual({ ok: true, changed: true })
    const ops = prismaMock.$transaction.mock.calls[0][0] as Array<{ op: string; a: { where?: unknown; data?: Record<string, unknown> } }>
    expect(ops[0]).toMatchObject({ op: 'deleteMany', a: { where: { id: { in: [7] } } } })
    expect(ops[1].a.data).toMatchObject({ action: 'remove', source: 'recording', actorId: base.actorId })
  })

  it('remove never deletes sheet rows', async () => {
    prismaMock.callAttendance.findMany.mockResolvedValueOnce([{ id: 7, source: 'sheet' }])
    expect(await editAttendance({ ...base, action: 'remove' })).toMatchObject({ ok: false, status: 400 })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('remove of someone not counted is a 404', async () => {
    expect(await editAttendance({ ...base, action: 'remove' })).toMatchObject({ ok: false, status: 404 })
  })
})

describe('/api/admin/calls/attendance', () => {
  const post = (body: unknown) => POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }))

  it('is closed to everyone but the reviewer', async () => {
    const denied = { ok: false, response: new Response(null, { status: 403 }) }
    requireCallReviewer.mockResolvedValue(denied)
    expect((await post({ action: 'add' })).status).toBe(403)
    expect((await GET(new Request('http://x/api?days=7'))).status).toBe(403)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it.each([
    ['bad action', { action: 'nuke', discordId: A, crewId: 'ops', date: '2026-11-02' }],
    ['bad discord id', { action: 'add', discordId: 'x', crewId: 'ops', date: '2026-11-02' }],
    ['bad crew id', { action: 'add', discordId: A, crewId: 'a b', date: '2026-11-02' }],
    ['bad date', { action: 'add', discordId: A, crewId: 'ops', date: '2026-13-45' }],
    ['long reason', { action: 'add', discordId: A, crewId: 'ops', date: '2026-11-02', reason: 'x'.repeat(201) }],
  ])('rejects %s', async (_n, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
  })

  it('records the signed-in admin as the actor', async () => {
    const res = await post({ action: 'add', discordId: A, crewId: 'ops', date: '2026-11-02' })
    expect(res.status).toBe(200)
    const ops = prismaMock.$transaction.mock.calls[0][0] as Array<{ a: { data: Record<string, unknown> } }>
    expect(ops[1].a.data.actorId).toBe('999999999999999999')
  })
})
