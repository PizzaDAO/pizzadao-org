// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  on: false,
  count: vi.fn(async (_a: unknown) => 1),
  findMany: vi.fn(async (_a: unknown) => [{ walletAddress: '0xabc' }]),
}))

vi.mock('../db', () => ({ prisma: { memberWallet: { count: (a: unknown) => h.count(a), findMany: (a: unknown) => h.findMany(a) } } }))
vi.mock('../settings/toggles', () => ({ toggleEnabled: async () => h.on }))
vi.mock('../discord', () => ({ lookupGuildMembership: vi.fn() }))
vi.mock('../discord-channels', () => ({ getChannel: vi.fn(), getChannelMessage: vi.fn(), resolveChannelId: vi.fn() }))
vi.mock('../discord-interactions/guild-roles', () => ({ getGuildRoles: vi.fn() }))
vi.mock('../missions', () => ({ getCurrentLevel: vi.fn(), getPaidLevels: vi.fn() }))
vi.mock('../rare-pizza-box', () => ({ checkRarePizzaBox: vi.fn() }))

import { defaultSources } from './sources'

beforeEach(() => vi.clearAllMocks())

describe('wallet mission sources and wallets.requireSignature', () => {
  it('off: counts every chain (unchanged)', async () => {
    h.on = false
    await defaultSources.countWallets('d1', 'm1')
    await defaultSources.getWalletAddresses('d1', 'm1')
    expect(h.count.mock.calls[0][0]).toEqual({ where: { OR: [{ memberId: 'm1' }, { discordId: 'd1' }] } })
    expect((h.findMany.mock.calls[0][0] as { where: object }).where).toEqual({ OR: [{ memberId: 'm1' }, { discordId: 'd1' }] })
  })

  it('on: only EVM wallets count', async () => {
    h.on = true
    await defaultSources.countWallets('d1', 'm1')
    await defaultSources.getWalletAddresses('d1', null)
    expect(h.count.mock.calls[0][0]).toEqual({ where: { OR: [{ memberId: 'm1' }, { discordId: 'd1' }], chainType: 'evm' } })
    expect((h.findMany.mock.calls[0][0] as { where: object }).where).toEqual({ discordId: 'd1', chainType: 'evm' })
  })
})
