// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ after: vi.fn(), upsert: vi.fn() }))
vi.mock('next/server', () => ({ after: m.after }))
vi.mock('./db', () => ({ prisma: { discordGuildSnapshot: { upsert: m.upsert, findUnique: vi.fn() } } }))

import { writeGuildSnapshotLater } from './discord-guild-snapshot'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.DATABASE_URL = 'postgres://test'
  m.upsert.mockResolvedValue({ guildId: '1' })
})

describe('writeGuildSnapshotLater', () => {
  it('hands the write to after() synchronously and does not block', async () => {
    const r = writeGuildSnapshotLater('1', 'channels', [{ id: 'a' }])
    expect(r).toBeUndefined()
    expect(m.after).toHaveBeenCalledTimes(1)
    expect(m.upsert).not.toHaveBeenCalled()
    await m.after.mock.calls[0][0]()
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ select: { guildId: true }, where: { guildId_kind: { guildId: '1', kind: 'channels' } } }))
  })

  it('returns an awaitable write when after() is unavailable (outside a request / in a cached function)', async () => {
    m.after.mockImplementation(() => {
      throw new Error('after was called outside a request scope')
    })
    const r = writeGuildSnapshotLater('1', 'roles', [{ id: 'r' }])
    expect(r).toBeInstanceOf(Promise)
    await r
    expect(m.upsert).toHaveBeenCalledTimes(1)
  })
})
