// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
const access = vi.fn()
vi.mock('./live-access', () => ({ liveAccess: (...a: unknown[]) => access(...a) }))

import { prisma } from '@/app/lib/db'
import type { Settings } from '@/app/lib/settings'
import { SETTINGS, type SettingKey } from '@/app/lib/settings/registry'
import { EMPTY_POST_FILTER } from './post-filters'
import { clearQaCache } from './live-qa'
import { clearLiveViewCache, memberLiveView, parseCursor, publicLiveView } from './live-view'

function fakeSettings(over: Partial<Record<SettingKey, unknown>> = {}): Settings {
  return { readFailed: false, invalidKeys: [], isSet: (k) => k in over, get: ((k: SettingKey) => (k in over ? over[k] : SETTINGS[k].default)) as Settings['get'] }
}
const ON = fakeSettings({ 'calls.liveViewEnabled': true, 'calls.liveStreamLinks': 'ops = https://x.com/i/broadcasts/fallback' })
const NOW = 1_700_000_100_000
const filterOk = async () => EMPTY_POST_FILTER

const session = {
  sessionId: 'evt-1',
  eventName: 'Ops call',
  crewId: 'ops',
  crewLabel: 'Ops',
  streamLink: null,
  streamLinkOverride: null,
  startedAt: new Date(NOW - 600_000),
  presence: [
    { discordId: '111111111111111', displayName: 'Ann', presentSec: 600, inChannel: true },
    { discordId: '222222222222222', displayName: 'Bob', presentSec: 120, inChannel: true },
    { discordId: '333333333333333', displayName: 'Cy', presentSec: 60, inChannel: false },
    { discordId: '444444444444444', displayName: 'Speaker 3', presentSec: 60, inChannel: true },
  ],
}
const second = { ...session, sessionId: 'evt-2', eventName: 'LATAM call', crewId: 'latam', crewLabel: 'LATAM', startedAt: new Date(NOW - 300_000), presence: [{ discordId: '555555555555555', displayName: 'Dee', presentSec: 30, inChannel: true }] }
const item = (id: string, over: Record<string, unknown> = {}) => ({ id, sessionId: 'evt-1', text: `item ${id}`, owner: null, source: 'speech', speakerIds: ['111111111111111'], createdAt: new Date(NOW - 1000), ...over })

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.clearAllMocks()
  clearLiveViewCache()
  clearQaCache()
  vi.mocked(prisma.callLiveSession.findMany).mockResolvedValue([session] as never)
  vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.callLiveChunk.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.attendanceSummary.findMany).mockResolvedValue([{ discordId: '111111111111111', memberId: 'm-ann' }] as never)
  vi.mocked(prisma.callLiveQuestion.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.callLivePoll.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.callLiveQuestionVote.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.callLivePollVote.findMany).mockResolvedValue([] as never)
  access.mockResolvedValue({ actionItems: { visible: true, minLevel: 4 }, host: false })
})

const view = (over: { settings?: Settings; cursors?: Map<string, string>; filter?: () => Promise<never> | Promise<typeof EMPTY_POST_FILTER>; who?: string; now?: number } = {}) =>
  memberLiveView(over.settings ?? ON, { discordId: over.who ?? 'me' }, over.cursors ?? new Map(), { now: over.now ?? NOW, postFilter: (over.filter ?? filterOk) as never })

describe('public endpoint payload', () => {
  it('has title, crew, start, stream link and head count only: no names or member ids', async () => {
    const out = await publicLiveView(ON, NOW)
    expect(out.calls).toEqual([{ sessionId: 'evt-1', title: 'Ops call', crewLabel: 'Ops', startedAt: session.startedAt.toISOString(), streamLink: 'https://x.com/i/broadcasts/fallback', presentCount: 3 }])
    const json = JSON.stringify(out)
    for (const leak of ['Ann', 'Bob', 'Cy', '111111111111111', 'presence', 'm-ann']) expect(json).not.toContain(leak)
  })
  it('is empty when nothing is live or the live view is off', async () => {
    vi.mocked(prisma.callLiveSession.findMany).mockResolvedValue([] as never)
    expect((await publicLiveView(ON, NOW)).calls).toEqual([])
    vi.mocked(prisma.callLiveSession.findMany).mockResolvedValue([session] as never)
    expect((await publicLiveView(fakeSettings({}), NOW)).calls).toEqual([])
  })
  it('lists every live call', async () => {
    vi.mocked(prisma.callLiveSession.findMany).mockResolvedValue([second, session] as never)
    expect((await publicLiveView(ON, NOW)).calls.map((c) => c.title)).toEqual(['LATAM call', 'Ops call'])
  })
  it('a host override wins, then the link from the call chat, then the crew setting', async () => {
    vi.mocked(prisma.callLiveSession.findMany).mockResolvedValue([{ ...session, streamLink: 'https://x.com/i/broadcasts/chat' }] as never)
    expect((await publicLiveView(ON, NOW)).calls[0].streamLink).toBe('https://x.com/i/broadcasts/chat')
    vi.mocked(prisma.callLiveSession.findMany).mockResolvedValue([{ ...session, streamLink: 'https://x.com/i/broadcasts/chat', streamLinkOverride: 'https://x.com/i/broadcasts/host' }] as never)
    expect((await publicLiveView(ON, NOW)).calls[0].streamLink).toBe('https://x.com/i/broadcasts/host')
  })
})

