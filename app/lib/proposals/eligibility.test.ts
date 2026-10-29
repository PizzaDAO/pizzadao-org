// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/discord-channels', () => ({ getGuildRoles: vi.fn() }))
vi.mock('@/app/lib/discord', () => ({ hasRole: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(), loadSettings: vi.fn(async () => undefined) }))
vi.mock('@/app/lib/mission-verify/bulk', () => ({ listGuildMemberRoles: vi.fn() }))

import { listRoleHolders, snapshotRoleHolders, type RoleDeps } from './eligibility'

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

describe('listRoleHolders (through the shared guild lister)', () => {
  it('keeps only members with the role', async () => {
    const lister = vi.fn(async () => new Map([['1', ['r']], ['2', ['x']], ['3', ['r', 'x']], ['4', []]]))
    expect(await listRoleHolders('r', lister)).toEqual(['1', '3'])
    expect(lister).toHaveBeenCalledTimes(1)
  })

  it('throws when the lister could not read the whole guild (null), never a partial list', async () => {
    await expect(listRoleHolders('r', vi.fn(async () => null))).rejects.toThrow(/incomplete/)
  })
})
