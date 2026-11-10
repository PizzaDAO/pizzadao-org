// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { computeCurrentLevel, currentLevelsFor, missionStatsFor } from './missions'

const missions = [
  { id: 1, level: 1 },
  { id: 2, level: 1 },
  { id: 3, level: 2 },
]

beforeEach(() => {
  vi.mocked(prisma.mission.findMany).mockReset().mockResolvedValue(missions as never)
  vi.mocked(prisma.missionCompletion.findMany).mockReset().mockResolvedValue([
    { discordId: 'a', missionId: 1 },
    { discordId: 'a', missionId: 2 },
    { discordId: 'b', missionId: 1 },
  ] as never)
  vi.mocked(prisma.transaction.findMany).mockReset().mockResolvedValue([{ userId: 'c', metadata: { level: 1 }, description: null }] as never)
})

describe('missionStatsFor / currentLevelsFor', () => {
  it('agrees with computeCurrentLevel and counts distinct approved missions', async () => {
    const stats = await missionStatsFor(['a', 'b', 'c', 'd'])
    expect(stats.get('a')).toEqual({ level: computeCurrentLevel(missions, new Set([1, 2])), approvedMissions: 2 })
    expect(stats.get('a')!.level).toBe(2)
    expect(stats.get('b')).toEqual({ level: 1, approvedMissions: 1 })
    // A paid ledger row counts as the level done.
    expect(stats.get('c')).toEqual({ level: 2, approvedMissions: 0 })
    expect(stats.get('d')).toEqual({ level: 1, approvedMissions: 0 })
  })

  it('currentLevelsFor returns just the levels; no ids means no queries', async () => {
    expect((await currentLevelsFor(['a'])).get('a')).toBe(2)
    vi.mocked(prisma.mission.findMany).mockClear()
    expect((await missionStatsFor([])).size).toBe(0)
    expect(prisma.mission.findMany).not.toHaveBeenCalled()
  })

  it('fails closed with no active missions', async () => {
    vi.mocked(prisma.mission.findMany).mockResolvedValue([] as never)
    await expect(missionStatsFor(['a'])).rejects.toThrow(/no active missions/)
  })
})