describe('member endpoint payload', () => {
  it('lists people in the channel with minutes and a profile link only for known members', async () => {
    const out = await view()
    const call = out.calls[0]
    expect(call.present.map((p) => p.name)).toEqual(['Ann', 'Bob', 'Speaker 3'])
    expect(call.present[0]).toEqual({ name: 'Ann', memberId: 'm-ann', minutes: 10 })
    expect(call.present[1].memberId).toBeNull()
    expect(call.present.some((p) => p.name === 'Cy')).toBe(false) // left the call
    expect(call.presentCount).toBe(3)
  })

  it('returns every live call, each with its own people and items', async () => {
    vi.mocked(prisma.callLiveSession.findMany).mockResolvedValue([second, session] as never)
    const out = await view()
    expect(out.calls.map((c) => c.sessionId)).toEqual(['evt-2', 'evt-1'])
    expect(out.calls[0].present.map((p) => p.name)).toEqual(['Dee'])
    expect(vi.mocked(prisma.callLiveItem.findMany).mock.calls.map((c) => (c[0] as { where: { sessionId: string } }).where.sessionId).sort()).toEqual(['evt-1', 'evt-2'])
  })

  it('returns who suggested each item (first speaker), never a generic "Speaker N", with a link when known', async () => {
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([item('a'), item('b', { speakerIds: ['444444444444444'] }), item('c', { speakerIds: [] })] as never)
    const out = await view()
    expect(out.calls[0].items.map((i) => i.suggestedBy)).toEqual([{ name: 'Ann', memberId: 'm-ann' }, null, null])
  })

  it('falls back to the transcript line name when the speaker has no name in the heartbeat', async () => {
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([item('a', { speakerIds: ['666666666666666'] })] as never)
    vi.mocked(prisma.callLiveChunk.findMany).mockResolvedValue([{ segments: [{ discordId: '666666666666666', name: 'Eli', text: 'x' }] }] as never)
    expect((await view()).calls[0].items[0].suggestedBy).toEqual({ name: 'Eli', memberId: null })
  })

  it('uses the member name when the call has no name for the speaker, and credits nobody when several speakers are possible', async () => {
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([item('a', { speakerIds: ['777777777777777'] }), item('b', { speakerIds: ['111111111111111', '222222222222222'] })] as never)
    vi.mocked(prisma.member.findMany).mockResolvedValue([{ id: 'm-zed', discordId: '777777777777777', name: 'Zed' }] as never)
    const out = await view()
    expect(out.calls[0].items.map((i) => i.suggestedBy?.name ?? null)).toEqual(['Zed', null])
  })

  it('cursor is (createdAt, id): only newer items, and same-millisecond rows are not skipped', async () => {
    const t = NOW - 1000
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([item('a', { createdAt: new Date(t - 5000) }), item('b', { createdAt: new Date(t) }), item('c', { createdAt: new Date(t) })] as never)
    const first = await view()
    expect(first.calls[0].items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(first.calls[0].itemsCursor).toBe(`${t}~c`)
    clearLiveViewCache()
    // a later poll that has seen only "b" at that millisecond still gets "c"
    const next = await view({ cursors: new Map([['evt-1', `${t}~b`]]) })
    expect(next.calls[0].items.map((i) => i.id)).toEqual(['c'])
    clearLiveViewCache()
    const done = await view({ cursors: new Map([['evt-1', first.calls[0].itemsCursor!]]) })
    expect(done.calls[0].items).toEqual([])
    expect(done.calls[0].itemsCursor).toBe(`${t}~c`)
    expect(parseCursor(`${t}~c`)).toEqual({ ms: t, id: 'c' })
    expect(parseCursor('junk')).toBeNull()
  })

  it('locks the action items below calls.actionItemsMinLevel; names are still shown', async () => {
    access.mockResolvedValue({ actionItems: { visible: false, minLevel: 4 }, host: false })
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([item('a')] as never)
    const out = await view()
    expect(out.calls[0].itemsLocked).toBe(4)
    expect(out.calls[0].items).toEqual([])
    expect(out.calls[0].present.length).toBeGreaterThan(0)
  })

  it('drops items with a blocked term, and shows no items, questions or polls when the private filter cannot be read', async () => {
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([item('a', { text: 'plan the secret thing' }), item('b')] as never)
    const filtered = await view({ filter: async () => ({ ...EMPTY_POST_FILTER, blockedTerms: ['secret'] }) })
    expect(filtered.calls[0].items.map((i) => i.id)).toEqual(['b'])
    clearLiveViewCache()
    const failed = await view({ filter: async () => { throw new Error('down') } })
    expect(failed.calls[0].items).toEqual([])
    expect(failed.calls[0].questions).toEqual([])
    expect(failed.calls[0].polls).toEqual([])
  })

  it('says nothing is live when there is no session', async () => {
    vi.mocked(prisma.callLiveSession.findMany).mockResolvedValue([] as never)
    const out = await view()
    expect(out.calls).toEqual([])
  })
})

describe('polling cost', () => {
  it('builds the session-wide view once per ~3 s for all viewers; a viewer adds only their own votes', async () => {
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([item('a')] as never)
    await view({ who: 'u1' })
    await view({ who: 'u2', now: NOW + 1000 })
    await view({ who: 'u3', now: NOW + 2000 })
    expect(prisma.callLiveItem.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.callLiveQuestion.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.callLivePoll.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.attendanceSummary.findMany).toHaveBeenCalledTimes(1) // profile ids once for everyone
    expect(prisma.callLiveQuestionVote.findMany).toHaveBeenCalledTimes(3) // own votes, per viewer
    expect(vi.mocked(prisma.callLiveQuestionVote.findMany).mock.calls[2][0]).toMatchObject({ where: { voterId: 'u3' } })
    await view({ who: 'u4', now: NOW + 3500 })
    expect(prisma.callLiveItem.findMany).toHaveBeenCalledTimes(2)
  })
})
