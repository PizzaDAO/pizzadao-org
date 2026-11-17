import { describe, it, expect, vi, beforeEach } from 'vitest'

const findMany = vi.fn()
let failNext = false
vi.mock('./db', () => ({ prisma: { member: { findMany: (...a: unknown[]) => (failNext ? Promise.reject(new Error('down')) : findMany(...a)) } } }))

import { memberNamesByDiscordId } from './member-names'

describe('memberNamesByDiscordId', () => {
  beforeEach(() => { findMany.mockReset(); failNext = false })

  it('maps discord ids to trimmed names', async () => {
    findMany.mockResolvedValue([{ id: 'm1', discordId: '111', name: '  Test Chef ' }])
    const r = await memberNamesByDiscordId(['111'])
    expect(r.get('111')).toEqual({ name: 'Test Chef', memberId: 'm1' })
  })

  it('ignores merged members in the query', async () => {
    findMany.mockResolvedValue([])
    const r = await memberNamesByDiscordId(['111'])
    expect(findMany.mock.calls[0][0].where.mergedInto).toBeNull()
    expect(r.size).toBe(0)
  })

  it('returns an empty map on a DB error', async () => {
    failNext = true
    expect((await memberNamesByDiscordId(['111'])).size).toBe(0)
  })
})
