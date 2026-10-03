// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))
vi.mock('@/app/lib/mission-verify/nightly', () => ({
  runNightlyMissions: vi.fn(async () => ({ status: 'finished', runId: 7, dryRun: true, processed: 3, remaining: 0, stats: {} })),
}))
vi.mock('@/app/lib/attendance', () => ({
  syncAllCrewAttendance: vi.fn(async () => ({ newCalls: 1, newRecords: 4, crews: ['Ops'], errors: [], affectedDiscordIds: ['1', '2'] })),
}))
vi.mock('@/app/lib/mission-verify/events', () => ({ emitMissionEventMany: vi.fn(async () => undefined) }))
vi.mock('@/app/lib/mission-verify/sla', () => ({
  runSlaDigest: vi.fn(async () => ({ status: 'posted', day: '2026-10-03', overdue: 2, messageId: '1', roles: [] })),
}))

import { after } from 'next/server'
import { GET as missionsGET } from './missions/route'
import { GET as attendanceGET } from './attendance/route'
import { GET as missionSlaGET } from './mission-sla/route'
import { runSlaDigest } from '@/app/lib/mission-verify/sla'
import { runNightlyMissions } from '@/app/lib/mission-verify/nightly'
import { syncAllCrewAttendance } from '@/app/lib/attendance'

const req = (path: string, auth?: string) =>
  new NextRequest(`https://app.pizzadao.org${path}`, { headers: auth ? { authorization: auth } : {} })

let saved: string | undefined
beforeEach(() => {
  vi.clearAllMocks()
  saved = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'cron-secret'
})
afterEach(() => {
  if (saved === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = saved
})

describe.each([
  ['/api/cron/missions', missionsGET, () => runNightlyMissions],
  ['/api/cron/attendance', attendanceGET, () => syncAllCrewAttendance],
  ['/api/cron/mission-sla', missionSlaGET, () => runSlaDigest],
] as const)('%s auth', (path, GET, work) => {
  it('401 without the bearer token, and does no work', async () => {
    const res = await GET(req(path))
    expect(res.status).toBe(401)
    expect(work()).not.toHaveBeenCalled()
  })

  it('401 with a wrong token', async () => {
    const res = await GET(req(path, 'Bearer wrong'))
    expect(res.status).toBe(401)
    expect(work()).not.toHaveBeenCalled()
  })

  it('401 when CRON_SECRET is not set, whatever is sent', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(req(path, 'Bearer '))
    expect(res.status).toBe(401)
    expect(work()).not.toHaveBeenCalled()
  })

  it('200 with "Bearer $CRON_SECRET"', async () => {
    const res = await GET(req(path, 'Bearer cron-secret'))
    expect(res.status).toBe(200)
    expect(work()).toHaveBeenCalledTimes(1)
  })
})

describe('/api/cron/attendance', () => {
  it('returns the sync stats and re-checks the affected members in the background', async () => {
    const res = await attendanceGET(req('/api/cron/attendance', 'Bearer cron-secret'))
    expect(await res.json()).toEqual({ newCalls: 1, newRecords: 4, crews: ['Ops'], errors: [], affectedMembers: 2 })
    expect(after).toHaveBeenCalledTimes(1)
  })
})

describe('/api/cron/missions', () => {
  it('returns the run result', async () => {
    const res = await missionsGET(req('/api/cron/missions?slot=2', 'Bearer cron-secret'))
    expect(await res.json()).toMatchObject({ status: 'finished', runId: 7, dryRun: true })
  })

  it('500 (logged) when the run throws', async () => {
    vi.mocked(runNightlyMissions).mockRejectedValueOnce(new Error('db down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await missionsGET(req('/api/cron/missions', 'Bearer cron-secret'))
    expect(res.status).toBe(500)
    spy.mockRestore()
  })
})

describe('/api/cron/mission-sla', () => {
  it('returns the digest result', async () => {
    const res = await missionSlaGET(req('/api/cron/mission-sla', 'Bearer cron-secret'))
    expect(await res.json()).toMatchObject({ status: 'posted', overdue: 2 })
  })

  it('is scheduled daily in vercel.json', async () => {
    const { readFileSync } = await import('node:fs')
    const crons = JSON.parse(readFileSync('vercel.json', 'utf8')).crons as Array<{ path: string; schedule: string }>
    expect(crons.filter((c) => c.path === '/api/cron/mission-sla')).toEqual([{ path: '/api/cron/mission-sla', schedule: '0 15 * * *' }])
  })

  it('500 (logged) when the digest throws', async () => {
    vi.mocked(runSlaDigest).mockRejectedValueOnce(new Error('Discord down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await missionSlaGET(req('/api/cron/mission-sla', 'Bearer cron-secret'))
    expect(res.status).toBe(500)
    spy.mockRestore()
  })
})
