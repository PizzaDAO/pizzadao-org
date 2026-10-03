// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const tx = {
  economy: { update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  transaction: { create: vi.fn() },
}
const prisma = {
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  economy: { findUnique: vi.fn(), upsert: vi.fn() },
  user: { upsert: vi.fn() },
}
vi.mock('./db', () => ({ prisma }))

const { adminAddMoney, adminGrantError, adminGrantMax, adminRemoveMoney, isPepAdmin, normalizeReason, pepAdminRoleConfig } = await import('./pep-admin')

const ADMIN = '100000000000000001'
const MEMBER = '100000000000000009'

describe('admin grant validation', () => {
  it('reads ADMIN_GRANT_MAX, falling back to 10000', () => {
    expect(adminGrantMax({})).toBe(10_000)
    expect(adminGrantMax({ ADMIN_GRANT_MAX: '500' })).toBe(500)
    for (const bad of ['0', '-1', '1.5', 'lots', '9999999999']) expect(adminGrantMax({ ADMIN_GRANT_MAX: bad })).toBe(10_000)
  })

  it('checks amount, cap and reason length', () => {
    expect(adminGrantError(1, 'abc', 10)).toBeNull()
    expect(adminGrantError(10, 'x'.repeat(200), 10)).toBeNull()
    expect(adminGrantError(11, 'abc', 10)).toMatch(/at most 10/)
    expect(adminGrantError(0, 'abc', 10)).toMatch(/positive/)
    expect(adminGrantError(2.5, 'abc', 10)).toMatch(/whole/)
    expect(adminGrantError('5', 'abc', 10)).toMatch(/whole/)
    expect(adminGrantError(5, 'ab', 10)).toMatch(/3-200/)
    expect(adminGrantError(5, 'x'.repeat(201), 10)).toMatch(/3-200/)
    expect(normalizeReason('  a \n b  ')).toBe('a b')
    expect(normalizeReason(undefined)).toBe('')
  })
})

