// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    buddyPair: { findUnique: vi.fn(), updateMany: vi.fn() },
    buddyEvent: { create: vi.fn(), findFirst: vi.fn() },
  },
  toggle: vi.fn(),
  channel: vi.fn(),
  view: vi.fn(),
  hours: { value: 24 },
}))

vi.mock('@/app/lib/db', () => ({ prisma: m.prisma }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: m.toggle }))
vi.mock('@/app/lib/settings/channels', () => ({ savedChannelId: m.channel }))
vi.mock('@/app/lib/settings', () => ({ loadSettings: async () => ({ get: (k: string) => (k === 'buddy.introRecheckHours' ? m.hours.value : 'Hi {trainee}, meet {buddy}') }) }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberByDiscordId: async () => ({ memberId: 'M1', name: 'Mario' }) }))

import { introducePair } from './intro'

const canView = (...a: [string, string]) => m.view(...a)

const pair = { id: 'p1', status: 'MATCHED', threadId: null, introducedAt: null, traineeDiscordId: '111111', buddyDiscordId: '222222' }

beforeEach(() => {
  vi.clearAllMocks()
  m.prisma.buddyPair.findUnique.mockResolvedValue(pair)
  m.prisma.buddyPair.updateMany.mockResolvedValue({ count: 1 })
  m.channel.mockResolvedValue('999999')
  m.view.mockResolvedValue('yes')
  m.hours.value = 24
  m.prisma.buddyEvent.findFirst.mockResolvedValue(null)
})

