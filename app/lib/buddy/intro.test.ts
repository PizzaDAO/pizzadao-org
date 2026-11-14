// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    buddyPair: { findUnique: vi.fn(), updateMany: vi.fn() },
    buddyEvent: { create: vi.fn() },
  },
  toggle: vi.fn(),
  channel: vi.fn(),
}))

vi.mock('@/app/lib/db', () => ({ prisma: m.prisma }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: m.toggle }))
vi.mock('@/app/lib/settings/channels', () => ({ savedChannelId: m.channel }))
vi.mock('@/app/lib/settings', () => ({ loadSettings: async () => ({ get: () => 'Hi {trainee}, meet {buddy}' }) }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberByDiscordId: async () => ({ memberId: 'M1', name: 'Mario' }) }))

import { introducePair } from './intro'

const pair = { id: 'p1', status: 'MATCHED', threadId: null, introducedAt: null, traineeDiscordId: '111111', buddyDiscordId: '222222' }

beforeEach(() => {
  vi.clearAllMocks()
  m.prisma.buddyPair.findUnique.mockResolvedValue(pair)
  m.prisma.buddyPair.updateMany.mockResolvedValue({ count: 1 })
  m.channel.mockResolvedValue('999999')
})

describe('introducePair', () => {
  it('dry-runs while the toggle is off: records what would be posted and never calls Discord', async () => {
    m.toggle.mockResolvedValue(false)
    const createThread = vi.fn()
    expect(await introducePair('p1', 'adm', { createThread })).toEqual({ mode: 'dry-run', ok: true })
    expect(createThread).not.toHaveBeenCalled()
    expect(m.prisma.buddyPair.updateMany).not.toHaveBeenCalled()
    expect(m.prisma.buddyEvent.create.mock.calls[0][0].data).toMatchObject({
      kind: 'intro_dry_run',
      data: { channelId: '999999', name: 'Buddy: Mario', content: 'Hi <@111111>, meet <@222222>' },
    })
  })

  it('opens the thread when the toggle is on and marks the pair INTRODUCED', async () => {
    m.toggle.mockResolvedValue(true)
    const createThread = vi.fn().mockResolvedValue({ ok: true, threadId: '555555' })
    expect(await introducePair('p1', 'adm', { createThread })).toEqual({ mode: 'live', ok: true, threadId: '555555' })
    expect(createThread).toHaveBeenCalledWith({ channelId: '999999', name: 'Buddy: Mario', content: 'Hi <@111111>, meet <@222222>', userIds: ['111111', '222222'] })
    expect(m.prisma.buddyPair.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'p1', introducedAt: null }, data: { introStartedAt: expect.any(Date) } })
    expect(m.prisma.buddyPair.updateMany.mock.calls[1][0]).toMatchObject({ where: { id: 'p1', introducedAt: null }, data: { threadId: '555555', status: 'INTRODUCED', introStartedAt: null } })
    expect(m.prisma.buddyEvent.create.mock.calls[0][0].data.kind).toBe('introduced')
  })

  it('does nothing in Discord without a configured channel, and logs the failure', async () => {
    m.toggle.mockResolvedValue(true)
    m.channel.mockResolvedValue('')
    const createThread = vi.fn()
    expect(await introducePair('p1', 'adm', { createThread })).toEqual({ mode: 'live', ok: false, reason: 'no_channel' })
    expect(createThread).not.toHaveBeenCalled()
    expect(m.prisma.buddyEvent.create.mock.calls[0][0].data).toMatchObject({ kind: 'intro_failed', data: { reason: 'no_channel' } })
  })

  it('leaves the pair MATCHED when Discord fails, so it can be retried', async () => {
    m.toggle.mockResolvedValue(true)
    const createThread = vi.fn().mockResolvedValue({ ok: false, reason: 'thread_create_http_403' })
    expect(await introducePair('p1', 'adm', { createThread })).toEqual({ mode: 'live', ok: false, reason: 'thread_create_http_403' })
    // Only the claim and its release: no INTRODUCED update.
    const datas = m.prisma.buddyPair.updateMany.mock.calls.map((c) => c[0].data)
    expect(datas).toEqual([{ introStartedAt: expect.any(Date) }, { introStartedAt: null }])
  })

  it('a concurrent intro that loses the claim never calls Discord', async () => {
    m.toggle.mockResolvedValue(true)
    m.prisma.buddyPair.updateMany.mockResolvedValue({ count: 0 })
    const createThread = vi.fn()
    expect(await introducePair('p1', 'adm', { createThread })).toEqual({ mode: 'live', ok: false, reason: 'intro_in_progress' })
    expect(createThread).not.toHaveBeenCalled()
  })

  it('keeps the thread id on a partial failure, and Retry reuses that thread', async () => {
    m.toggle.mockResolvedValue(true)
    const createThread = vi.fn().mockResolvedValue({ ok: false, reason: 'add_member_http_404', threadId: '555555' })
    expect(await introducePair('p1', 'adm', { createThread })).toMatchObject({ ok: false, reason: 'add_member_http_404' })
    expect(m.prisma.buddyPair.updateMany.mock.calls.some((c) => c[0].where.threadId === null && c[0].data.threadId === '555555')).toBe(true)
    expect(m.prisma.buddyEvent.create.mock.calls[0][0].data.data).toMatchObject({ threadId: '555555' })

    m.prisma.buddyPair.findUnique.mockResolvedValue({ ...pair, threadId: '555555' })
    const retry = vi.fn().mockResolvedValue({ ok: true, threadId: '555555' })
    expect(await introducePair('p1', 'adm', { createThread: retry })).toEqual({ mode: 'live', ok: true, threadId: '555555' })
    expect(retry.mock.calls[0][0]).toMatchObject({ existingThreadId: '555555' })
  })

  it('refuses a pair that already has a thread or is not active', async () => {
    m.toggle.mockResolvedValue(true)
    m.prisma.buddyPair.findUnique.mockResolvedValue({ ...pair, threadId: '5', introducedAt: new Date() })
    expect(await introducePair('p1', 'adm', { createThread: vi.fn() })).toMatchObject({ ok: false, reason: 'already_introduced' })
    m.prisma.buddyPair.findUnique.mockResolvedValue({ ...pair, status: 'ENDED' })
    expect(await introducePair('p1', 'adm', { createThread: vi.fn() })).toMatchObject({ ok: false, reason: 'pair_not_active' })
  })
})
