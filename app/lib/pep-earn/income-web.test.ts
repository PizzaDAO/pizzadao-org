// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  membership: { status: 'member', member: { roles: ['11111'] } } as { status: string; member?: { roles: string[] } },
  cachedMember: { roles: ['11111'] } as { roles: string[] } | null,
  guildRoles: null as Array<{ id: string; name: string }> | null,
  lookup: vi.fn(),
  cached: vi.fn(),
}))

vi.mock('../discord', () => ({
  lookupGuildMembership: (...a: unknown[]) => (h.lookup(...a), Promise.resolve(h.membership)),
  fetchGuildMember: (...a: unknown[]) => (h.cached(...a), Promise.resolve(h.cachedMember)),
}))
vi.mock('../discord-interactions/guild-roles', () => ({ getGuildRoles: async () => h.guildRoles }))
vi.mock('../settings', () => ({ loadSettings: async () => undefined }))

import { loadIncomeContext } from './income-web'

beforeEach(() => {
  h.membership = { status: 'member', member: { roles: ['11111'] } }
  h.cachedMember = { roles: ['11111'] }
  h.guildRoles = null
  h.lookup.mockClear()
  h.cached.mockClear()
  process.env.DISCORD_GUILD_ID = '1'
  process.env.ROLE_INCOME_JSON = JSON.stringify([
    { name: 'Box Mafia', amount: 42 },
    { name: 'Pinned', amount: 5, roleId: '11111', intervalHours: 12 },
  ])
})

describe('loadIncomeContext', () => {
  it('fails closed when the guild role list is unavailable and a role still needs a name lookup', async () => {
    expect(await loadIncomeContext('u')).toEqual({ ok: false })
    expect(await loadIncomeContext('u', { cached: true })).toEqual({ ok: false })
  })

  it('works without the guild role list when every income role has an id', async () => {
    process.env.ROLE_INCOME_JSON = JSON.stringify([{ name: 'Pinned', amount: 5, roleId: '11111' }])
    const ctx = await loadIncomeContext('u')
    expect(ctx).toMatchObject({ ok: true, roleIds: ['11111'] })
  })

  it('includes intervalHours in earnRoles', async () => {
    h.guildRoles = [{ id: 'r-box', name: 'Box Mafia' }]
    const ctx = await loadIncomeContext('u')
    expect(ctx.ok && ctx.earnRoles).toEqual([
      { name: 'Box Mafia', amount: 42, intervalHours: 24 },
      { name: 'Pinned', amount: 5, intervalHours: 12 },
    ])
  })

  it('uses the uncached lookup for payouts and the cached one for status reads', async () => {
    h.guildRoles = [{ id: 'r-box', name: 'Box Mafia' }]
    await loadIncomeContext('u')
    expect(h.lookup).toHaveBeenCalledTimes(1)
    expect(h.cached).not.toHaveBeenCalled()
    await loadIncomeContext('u', { cached: true })
    expect(h.cached).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the member lookup is unknown', async () => {
    h.guildRoles = [{ id: 'r-box', name: 'Box Mafia' }]
    h.membership = { status: 'unknown' }
    expect(await loadIncomeContext('u')).toEqual({ ok: false })
    h.cachedMember = null
    expect(await loadIncomeContext('u', { cached: true })).toEqual({ ok: false })
  })
})