describe('adminAddMoney / adminRemoveMoney (mocked DB)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tx.economy.findUniqueOrThrow.mockResolvedValue({ wallet: 1314 })
    tx.economy.findUnique.mockResolvedValue({ wallet: 1314 })
  })

  it('credits with an ADMIN_GRANT row carrying the admin and reason', async () => {
    prisma.economy.findUnique.mockResolvedValue({ id: MEMBER, wallet: 1000 })
    expect(await adminAddMoney(ADMIN, MEMBER, 314, ' mission  bonus ')).toEqual({ ok: true, amount: 314, balance: 1314 })
    expect(tx.economy.update).toHaveBeenCalledWith({ where: { id: MEMBER }, data: { wallet: { increment: 314 } } })
    expect(tx.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: MEMBER,
        type: 'ADMIN_GRANT',
        amount: 314,
        metadata: { adminId: ADMIN, reason: 'mission bonus', source: 'discord' },
      }),
    })
  })

  it('creates User + Economy for a member with no wallet, like /pay does', async () => {
    prisma.economy.findUnique.mockResolvedValue(null)
    prisma.economy.upsert.mockResolvedValue({ id: MEMBER, wallet: 0 })
    await adminAddMoney(ADMIN, MEMBER, 5, 'welcome')
    expect(prisma.user.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: MEMBER } }))
    expect(prisma.economy.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: MEMBER } }))
  })

  it('debits conditionally with an ADMIN_REMOVE row, and refuses with the balance when short', async () => {
    prisma.economy.findUnique.mockResolvedValue({ wallet: 1000 })
    tx.economy.updateMany.mockResolvedValue({ count: 1 })
    tx.economy.findUniqueOrThrow.mockResolvedValue({ wallet: 750 })
    tx.economy.findUnique.mockResolvedValue({ wallet: 750 })
    expect(await adminRemoveMoney(ADMIN, MEMBER, 250, 'oops')).toEqual({ ok: true, amount: 250, balance: 750 })
    expect(tx.economy.updateMany).toHaveBeenCalledWith({ where: { id: MEMBER, wallet: { gte: 250 } }, data: { wallet: { decrement: 250 } } })
    expect(tx.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'ADMIN_REMOVE', amount: -250, metadata: { adminId: ADMIN, reason: 'oops', source: 'discord' } }),
    })

    // Lost a race: the pre-check passed but the conditional decrement matched nothing.
    vi.clearAllMocks()
    prisma.economy.findUnique.mockResolvedValueOnce({ wallet: 300 }).mockResolvedValueOnce({ wallet: 50 })
    tx.economy.updateMany.mockResolvedValue({ count: 0 })
    expect(await adminRemoveMoney(ADMIN, MEMBER, 250, 'oops')).toEqual({ ok: false, reason: 'insufficient', balance: 50 })
    expect(tx.transaction.create).not.toHaveBeenCalled()

    // Short up front: nothing is attempted.
    vi.clearAllMocks()
    prisma.economy.findUnique.mockResolvedValue(null)
    expect(await adminRemoveMoney(ADMIN, MEMBER, 1, 'oops')).toEqual({ ok: false, reason: 'insufficient', balance: 0 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('re-validates inputs', async () => {
    await expect(adminAddMoney(ADMIN, MEMBER, 10_001, 'too much')).rejects.toThrow(/at most/)
    await expect(adminRemoveMoney(ADMIN, MEMBER, 5, 'no')).rejects.toThrow(/Reason/)
    await expect(adminAddMoney(ADMIN, 'not-an-id', 5, 'hello')).rejects.toThrow(/Invalid member/)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('isPepAdmin', () => {
  const BASE = ['815976204900499537']
  const MAFIA = '823266914834841610'
  const guild = [
    { id: '700000000000000001', name: '🍕 Pepperoni Mafia' },
    { id: '700000000000000002', name: 'Pizza Capo' },
  ]

  it('reads PEP_ADMIN_ROLE_IDS / PEP_ADMIN_ROLE_NAMES (default Pepperoni Mafia)', () => {
    expect(pepAdminRoleConfig({})).toEqual({ ids: [], names: ['Pepperoni Mafia'] })
    expect(pepAdminRoleConfig({ PEP_ADMIN_ROLE_IDS: '123456, nope ,', PEP_ADMIN_ROLE_NAMES: 'Pizza Capo, Mods' })).toEqual({
      ids: ['123456'],
      names: ['Pizza Capo', 'Mods'],
    })
    expect(pepAdminRoleConfig({ PEP_ADMIN_ROLE_NAMES: '-' }).names).toEqual([])
  })

  it('allows ADMIN_ROLE_IDS and Pepperoni Mafia, rejects everyone else', async () => {
    const getGuildRoles = vi.fn(async () => guild)
    const cfg = pepAdminRoleConfig({})
    expect(await isPepAdmin(BASE, { baseRoleIds: BASE, config: cfg, getGuildRoles })).toBe(true)
    expect(getGuildRoles).not.toHaveBeenCalled() // fixed ids need no lookup
    expect(await isPepAdmin(['700000000000000001'], { baseRoleIds: BASE, config: cfg, getGuildRoles })).toBe(true) // by name
    expect(await isPepAdmin(['700000000000000002'], { baseRoleIds: BASE, config: cfg, getGuildRoles })).toBe(false)
    expect(await isPepAdmin([], { baseRoleIds: BASE, config: cfg, getGuildRoles })).toBe(false)
    // No role list (no token / fetch failed): the pinned Pepperoni Mafia id still works.
    expect(await isPepAdmin([MAFIA], { baseRoleIds: BASE, config: cfg, getGuildRoles: async () => null })).toBe(true)
    expect(await isPepAdmin([MAFIA], { baseRoleIds: BASE, config: cfg, getGuildRoles: async () => { throw new Error('down') } })).toBe(true)
    expect(await isPepAdmin(['1'], { baseRoleIds: BASE, config: cfg, getGuildRoles: async () => null })).toBe(false)
    // Configured ids and names; switching names off.
    expect(await isPepAdmin(['555555'], { baseRoleIds: BASE, config: { ids: ['555555'], names: [] } })).toBe(true)
    expect(await isPepAdmin(['700000000000000002'], { baseRoleIds: BASE, config: { ids: [], names: ['pizza capo'] }, getGuildRoles })).toBe(true)
    expect(await isPepAdmin([MAFIA], { baseRoleIds: BASE, config: { ids: [], names: [] } })).toBe(false)
  })
})
