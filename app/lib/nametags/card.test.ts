import { beforeEach, describe, expect, it, vi } from 'vitest'

const members: Record<string, Record<string, unknown>> = {}
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberById: async (id: string) => members[id] ?? null }))
const progress = vi.fn()
vi.mock('@/app/lib/missions', () => ({ getUserProgressSummary: (...a: unknown[]) => progress(...a) }))
vi.mock('@/app/lib/crew-mappings', () => ({
  getCrewMappings: async () => ({
    crews: [
      { id: 'design', label: 'Design', emoji: 'D' },
      { id: 'dev', label: 'Dev' },
      { id: 'ops', label: 'Ops' },
    ],
    cached: true,
  }),
}))
const disavowOn = vi.fn()
const disavowed = vi.fn()
vi.mock('@/app/lib/disavow/constants', () => ({ disavowEnabled: () => disavowOn() }))
vi.mock('@/app/lib/disavow/access', () => ({ isDisavowSubject: (...a: unknown[]) => disavowed(...a) }))
vi.mock('@/app/lib/settings', () => ({ getSetting: async () => 1 }))
const pfps = vi.fn()
vi.mock('@/app/lib/pfp', () => ({ resolvePfpUrlsAsync: (...a: unknown[]) => pfps(...a) }))

import { composeNametagCards, NAMETAG_MEMBER_KEYS, __resetNametagCardCache, type NametagFields } from './card'
import { absoluteUrl } from './pfp'

const all: NametagFields = { city: true, crews: true, level: true, maxCrews: 2 }

beforeEach(() => {
  __resetNametagCardCache()
  for (const k of Object.keys(members)) delete members[k]
  members['1'] = {
    Name: 'Pat Pie',
    City: 'Austin',
    Crews: 'Design, Dev, Ops',
    discordId: 'd1',
    // fields that must never leak
    Email: 'secret@example.com',
    Wallet: '0xabc',
    Telegram: '@secret',
  }
  progress.mockReset().mockResolvedValue({ completed: 3, completedTitle: 'Sous Chef', currentLevel: 4 })
  pfps.mockReset().mockResolvedValue({ '1': 'https://img.example/p.png', '2': '/pfp/default.png' })
  disavowOn.mockReset().mockResolvedValue(false)
  disavowed.mockReset().mockResolvedValue(false)
})

describe('composeNametagCards', () => {
  it('returns exactly the allow-listed keys and no contact data', async () => {
    const card = (await composeNametagCards(['1'], all)).get('1')!
    expect(Object.keys(card).sort()).toEqual([...NAMETAG_MEMBER_KEYS].sort())
    expect(card).toMatchObject({ memberId: '1', name: 'Pat Pie', city: 'Austin', levelCompleted: 3, levelTitle: 'Sous Chef', pfpUrl: 'https://img.example/p.png' })
    expect(JSON.stringify(card)).not.toMatch(/secret|0xabc|d1/)
  })
  it('caps crews at the setting', async () => {
    const card = (await composeNametagCards(['1'], { ...all, maxCrews: 1 })).get('1')!
    expect(card.crews).toEqual([{ id: 'design', label: 'Design', emoji: 'D' }])
  })
  it('field toggles drop city, crews and level', async () => {
    const card = (await composeNametagCards(['1'], { city: false, crews: false, level: false, maxCrews: 2 })).get('1')!
    expect(Object.keys(card).sort()).toEqual(['memberId', 'name', 'pfpUrl'])
  })
  it('falls back to the absolute dough ball when the picture is relative', async () => {
    members['2'] = { Name: 'No Pic' }
    const card = (await composeNametagCards(['2'], all)).get('2')!
    expect(card.pfpUrl).toMatch(/^https?:\/\/.+\/pfp\/default\.png$/)
    expect(absoluteUrl('/a.png', 'https://x.test/')).toBe('https://x.test/a.png')
  })
  it('skips unknown and disavowed members', async () => {
    disavowOn.mockResolvedValue(true)
    disavowed.mockResolvedValue(true)
    const out = await composeNametagCards(['1', '404'], all)
    expect(out.size).toBe(0)
  })
  it('fails closed (skips) when the disavow check errors', async () => {
    disavowOn.mockResolvedValue(true)
    disavowed.mockRejectedValue(new Error('db'))
    expect((await composeNametagCards(['1'], all)).size).toBe(0)
  })
  it('a failing progress lookup only drops the level', async () => {
    progress.mockRejectedValue(new Error('x'))
    const card = (await composeNametagCards(['1'], all)).get('1')!
    expect(card.levelCompleted).toBeUndefined()
    expect(card.name).toBe('Pat Pie')
  })
})
