// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings: Record<string, unknown> = {}
vi.mock('@/app/lib/settings', () => ({ getSetting: async (k: string) => settings[k] }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: async (k: string) => settings[k] }))

import { decorateManuals, type Manual } from './manuals'

const base = { url: null, crew: 'Ops', crewId: 'ops', authorId: '', author: '', lastUpdated: '', notes: '' }
const list: Manual[] = [
  { ...base, title: 'A', status: 'Complete', reviewedAt: '2024-01-01', supersededBy: null },
  { ...base, title: 'B', status: 'Draft', reviewedAt: null, supersededBy: '/handbook/b' },
]
const now = new Date('2026-11-14T00:00:00Z')

beforeEach(() => {
  Object.assign(settings, { 'manuals.freshnessEnabled': false, 'manuals.staleAfterDays': 365, 'manuals.hideDrafts': false, 'manuals.hideReplaced': false })
})

describe('decorateManuals', () => {
  it('switch off: no marker fields leave the server', async () => {
    const r = await decorateManuals(list, now)
    expect(r.freshness.enabled).toBe(false)
    for (const m of r.manuals) {
      expect(m).not.toHaveProperty('reviewedAt')
      expect(m).not.toHaveProperty('stale')
      expect(m).not.toHaveProperty('hidden')
    }
  })
  it('switch on: marks stale, draft and replaced', async () => {
    settings['manuals.freshnessEnabled'] = true
    const r = await decorateManuals(list, now)
    expect(r.manuals[0]).toMatchObject({ stale: true, neverReviewed: false, draft: false, hidden: false })
    expect(r.manuals[1]).toMatchObject({ stale: false, neverReviewed: true, draft: true, replaced: true, hidden: false })
  })
  it('hide settings mark rows hidden but keep every row (page indexes stay stable)', async () => {
    Object.assign(settings, { 'manuals.freshnessEnabled': true, 'manuals.hideDrafts': true })
    const r = await decorateManuals(list, now)
    expect(r.manuals).toHaveLength(2)
    expect(r.manuals.map((m) => m.hidden)).toEqual([false, true])
  })
})
