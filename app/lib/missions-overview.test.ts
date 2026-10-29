// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/missions', () => ({
  getMissionsByLevel: vi.fn(),
  getUserMissionProgress: vi.fn(),
  getCurrentLevel: vi.fn(),
  getLevelTitle: vi.fn(),
  getPaidSummary: vi.fn(),
}))
vi.mock('@/app/lib/mission-cache', () => ({ getCachedMissionsList: () => null, setCachedMissionsList: vi.fn() }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberIdByDiscordId: vi.fn() }))

import { getMissionsByLevel } from '@/app/lib/missions'
import { getMissionsOverview } from './missions-overview'

const row = (id: number, index: number, guideHref: string | null) => ({
  id, level: 4, index, title: `M${id}`, description: null, reward: 10, levelTitle: 'T', verifierKey: null, proofKind: 'NONE', guideHref,
})

beforeEach(() => vi.clearAllMocks())

describe('getMissionsOverview guideHref', () => {
  it('passes a valid guideHref through, in the anonymous (cached) list too', async () => {
    vi.mocked(getMissionsByLevel).mockResolvedValue({ 4: [row(1, 0, '/handbook/levels#vouching'), row(2, 1, null)] } as never)
    const o = await getMissionsOverview(null)
    const [a, b] = o.levels[0].missions
    expect(a.guideHref).toBe('/handbook/levels#vouching')
    expect('guideHref' in b).toBe(false)
  })

  it('drops a stored value that is not a valid internal path (a bad row adds no link)', async () => {
    vi.mocked(getMissionsByLevel).mockResolvedValue({ 4: [row(1, 0, 'javascript:alert(1)'), row(2, 1, 'https://example.org')] } as never)
    const o = await getMissionsOverview(null)
    for (const m of o.levels[0].missions) expect('guideHref' in m).toBe(false)
  })
})
