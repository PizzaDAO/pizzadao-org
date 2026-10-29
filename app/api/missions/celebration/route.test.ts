// POST /api/missions/celebration { claimLevelUp: true }: the level-up modal
// for a level reached while away is claimed once, at the server's level.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberIdByDiscordId: vi.fn() }))
vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: vi.fn() }))
vi.mock('@/app/lib/db', () => ({
  prisma: {
    memberProfileExtras: { findUnique: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    appSetting: { findMany: vi.fn() },
  },
}))

import { POST } from './route'
import { getSession } from '@/app/lib/session'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { getCurrentLevel } from '@/app/lib/missions'
import { prisma } from '@/app/lib/db'
import { clearSettingsCache } from '@/app/lib/settings'

const extras = prisma.memberProfileExtras as unknown as Record<string, ReturnType<typeof vi.fn>>
const ROW = {
  memberId: 'm1',
  lastCelebratedLevel: 2,
  firstMissionCelebratedAt: null,
  vouchPromptShownAt: null,
  profileCompletedCelebratedAt: null,
}
const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/missions/celebration', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue({ discordId: 'd1' } as never)
  vi.mocked(fetchMemberIdByDiscordId).mockResolvedValue('m1')
  extras.findUnique.mockResolvedValue(ROW)
})

describe('POST /api/missions/celebration claimLevelUp', () => {
  it('claims the server-computed level with a conditional update', async () => {
    vi.mocked(getCurrentLevel).mockResolvedValue(4)
    extras.updateMany.mockResolvedValue({ count: 1 })
    const json = await (await post({ claimLevelUp: true })).json()
    expect(json).toMatchObject({ levelUpClaimed: true, level: 4 })
    expect(extras.updateMany).toHaveBeenCalledWith({
      where: { memberId: 'm1', lastCelebratedLevel: { lt: 4 } },
      data: { lastCelebratedLevel: 4 },
    })
  })

  it('a second claim (other tab, reload) gets false', async () => {
    vi.mocked(getCurrentLevel).mockResolvedValue(4)
    extras.updateMany.mockResolvedValue({ count: 0 })
    const json = await (await post({ claimLevelUp: true })).json()
    expect(json.levelUpClaimed).toBe(false)
  })

  it('nothing to claim before any level is complete', async () => {
    vi.mocked(getCurrentLevel).mockResolvedValue(1)
    const json = await (await post({ claimLevelUp: true })).json()
    expect(json.levelUpClaimed).toBe(false)
    expect(extras.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a non-boolean claimLevelUp', async () => {
    expect((await post({ claimLevelUp: 7 })).status).toBe(400)
  })
  it('the off value (10) never celebrates, even at the highest level a member can reach (9)', async () => {
    clearSettingsCache({ all: true })
    vi.mocked(prisma.appSetting.findMany).mockResolvedValue([{ key: 'missions.celebrationMinLevel', value: 10 }] as never)
    vi.mocked(getCurrentLevel).mockResolvedValue(9)
    const json = await (await post({ claimLevelUp: true })).json()
    expect(json).toMatchObject({ levelUpClaimed: false, level: 9 })
    expect(extras.updateMany).not.toHaveBeenCalled()
    clearSettingsCache({ all: true })
  })

  it('a lower saved level celebrates earlier', async () => {
    clearSettingsCache({ all: true })
    vi.mocked(prisma.appSetting.findMany).mockResolvedValue([{ key: 'missions.celebrationMinLevel', value: 1 }] as never)
    vi.mocked(getCurrentLevel).mockResolvedValue(1)
    extras.updateMany.mockResolvedValue({ count: 1 })
    expect((await (await post({ claimLevelUp: true })).json()).levelUpClaimed).toBe(true)
    clearSettingsCache({ all: true })
  })
})
