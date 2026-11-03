import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/app/lib/db', () => ({
  prisma: {
    followUp: { findMany: vi.fn(), updateMany: vi.fn() },
    $executeRaw: vi.fn(),
  },
}))

import { prisma } from '@/app/lib/db'
import { sweepOldReplies } from './store'

const NOW = new Date('2026-11-10T00:00:00Z')

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 2 } as never)
  vi.mocked(prisma.$executeRaw).mockResolvedValue(2 as never)
})

describe('sweepOldReplies', () => {
  it('0 days keeps everything and touches nothing', async () => {
    expect(await sweepOldReplies(0, NOW)).toBe(0)
    expect(prisma.followUp.findMany).not.toHaveBeenCalled()
  })
  it('selects rows older than the cutoff (oldest first, bounded) and blanks their text', async () => {
    vi.mocked(prisma.followUp.findMany).mockResolvedValue([{ id: 'a' }, { id: 'b' }] as never)
    expect(await sweepOldReplies(180, NOW)).toBe(2)
    const q = vi.mocked(prisma.followUp.findMany).mock.calls[0][0] as { where: { lastReplyAt: { lt: Date } }; take: number; orderBy: unknown }
    expect(q.where.lastReplyAt.lt.toISOString()).toBe('2026-05-14T00:00:00.000Z')
    expect(q.take).toBe(100)
    expect(q.orderBy).toEqual({ lastReplyAt: 'asc' })
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] } }, data: { lastReply: null } })
  })
  it('nothing old: no writes', async () => {
    vi.mocked(prisma.followUp.findMany).mockResolvedValue([] as never)
    expect(await sweepOldReplies(180, NOW)).toBe(0)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(prisma.followUp.updateMany).not.toHaveBeenCalled()
  })
})
