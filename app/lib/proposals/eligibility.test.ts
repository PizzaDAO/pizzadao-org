// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/discord-channels', () => ({ getGuildRoles: vi.fn() }))
vi.mock('@/app/lib/discord', () => ({ hasRole: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn() }))

import { listRoleHoldersStrict, snapshotRoleHolders, type RoleDeps } from './eligibility'

const deps = (o: Partial<RoleDeps> = {}): RoleDeps => ({
  voterRoleId: async () => '700000000000000001',
  listRoleHolders: async () => ['333', '111', '222', '111'],
  ...o,
})

describe('voter role snapshot', () => {
  it('lists the role holders once each, sorted, with the role used', async () => {
    expect(await snapshotRoleHolders(deps())).toEqual({ roleId: '700000000000000001', discordIds: ['111', '222', '333'] })
  })

  it('fails closed when the role cannot be resolved or the listing fails', async () => {
    await expect(snapshotRoleHolders(deps({ voterRoleId: async () => null }))).rejects.toThrow()
    await expect(snapshotRoleHolders(deps({ listRoleHolders: async () => { throw new Error('discord 500') } }))).rejects.toThrow()
  })
})

describe('listRoleHoldersStrict', () => {
  const env = { DISCORD_GUILD_ID: 'g1', DISCORD_BOT_TOKEN: 'tok' } as unknown as NodeJS.ProcessEnv
  const member = (id: string, roles: string[]) => ({ user: { id }, roles })
  const page = (members: unknown[], ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => members }) as Response

  it('keeps only members with the role and follows pages', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => member(String(1000 + i), i === 5 ? ['r'] : []))
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(page(first))
      .mockResolvedValueOnce(page([member('9999', ['r']), member('9998', ['x'])]))
    expect(await listRoleHoldersStrict('r', env, fetchImpl as unknown as typeof fetch)).toEqual(['1005', '9999'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('throws on a Discord error mid-listing instead of returning a partial list', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => member(String(1000 + i), ['r']))
    const fetchImpl = vi.fn().mockResolvedValueOnce(page(first)).mockResolvedValueOnce(page([], false))
    await expect(listRoleHoldersStrict('r', env, fetchImpl as unknown as typeof fetch)).rejects.toThrow()
    await expect(listRoleHoldersStrict('r', {} as unknown as NodeJS.ProcessEnv)).rejects.toThrow()
  })
})
