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

vi.mock('@/app/lib/slices/mint-queue', () => ({
  processMintQueue: vi.fn(async () => ({ status: 'skipped', reason: 'disabled' })),
}))
vi.mock('@/app/lib/passport/scrub', () => ({ scrubCoordinates: vi.fn(async () => 4) }))
vi.mock('@/app/lib/slices/claims', () => ({ sweepAwaitingWallet: vi.fn(async () => 0) }))

vi.mock('@/app/lib/trainee-nick-run', () => ({
  runTraineeNicks: vi.fn(async ({ dryRun }: { dryRun: boolean }) => ({ status: 'finished', dryRun })),
}))

import { after } from 'next/server'
import { GET as missionsGET } from './missions/route'
import { GET as attendanceGET } from './attendance/route'
import { GET as missionSlaGET } from './mission-sla/route'
import { GET as traineeNicksGET } from './trainee-nicks/route'
import { GET as slicesMintGET } from './slices-mint/route'
import { GET as passportScrubGET } from './passport-scrub/route'
import { scrubCoordinates } from '@/app/lib/passport/scrub'
import { processMintQueue } from '@/app/lib/slices/mint-queue'
import { runTraineeNicks } from '@/app/lib/trainee-nick-run'
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
  ['/api/cron/trainee-nicks', traineeNicksGET, () => runTraineeNicks],
  ['/api/cron/slices-mint', slicesMintGET, () => processMintQueue],
  ['/api/cron/passport-scrub', passportScrubGET, () => scrubCoordinates],
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

describe('/api/cron/trainee-nicks', () => {
  const run = async (path: string, flag?: string) => {
    const saved = process.env.TRAINEE_NICK_ENABLED
    if (flag === undefined) delete process.env.TRAINEE_NICK_ENABLED
    else process.env.TRAINEE_NICK_ENABLED = flag
    try {
      await traineeNicksGET(req(path, 'Bearer cron-secret'))
    } finally {
      if (saved === undefined) delete process.env.TRAINEE_NICK_ENABLED
      else process.env.TRAINEE_NICK_ENABLED = saved
    }
    return vi.mocked(runTraineeNicks).mock.calls.at(-1)![0]
  }

  it('is a dry run unless TRAINEE_NICK_ENABLED=true', async () => {
    expect(await run('/api/cron/trainee-nicks')).toEqual({ dryRun: true })
    expect(await run('/api/cron/trainee-nicks', 'false')).toEqual({ dryRun: true })
    expect(await run('/api/cron/trainee-nicks', 'true')).toEqual({ dryRun: false })
  })

  it('?dryRun=1 forces a dry run even when enabled', async () => {
    expect(await run('/api/cron/trainee-nicks?dryRun=1', 'true')).toEqual({ dryRun: true })
  })

  it('is scheduled every 10 minutes in vercel.json', async () => {
    const { readFileSync } = await import('node:fs')
    const crons = JSON.parse(readFileSync('vercel.json', 'utf8')).crons as Array<{ path: string; schedule: string }>
    expect(crons.filter((c) => c.path === '/api/cron/trainee-nicks')).toEqual([{ path: '/api/cron/trainee-nicks', schedule: '*/10 * * * *' }])
  })

  it('500 (logged) when the run throws', async () => {
    vi.mocked(runTraineeNicks).mockRejectedValueOnce(new Error('discord down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await traineeNicksGET(req('/api/cron/trainee-nicks', 'Bearer cron-secret'))
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

describe('/api/cron/slices-mint', () => {
  it('is scheduled every 5 minutes in vercel.json', async () => {
    const { readFileSync } = await import('node:fs')
    const crons = JSON.parse(readFileSync('vercel.json', 'utf8')).crons as Array<{ path: string; schedule: string }>
    expect(crons.filter((c) => c.path === '/api/cron/slices-mint')).toEqual([{ path: '/api/cron/slices-mint', schedule: '*/5 * * * *' }])
  })

  it('returns the queue result', async () => {
    const res = await slicesMintGET(req('/api/cron/slices-mint', 'Bearer cron-secret'))
    expect(await res.json()).toEqual({ promoted: 0, status: 'skipped', reason: 'disabled' })
  })

  it('500 (logged) when the queue throws', async () => {
    vi.mocked(processMintQueue).mockRejectedValueOnce(new Error('rpc down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await slicesMintGET(req('/api/cron/slices-mint', 'Bearer cron-secret'))
    expect(res.status).toBe(500)
    spy.mockRestore()
  })
})

describe('/api/cron/passport-scrub', () => {
  it('is scheduled daily in vercel.json', async () => {
    const { readFileSync } = await import('node:fs')
    const crons = JSON.parse(readFileSync('vercel.json', 'utf8')).crons as Array<{ path: string; schedule: string }>
    expect(crons.filter((c) => c.path === '/api/cron/passport-scrub')).toEqual([{ path: '/api/cron/passport-scrub', schedule: '45 6 * * *' }])
  })

  it('returns the number of scrubbed rows', async () => {
    const res = await passportScrubGET(req('/api/cron/passport-scrub', 'Bearer cron-secret'))
    expect(await res.json()).toEqual({ scrubbed: 4 })
  })
})
