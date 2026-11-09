// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
const access = vi.fn()
vi.mock('./live-access', () => ({ liveAccess: (...a: unknown[]) => access(...a) }))

import { prisma } from '@/app/lib/db'
import type { Settings } from '@/app/lib/settings'
import { SETTINGS, type SettingKey } from '@/app/lib/settings/registry'
import { EMPTY_POST_FILTER } from './post-filters'
import { memberLiveView, publicLiveView } from './live-view'

function fakeSettings(over: Partial<Record<SettingKey, unknown>> = {}): Settings {
  return { readFailed: false, invalidKeys: [], isSet: (k) => k in over, get: ((k: SettingKey) => (k in over ? over[k] : SETTINGS[k].default)) as Settings['get'] }
}
const ON = fakeSettings({ 'calls.liveViewEnabled': true, 'calls.liveStreamLinks': 'ops = https://x.com/i/broadcasts/fallback' })
const NOW = 1_700_000_100_000

const session = {
  sessionId: 'evt-1',
  eventName: 'Ops call',
  crewId: 'ops',
  crewLabel: 'Ops',
  streamLink: null,
  startedAt: new Date(NOW - 600_000),
  presence: [
    { discordId: '111111111111111', displayName: 'Ann', presentSec: 600, inChannel: true },
    { discordId: '222222222222222', displayName: 'Bob', presentSec: 120, inChannel: true },
    { discordId: '333333333333333', displayName: 'Cy', presentSec: 60, inChannel: false },
    { discordId: '444444444444444', displayName: 'Speaker 3', presentSec: 60, inChannel: true },
  ],
}
const item = (id: string, over: Record<string, unknown> = {}) => ({ id, sessionId: 'evt-1', text: `item ${id}`, owner: null, source: 'speech', speakerIds: ['111111111111111'], createdAt: new Date(NOW - 1000), ...over })

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.clearAllMocks()
  vi.mocked(prisma.callLiveSession.findMany).mockResolvedValue([session] as never)
  vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.attendanceSummary.findMany).mockResolvedValue([{ discordId: '111111111111111', memberId: 'm-ann' }] as never)
  vi.mocked(prisma.callLiveQuestion.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.callLivePoll.findMany).mockResolvedValue([] as never)
  access.mockResolvedValue({ actionItems: { visible: true, minLevel: 4 }, host: false })
})

describe('public endpoint payload', () => {
  it('has title, crew, start, stream link and head count only: no names or ids', async () => {
    const out = await publicLiveView(ON, NOW)
    expect(out.live).toEqual({ title: 'Ops call', crewLabel: 'Ops', startedAt: session.startedAt.toISOString(), streamLink: 'https://x.com/i/broadcasts/fallback', presentCount: 3 })
    const json = JSON.stringify(out)
    for (const leak of ['Ann', 'Bob', 'Cy', '111111111111111', 'presence', 'sessionId', 'm-ann']) expect(json).not.toContain(leak)
  })
  it('is empty when nothing is live or the live view is off', async () => {
    vi.mocked(prisma.callLiveSession.findMany).mockResolvedValue([] as never)
    expect((await publicLiveView(ON, NOW)).live).toBeNull()
    vi.mocked(prisma.callLiveSession.findMany).mockResolvedValue([session] as never)
    expect((await publicLiveView(fakeSettings({}), NOW)).live).toBeNull()
  })
  it('prefers the link found in the call chat over the crew setting', async () => {
    vi.mocked(prisma.callLiveSession.findMany).mockResolvedValue([{ ...session, streamLink: 'https://x.com/i/broadcasts/chat' }] as never)
    expect((await publicLiveView(ON, NOW)).live?.streamLink).toBe('https://x.com/i/broadcasts/chat')
  })
})

