import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/app/lib/db', () => ({
  prisma: {
    followUp: { updateMany: vi.fn() },
    $executeRaw: vi.fn(),
  },
}))

import { prisma } from '@/app/lib/db'
import { sweepOldReplies } from './store'

const NOW = new Date('2026-11-10T00:00:00Z')

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.$executeRaw).mockResolvedValue(0 as never)
})

describe('sweepOldReplies', () => {
  it('0 days keeps everything and touches nothing', async () => {
    expect(await sweepOldReplies(0, NOW)).toBe(0)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(prisma.followUp.updateMany).not.toHaveBeenCalled()
  })
  it('erases event text by each event\'s own age, bounded, and keeps the row\'s other data', async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValue(3 as never)
    vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 1 } as never)
    expect(await sweepOldReplies(180, NOW)).toBe(4)
    const call = vi.mocked(prisma.$executeRaw).mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]]
    const sql = call[0].join('?')
    expect(sql).toContain(`"createdAt" <`)
    expect(sql).toContain('LIMIT')
    expect(sql).not.toMatch(/followUpId/) // selected per event, not per row
    expect((call[1] as Date).toISOString()).toBe('2026-05-14T00:00:00.000Z')
    expect(call[2]).toBe(500)
  })
  it('a busy row: lastReply is blanked only by lastReplyAt, independent of its old events', async () => {
    await sweepOldReplies(180, NOW)
    const arg = vi.mocked(prisma.followUp.updateMany).mock.calls[0][0] as { where: { lastReply: unknown; lastReplyAt: { lt: Date } }; data: unknown }
    expect(arg.where.lastReplyAt.lt.toISOString()).toBe('2026-05-14T00:00:00.000Z')
    expect(arg.where.lastReply).toEqual({ not: null })
    expect(arg.data).toEqual({ lastReply: null })
  })
})
