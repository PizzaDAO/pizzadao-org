// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({
  prisma: {
    mission: { findMany: vi.fn() },
    shopItem: { findMany: vi.fn() },
  },
}))
vi.mock('@/app/lib/discord-channels', () => ({ getGuildRoles: vi.fn() }))

import { prisma } from '@/app/lib/db'
import { getGuildRoles } from '@/app/lib/discord-channels'
import { validateRules } from './catalog'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  m(getGuildRoles).mockResolvedValue([{ id: '123456789012345678', name: 'Dread Pizza Roberts' }])
  m(prisma.mission.findMany).mockImplementation(async (a: { where: { id: { in: number[] } } }) => a.where.id.in.filter((i) => i === 4).map((id) => ({ id })))
  m(prisma.shopItem.findMany).mockImplementation(async (a: { where: { id: { in: number[] } } }) => a.where.id.in.filter((i) => i === 9).map((id) => ({ id })))
})

describe('validateRules (admin rule validation)', () => {
  it('accepts known roles, missions and items and normalises params', async () => {
    const rules = await validateRules([
      { kind: 'level', params: { minLevel: '4' } },
      { kind: 'role', params: { roleId: '123456789012345678' } },
      { kind: 'mission', params: { missionId: 4 } },
      { kind: 'item', params: { itemId: 9 } },
      { kind: 'everyone' },
    ])
    expect(rules[0]).toEqual({ kind: 'level', params: { minLevel: 4 } })
    expect(rules).toHaveLength(5)
  })

  it('rejects a role that is not in the guild', async () => {
    await expect(validateRules([{ kind: 'role', params: { roleId: '999999999999999999' } }])).rejects.toThrow(/Unknown Discord role/)
  })

  it('rejects role rules when roles cannot be verified (fails closed)', async () => {
    m(getGuildRoles).mockResolvedValue(null)
    await expect(validateRules([{ kind: 'role', params: { roleId: '123456789012345678' } }])).rejects.toThrow(/Could not verify/)
  })

  it('rejects unknown missions and items', async () => {
    await expect(validateRules([{ kind: 'mission', params: { missionId: 5 } }])).rejects.toThrow(/Unknown mission/)
    await expect(validateRules([{ kind: 'item', params: { itemId: 10 } }])).rejects.toThrow(/Unknown item/)
  })

  it('rejects malformed rules and non-lists', async () => {
    await expect(validateRules('x')).rejects.toThrow(/list/)
    await expect(validateRules([{ kind: 'level', params: { minLevel: 0 } }])).rejects.toThrow(/minLevel/)
    await expect(validateRules([{ kind: 'bogus', params: {} }])).rejects.toThrow(/Unknown rule kind/)
    await expect(validateRules(Array.from({ length: 13 }, () => ({ kind: 'everyone' })))).rejects.toThrow(/At most/)
  })
})