describe('introducePair', () => {
  it('dry-runs while the toggle is off: records what would be posted and never calls Discord', async () => {
    m.toggle.mockResolvedValue(false)
    const createThread = vi.fn()
    expect(await introducePair('p1', 'adm', { createThread, canView })).toEqual({ mode: 'dry-run', ok: true })
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
    expect(await introducePair('p1', 'adm', { createThread, canView })).toEqual({ mode: 'live', ok: true, threadId: '555555' })
    expect(createThread).toHaveBeenCalledWith({ channelId: '999999', name: 'Buddy: Mario', content: 'Hi <@111111>, meet <@222222>', userIds: ['111111', '222222'] })
    expect(m.prisma.buddyPair.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'p1', introducedAt: null }, data: { introStartedAt: expect.any(Date) } })
    expect(m.prisma.buddyPair.updateMany.mock.calls[1][0]).toMatchObject({ where: { id: 'p1', introducedAt: null }, data: { threadId: '555555', status: 'INTRODUCED', introStartedAt: null } })
    expect(m.prisma.buddyEvent.create.mock.calls[0][0].data.kind).toBe('introduced')
  })

  it('does nothing in Discord without a configured channel, and logs the failure', async () => {
    m.toggle.mockResolvedValue(true)
    m.channel.mockResolvedValue('')
    const createThread = vi.fn()
    expect(await introducePair('p1', 'adm', { createThread, canView })).toEqual({ mode: 'live', ok: false, reason: 'no_channel' })
    expect(createThread).not.toHaveBeenCalled()
    expect(m.prisma.buddyEvent.create.mock.calls[0][0].data).toMatchObject({ kind: 'intro_failed', data: { reason: 'no_channel' } })
  })

  it('leaves the pair MATCHED when Discord fails, so it can be retried', async () => {
    m.toggle.mockResolvedValue(true)
    const createThread = vi.fn().mockResolvedValue({ ok: false, reason: 'thread_create_http_403' })
    expect(await introducePair('p1', 'adm', { createThread, canView })).toEqual({ mode: 'live', ok: false, reason: 'thread_create_http_403' })
    // Only the claim and its release: no INTRODUCED update.
    const datas = m.prisma.buddyPair.updateMany.mock.calls.map((c) => c[0].data)
    expect(datas).toEqual([{ introStartedAt: expect.any(Date) }, { introStartedAt: null }])
  })

  it('a concurrent intro that loses the claim never calls Discord', async () => {
    m.toggle.mockResolvedValue(true)
    m.prisma.buddyPair.updateMany.mockResolvedValue({ count: 0 })
    const createThread = vi.fn()
    expect(await introducePair('p1', 'adm', { createThread, canView })).toEqual({ mode: 'live', ok: false, reason: 'intro_in_progress' })
    expect(createThread).not.toHaveBeenCalled()
  })

  it('keeps the thread id on a partial failure, and Retry reuses that thread', async () => {
    m.toggle.mockResolvedValue(true)
    const createThread = vi.fn().mockResolvedValue({ ok: false, reason: 'add_member_http_404', threadId: '555555' })
    expect(await introducePair('p1', 'adm', { createThread, canView })).toMatchObject({ ok: false, reason: 'add_member_http_404' })
    expect(m.prisma.buddyPair.updateMany.mock.calls.some((c) => c[0].where.threadId === null && c[0].data.threadId === '555555')).toBe(true)
    expect(m.prisma.buddyEvent.create.mock.calls[0][0].data.data).toMatchObject({ threadId: '555555' })

    m.prisma.buddyPair.findUnique.mockResolvedValue({ ...pair, threadId: '555555' })
    const retry = vi.fn().mockResolvedValue({ ok: true, threadId: '555555' })
    expect(await introducePair('p1', 'adm', { createThread: retry, canView })).toEqual({ mode: 'live', ok: true, threadId: '555555' })
    expect(retry.mock.calls[0][0]).toMatchObject({ existingThreadId: '555555' })
  })

  it('refuses a pair that already has a thread or is not active', async () => {
    m.toggle.mockResolvedValue(true)
    m.prisma.buddyPair.findUnique.mockResolvedValue({ ...pair, threadId: '5', introducedAt: new Date() })
    expect(await introducePair('p1', 'adm', { createThread: vi.fn(), canView })).toMatchObject({ ok: false, reason: 'already_introduced' })
    m.prisma.buddyPair.findUnique.mockResolvedValue({ ...pair, status: 'ENDED' })
    expect(await introducePair('p1', 'adm', { createThread: vi.fn(), canView })).toMatchObject({ ok: false, reason: 'pair_not_active' })
  })

  it('both people can see the channel: the thread opens (the check covers trainee and buddy)', async () => {
    m.toggle.mockResolvedValue(true)
    const createThread = vi.fn().mockResolvedValue({ ok: true, threadId: '555555' })
    await introducePair('p1', 'adm', { createThread, canView })
    expect(m.view.mock.calls).toEqual([['999999', '111111'], ['999999', '222222']])
  })

  it('first failed access check: no thread, an intro_deferred event names who, the pair stays MATCHED', async () => {
    m.toggle.mockResolvedValue(true)
    m.view.mockImplementation(async (_c: string, id: string) => (id === '111111' ? 'no' : 'yes'))
    const createThread = vi.fn()
    expect(await introducePair('p1', 'adm', { createThread, canView })).toEqual({ mode: 'live', ok: false, reason: 'waiting_for_access', waiting: true })
    expect(createThread).not.toHaveBeenCalled()
    expect(m.prisma.buddyEvent.create.mock.calls[0][0].data).toMatchObject({ kind: 'intro_deferred', data: { reason: 'cannot_view', who: ['trainee'] } })
    expect(m.prisma.buddyPair.updateMany).not.toHaveBeenCalled()
  })

  it('a retry inside the wait does nothing new', async () => {
    m.toggle.mockResolvedValue(true)
    m.view.mockResolvedValue('no')
    m.prisma.buddyEvent.findFirst.mockResolvedValue({ at: new Date(Date.now() - 3600 * 1000) })
    expect(await introducePair('p1', 'system', { createThread: vi.fn(), canView })).toMatchObject({ ok: false, waiting: true })
    expect(m.prisma.buddyEvent.create).not.toHaveBeenCalled()
    expect(m.prisma.buddyPair.updateMany).not.toHaveBeenCalled()
  })

  it('second failed check after the wait cancels the pair: ENDED no_channel_access, event, no Discord post', async () => {
    m.toggle.mockResolvedValue(true)
    m.view.mockImplementation(async (_c: string, id: string) => (id === '222222' ? 'no' : 'yes'))
    m.prisma.buddyEvent.findFirst.mockResolvedValue({ at: new Date(Date.now() - 25 * 3600 * 1000) })
    const createThread = vi.fn()
    expect(await introducePair('p1', 'system', { createThread, canView })).toEqual({ mode: 'live', ok: false, reason: 'no_channel_access', cancelled: true })
    expect(createThread).not.toHaveBeenCalled()
    expect(m.prisma.buddyPair.updateMany.mock.calls[0][0].data).toEqual({ status: 'ENDED', endedReason: 'no_channel_access' })
    expect(m.prisma.buddyEvent.create.mock.calls[0][0].data).toMatchObject({ kind: 'ended', data: { reason: 'no_channel_access', who: ['buddy'] } })
  })

  it('the wait is the buddy.introRecheckHours setting', async () => {
    m.toggle.mockResolvedValue(true)
    m.view.mockResolvedValue('no')
    m.hours.value = 2
    m.prisma.buddyEvent.findFirst.mockResolvedValue({ at: new Date(Date.now() - 3 * 3600 * 1000) })
    expect(await introducePair('p1', 'system', { createThread: vi.fn(), canView })).toMatchObject({ cancelled: true })
  })

  it('second check passes: the intro opens', async () => {
    m.toggle.mockResolvedValue(true)
    m.prisma.buddyEvent.findFirst.mockResolvedValue({ at: new Date(Date.now() - 25 * 3600 * 1000) })
    const createThread = vi.fn().mockResolvedValue({ ok: true, threadId: '555555' })
    expect(await introducePair('p1', 'system', { createThread, canView })).toEqual({ mode: 'live', ok: true, threadId: '555555' })
    expect(m.prisma.buddyEvent.create.mock.calls.map((c) => c[0].data.kind)).toEqual(['introduced'])
  })

  it('Discord being unreachable is neither a deferral nor a cancel', async () => {
    m.toggle.mockResolvedValue(true)
    m.view.mockResolvedValue('unknown')
    m.prisma.buddyEvent.findFirst.mockResolvedValue({ at: new Date(Date.now() - 99 * 3600 * 1000) })
    expect(await introducePair('p1', 'system', { createThread: vi.fn(), canView })).toEqual({ mode: 'live', ok: false, reason: 'access_unknown' })
    expect(m.prisma.buddyEvent.create).not.toHaveBeenCalled()
  })

  it('an ambiguous final post keeps the claim, records intro_uncertain and keeps the thread id', async () => {
    m.toggle.mockResolvedValue(true)
    const createThread = vi.fn().mockResolvedValue({ ok: false, reason: 'timeout', threadId: '555555', uncertain: true })
    expect(await introducePair('p1', 'adm', { createThread, canView })).toEqual({ mode: 'live', ok: false, reason: 'timeout', uncertain: true })
    const datas = m.prisma.buddyPair.updateMany.mock.calls.map((c) => c[0].data)
    expect(datas).not.toContainEqual({ introStartedAt: null })
    expect(datas).toContainEqual({ threadId: '555555' })
    expect(m.prisma.buddyEvent.create.mock.calls[0][0].data).toMatchObject({ kind: 'intro_uncertain', data: { threadId: '555555' } })
  })

  it('releases the claim only with the value it set', async () => {
    m.toggle.mockResolvedValue(true)
    const createThread = vi.fn().mockResolvedValue({ ok: false, reason: 'thread_create_http_403' })
    await introducePair('p1', 'adm', { createThread, canView })
    const release = m.prisma.buddyPair.updateMany.mock.calls[1][0]
    expect(release.where.introStartedAt).toBeInstanceOf(Date)
  })
})