describe('member endpoint payload', () => {
  it('lists people in the channel with minutes and a profile link only for known members', async () => {
    const out = await memberLiveView(ON, { discordId: 'me' }, null, { now: NOW, postFilter: async () => EMPTY_POST_FILTER })
    expect(out.live?.present.map((p) => p.name)).toEqual(['Ann', 'Bob', 'Speaker 3'])
    expect(out.live?.present[0]).toEqual({ name: 'Ann', memberId: 'm-ann', minutes: 10 })
    expect(out.live?.present[1].memberId).toBeNull()
    expect(out.live?.present.some((p) => p.name === 'Cy')).toBe(false) // left the call
    expect(out.live?.presentCount).toBe(3)
  })

  it('returns who suggested each item (first speaker), never a generic "Speaker N", with a link when known', async () => {
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([item('a'), item('b', { speakerIds: ['444444444444444'] }), item('c', { speakerIds: [] })] as never)
    const out = await memberLiveView(ON, { discordId: 'me' }, null, { now: NOW, postFilter: async () => EMPTY_POST_FILTER })
    expect(out.items.map((i) => i.suggestedBy)).toEqual([{ name: 'Ann', memberId: 'm-ann' }, null, null])
  })

  it('sends only items newer than the cursor and moves the cursor forward', async () => {
    const t1 = NOW - 5000
    const t2 = NOW - 1000
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([item('x', { createdAt: new Date(t1) }), item('y', { createdAt: new Date(t2) })] as never)
    const first = await memberLiveView(ON, { discordId: 'me' }, null, { now: NOW, postFilter: async () => EMPTY_POST_FILTER })
    expect(vi.mocked(prisma.callLiveItem.findMany).mock.calls[0][0]).toMatchObject({ where: { sessionId: 'evt-1' } })
    expect((vi.mocked(prisma.callLiveItem.findMany).mock.calls[0][0] as { where: Record<string, unknown> }).where.createdAt).toBeUndefined()
    expect(first.itemsCursor).toBe(t2)
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([] as never)
    const next = await memberLiveView(ON, { discordId: 'me' }, first.itemsCursor, { now: NOW, postFilter: async () => EMPTY_POST_FILTER })
    expect(vi.mocked(prisma.callLiveItem.findMany).mock.calls[1][0]).toMatchObject({ where: { sessionId: 'evt-1', createdAt: { gt: new Date(t2) } } })
    expect(next.items).toEqual([])
    expect(next.itemsCursor).toBe(t2)
  })

  it('locks the action items below calls.actionItemsMinLevel without querying them', async () => {
    access.mockResolvedValue({ actionItems: { visible: false, minLevel: 4 }, host: false })
    const out = await memberLiveView(ON, { discordId: 'me' }, null, { now: NOW, postFilter: async () => EMPTY_POST_FILTER })
    expect(out.itemsLocked).toBe(4)
    expect(out.items).toEqual([])
    expect(prisma.callLiveItem.findMany).not.toHaveBeenCalled()
    // names are still shown (any signed-in member)
    expect(out.live?.present.length).toBeGreaterThan(0)
  })

  it('drops items with a blocked term, and shows none when the private filter cannot be read', async () => {
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([item('a', { text: 'plan the secret thing' }), item('b')] as never)
    const filtered = await memberLiveView(ON, { discordId: 'me' }, null, { now: NOW, postFilter: async () => ({ ...EMPTY_POST_FILTER, blockedTerms: ['secret'] }) })
    expect(filtered.items.map((i) => i.id)).toEqual(['b'])
    const failed = await memberLiveView(ON, { discordId: 'me' }, null, { now: NOW, postFilter: async () => { throw new Error('down') } })
    expect(failed.items).toEqual([])
  })

  it('says nothing is live when there is no session, keeping the cursor', async () => {
    vi.mocked(prisma.callLiveSession.findMany).mockResolvedValue([] as never)
    const out = await memberLiveView(ON, { discordId: 'me' }, 123, { now: NOW })
    expect(out.live).toBeNull()
    expect(out.itemsCursor).toBe(123)
  })
})
