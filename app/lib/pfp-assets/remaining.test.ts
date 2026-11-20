// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

const mission = (id: number, extra: Record<string, unknown> = {}) => ({ id, title: `M${id}`, progress: null, ...extra })
vi.mock('@/app/lib/missions-overview', () => ({
  getMissionsOverview: vi.fn(async () => ({
    levels: [
      { level: 3, missions: [mission(30)] },
      { level: 2, missions: [mission(20), mission(21, { bonus: true }), mission(22, { guideHref: '/handbook/a' })] },
      { level: 1, missions: [mission(10), mission(11, { progress: { status: 'APPROVED' } }), mission(12, { progress: { status: 'PENDING' } })] },
      { level: 0, missions: [mission(1)] },
    ],
  })),
}))

import { loadRemainingMissions } from './remaining'

describe('loadRemainingMissions', () => {
  it('lists unfinished required missions between completed and required level, in level order', async () => {
    const r = await loadRemainingMissions('d', 0, 2)
    expect(r.map((m) => m.id)).toEqual([10, 12, 20, 22])
    expect(r[3]).toMatchObject({ href: '/handbook/a', level: 2 })
  })
  it('skips levels already completed', async () => {
    expect((await loadRemainingMissions('d', 1, 2)).map((m) => m.id)).toEqual([20, 22])
  })
})
