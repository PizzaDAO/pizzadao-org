// @vitest-environment node
// Go-live is one-way: once proposals.liveSince is set it can only move earlier, never be cleared, and a pilot cannot restart.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  live: null as unknown,
  upsert: vi.fn(),
}))
vi.mock('@/app/lib/db', () => ({
  prisma: {
    appSetting: {
      findUnique: async ({ where }: { where: { key: string } }) => (where.key === 'proposals.liveSince' && m.live !== null ? { key: where.key, value: m.live, updatedAt: new Date() } : null),
      findMany: async () => [],
      upsert: m.upsert,
      delete: async () => ({}),
    },
    appSettingChange: { create: async () => ({}) },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        appSetting: { findUnique: async () => null, upsert: m.upsert, delete: async () => ({}) },
        appSettingChange: { create: async () => ({}) },
      }),
  },
}))

import { resetSetting, saveSetting, SettingError } from './store'

const status = async (p: Promise<unknown>) => {
  try {
    await p
    return 200
  } catch (e) {
    return e instanceof SettingError ? e.status : 500
  }
}

beforeEach(() => {
  m.live = null
  m.upsert.mockReset()
  m.upsert.mockResolvedValue({ updatedAt: new Date() })
})

describe('go-live is one-way', () => {
  it('before go-live a pilot list can be saved and the moment set', async () => {
    expect(await status(saveSetting('proposals.pilotDiscordIds', ['100000000000000001'], 'a'))).toBe(200)
    expect(await status(saveSetting('proposals.liveSince', '2026-01-10T18:00:00Z', 'a'))).toBe(200)
  })

  it('after go-live a non-empty pilot list is refused (an empty one is fine)', async () => {
    m.live = '2026-01-10T18:00:00Z'
    expect(await status(saveSetting('proposals.pilotDiscordIds', ['100000000000000001'], 'a'))).toBe(400)
    expect(await status(saveSetting('proposals.pilotDiscordIds', [], 'a'))).toBe(200)
  })

  it('after go-live the moment can only move earlier: not later, not cleared, not reset', async () => {
    m.live = '2026-01-10T18:00:00Z'
    expect(await status(saveSetting('proposals.liveSince', '2026-01-11T00:00:00Z', 'a'))).toBe(400)
    expect(await status(saveSetting('proposals.liveSince', '', 'a'))).toBe(400)
    expect(await status(resetSetting('proposals.liveSince', 'a'))).toBe(400)
    expect(await status(saveSetting('proposals.liveSince', '2026-01-09T00:00:00Z', 'a'))).toBe(200)
  })

  it('a go-live moment in the future is refused, even the first time', async () => {
    expect(await status(saveSetting('proposals.liveSince', new Date(Date.now() + 3600_000).toISOString(), 'a'))).toBe(400)
    expect(await status(saveSetting('proposals.liveSince', new Date(Date.now() + 60_000).toISOString(), 'a'))).toBe(200)
  })

  it('an empty saved value counts as unset', async () => {
    m.live = ''
    expect(await status(saveSetting('proposals.pilotDiscordIds', ['100000000000000001'], 'a'))).toBe(200)
  })
})
