// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

const mission = (id: number, extra: Record<string, unknown> = {}) => ({ id, title: `M${id}`, progress: null, ...extra })
vi.mock('@/app/lib/missions-overview', () => ({
  getMissionsOverview: vi.fn(async () => ({
    paidLevels: [],
    levels: [
      { level: 3, missions: [mission(30)] },
      { level: 2, missions: [mission(20), mission(21, { bonus: true }), mission(22, { guideHref: '/handbook/a' })] },
      { level: 1, missions: [mission(10), mission(11, { progress: { status: 'APPROVED' } }), mission(12, { progress: { status: 'PENDING' } }), mission(13, { progress: { status: 'REJECTED' } }), mission(14, { progress: { status: 'APPROVED', holdReason: 'x' } })] },
      { level: 0, missions: [mission(1)] },
    ],
  })),
}))

import { getMissionsOverview } from '@/app/lib/missions-overview'
import { loadRemainingMissions } from './remaining'

describe('loadRemainingMissions', () => {
  it('lists unfinished required missions between completed and required level, in level order', async () => {
    const r = await loadRemainingMissions('d', 0, 2)
    expect(r.map((m) => m.id)).toEqual([10, 12, 13, 20, 22])
    expect(r[4]).toMatchObject({ href: '/handbook/a', level: 2 })
  })
  it('flags pending and rejected missions', async () => {
    const r = await loadRemainingMissions('d', 0, 1)
    expect(r.find((m) => m.id === 12)).toMatchObject({ pending: true })
    expect(r.find((m) => m.id === 13)).toMatchObject({ rejected: true })
    expect(r.find((m) => m.id === 10)?.pending).toBeUndefined()
  })
  it('stops at the first level reaching the required one, even across a gap', async () => {
    expect((await loadRemainingMissions('d', 0, 5)).map((m) => m.id)).toEqual([10, 12, 13, 20, 22, 30])
    expect((await loadRemainingMissions('d', 0, 3)).map((m) => m.id)).toEqual([10, 12, 13, 20, 22, 30])
  })
  it('skips paid levels', async () => {
    const base = await getMissionsOverview('d')
    vi.mocked(getMissionsOverview).mockResolvedValueOnce({ ...base, paidLevels: [1] } as never)
    expect((await loadRemainingMissions('d', 0, 2)).map((m) => m.id)).toEqual([20, 22])
  })
  it('skips levels already completed', async () => {
    expect((await loadRemainingMissions('d', 1, 2)).map((m) => m.id)).toEqual([20, 22])
  })
})
