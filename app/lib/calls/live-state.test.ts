// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ crews: [], cached: true })) }))

import { prisma } from '@/app/lib/db'
import type { Settings } from '@/app/lib/settings'
import { SETTINGS, type SettingKey } from '@/app/lib/settings/registry'
import { EMPTY_POST_FILTER } from './post-filters'
import { betterStreamLink, findLiveSessionById, findLiveSessions, findStreamLink, handleLiveState, isSessionLive, liveStateSchema, normalizeStreamLink, parseStreamLinks, streamLinkFor, type LiveStateBody } from './live-state'

function fakeSettings(over: Partial<Record<SettingKey, unknown>> = {}): Settings {
  return {
    readFailed: false,
    invalidKeys: [],
    isSet: (k) => k in over,
    get: ((k: SettingKey) => (k in over ? over[k] : SETTINGS[k].default)) as Settings['get'],
  }
}
const ON = { 'calls.liveViewEnabled': true }
const env = { VERCEL_ENV: 'production' }
const sessions = vi.mocked(prisma.callLiveSession)

const body = (over: Partial<LiveStateBody> = {}): LiveStateBody => ({
  sessionId: 'evt-1700000000000',
  eventId: '100000000000000001',
  eventName: 'Ops call',
  startedAt: new Date(1_700_000_000_000).toISOString(),
  present: [{ discordId: '111111111111111', displayName: 'Ann', presentSec: 30, inChannel: true }],
  ...over,
})
const deps = (extra: Record<string, unknown> = {}) => ({
  settings: fakeSettings(ON),
  env,
  now: () => 1_700_000_100_000,
  resolveCrew: async () => ({ crewId: 'ops', crewLabel: 'Ops' }),
  postFilter: async () => EMPTY_POST_FILTER,
  ...extra,
})

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.clearAllMocks()
  sessions.findUnique.mockResolvedValue(null as never)
  sessions.create.mockResolvedValue({} as never)
  sessions.updateMany.mockResolvedValue({ count: 1 } as never)
})

describe('liveStateSchema (validation)', () => {
  it('accepts the recorder body', () => {
    expect(liveStateSchema.safeParse(body()).success).toBe(true)
  })
  it('rejects a bad session, time, member id, negative minutes and too many people', () => {
    expect(liveStateSchema.safeParse({ ...body(), sessionId: '' }).success).toBe(false)
    expect(liveStateSchema.safeParse({ ...body(), startedAt: 'yesterday' }).success).toBe(false)
    expect(liveStateSchema.safeParse({ ...body(), present: [{ discordId: 'abc', presentSec: 1, inChannel: true }] }).success).toBe(false)
    expect(liveStateSchema.safeParse({ ...body(), present: [{ discordId: '111111111111111', presentSec: -1, inChannel: true }] }).success).toBe(false)
    const many = Array.from({ length: 301 }, (_, i) => ({ discordId: String(100000000000000 + i), presentSec: 1, inChannel: true }))
    expect(liveStateSchema.safeParse({ ...body(), present: many }).success).toBe(false)
  })
})

describe('stream link detection', () => {
  it('accepts x.com / twitter.com broadcast and status links only', () => {
    expect(findStreamLink('go to https://x.com/i/broadcasts/1OyKAabc now')).toBe('https://x.com/i/broadcasts/1OyKAabc')
    expect(findStreamLink('https://twitter.com/pizzadao/status/99.')).toBe('https://twitter.com/pizzadao/status/99')
    expect(findStreamLink('https://x.com/a/status/1 then https://x.com/i/broadcasts/zz')).toBe('https://x.com/i/broadcasts/zz')
    expect(findStreamLink('https://youtube.com/watch?v=1')).toBeNull()
    expect(findStreamLink('https://x.com/pizzadao')).toBeNull()
    expect(normalizeStreamLink('http://x.com/i/broadcasts/abc')).toBeNull()
  })
  it('falls back to calls.liveStreamLinks per crew (bad lines skipped), the chat link wins', () => {
    const s = fakeSettings({ 'calls.liveStreamLinks': 'community_call = https://x.com/i/broadcasts/aaa\nbroken\nops = https://evil.test/x' })
    expect(parseStreamLinks('community_call = https://x.com/i/broadcasts/aaa\nops = https://evil.test/x').size).toBe(1)
    expect(streamLinkFor({ streamLink: null, crewId: 'community_call' }, s)).toBe('https://x.com/i/broadcasts/aaa')
    expect(streamLinkFor({ streamLink: null, crewId: 'ops' }, s)).toBeNull()
    expect(streamLinkFor({ streamLink: 'https://x.com/i/broadcasts/chat', crewId: 'community_call' }, s)).toBe('https://x.com/i/broadcasts/chat')
    expect(streamLinkFor({ streamLink: 'https://x.com/i/broadcasts/chat', streamLinkOverride: 'https://x.com/i/broadcasts/host', crewId: 'community_call' }, s)).toBe('https://x.com/i/broadcasts/host')
  })
})

describe('stale handling', () => {
  const now = 1_000_000
  const s = (over: Partial<{ endedAt: Date | null; hidden: boolean; lastSeenAt: Date }> = {}) => ({ endedAt: null, hidden: false, lastSeenAt: new Date(now - 10_000), ...over })
  it('is live with a recent heartbeat, not ended, not hidden', () => {
    expect(isSessionLive(s(), now, 120)).toBe(true)
  })
  it('no heartbeat for more than the stale window counts as ended', () => {
    expect(isSessionLive(s({ lastSeenAt: new Date(now - 121_000) }), now, 120)).toBe(false)
    expect(isSessionLive(s({ lastSeenAt: new Date(now - 120_000) }), now, 120)).toBe(true)
  })
  it('ended and hidden sessions are never live', () => {
    expect(isSessionLive(s({ endedAt: new Date(now) }), now, 120)).toBe(false)
    expect(isSessionLive(s({ hidden: true }), now, 120)).toBe(false)
  })
  it('findLiveSessions queries with the stale cutoff from the setting and the live-view switch, newest first', async () => {
    sessions.findMany.mockResolvedValue([{ sessionId: 'a' }, { sessionId: 'b' }] as never)
    expect(await findLiveSessions(fakeSettings({ ...ON, 'calls.liveStaleSeconds': 90 }), 1_000_000)).toEqual([{ sessionId: 'a' }, { sessionId: 'b' }])
    expect(sessions.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { endedAt: null, hidden: false, lastSeenAt: { gte: new Date(1_000_000 - 90_000) } }, orderBy: { startedAt: 'desc' } }))
    expect((await findLiveSessionById(fakeSettings(ON), 'b', 1_000_000))?.sessionId).toBe('b')
    expect(await findLiveSessionById(fakeSettings(ON), 'zzz', 1_000_000)).toBeNull()
    sessions.findMany.mockClear()
    expect(await findLiveSessions(fakeSettings({}), 1_000_000)).toEqual([])
    expect(sessions.findMany).not.toHaveBeenCalled()
  })
})

describe('handleLiveState', () => {
  it('answers off (no write) while the live view is off', async () => {
    expect(await handleLiveState(body(), deps({ settings: fakeSettings({}) }))).toBe('off')
    expect(sessions.create).not.toHaveBeenCalled()
    expect(sessions.updateMany).not.toHaveBeenCalled()
  })

  it('creates the session with the resolved crew and the people', async () => {
    expect(await handleLiveState(body({ streamLink: 'https://x.com/i/broadcasts/abc' }), deps())).toBe('ok')
    const arg = sessions.create.mock.calls[0][0] as unknown as { data: Record<string, unknown> }
    expect(arg.data).toMatchObject({ sessionId: 'evt-1700000000000', crewId: 'ops', hidden: false, endedAt: null, streamLink: 'https://x.com/i/broadcasts/abc' })
    expect(arg.data.presence).toEqual([{ discordId: '111111111111111', displayName: 'Ann', presentSec: 30, inChannel: true }])
  })

  it('ignores a stream link that is not an x.com broadcast or status link', async () => {
    await handleLiveState(body({ streamLink: 'https://evil.test/i/broadcasts/abc' }), deps())
    expect((sessions.create.mock.calls[0][0] as unknown as { data: { streamLink: unknown } }).data.streamLink).toBeNull()
  })

  it('keeps the first stream link, except that a broadcast link replaces a status link', async () => {
    sessions.findUnique.mockResolvedValue({ endedAt: null, crewId: 'ops', crewLabel: 'Ops', streamLink: 'https://x.com/i/broadcasts/first' } as never)
    await handleLiveState(body({ streamLink: 'https://x.com/i/broadcasts/second' }), deps())
    expect((sessions.updateMany.mock.calls[0][0] as unknown as { data: { streamLink: unknown } }).data.streamLink).toBe('https://x.com/i/broadcasts/first')
    sessions.findUnique.mockResolvedValue({ endedAt: null, crewId: 'ops', crewLabel: 'Ops', streamLink: 'https://x.com/pizzadao/status/5' } as never)
    await handleLiveState(body({ streamLink: 'https://x.com/i/broadcasts/second' }), deps())
    expect((sessions.updateMany.mock.calls[1][0] as unknown as { data: { streamLink: unknown } }).data.streamLink).toBe('https://x.com/i/broadcasts/second')
    expect(betterStreamLink('https://x.com/i/broadcasts/a', 'https://x.com/p/status/1')).toBe('https://x.com/i/broadcasts/a')
  })

  it('marks the session ended at stop', async () => {
    sessions.findUnique.mockResolvedValue({ endedAt: null, crewId: 'ops', crewLabel: 'Ops', streamLink: null } as never)
    expect(await handleLiveState(body({ ended: true }), deps())).toBe('ended')
    expect((sessions.updateMany.mock.calls[0][0] as unknown as { data: { endedAt: Date } }).data.endedAt).toEqual(new Date(1_700_000_100_000))
  })

  it('never clears endedAt: an ordinary heartbeat writes conditionally on "not ended" and has no endedAt', async () => {
    sessions.findUnique.mockResolvedValue({ endedAt: null, crewId: 'ops', crewLabel: 'Ops', streamLink: null } as never)
    await handleLiveState(body(), deps())
    const arg = sessions.updateMany.mock.calls[0][0] as unknown as { where: Record<string, unknown>; data: Record<string, unknown> }
    expect(arg.where).toEqual({ sessionId: 'evt-1700000000000', endedAt: null })
    expect('endedAt' in arg.data).toBe(false)
  })

  it('does not revive an ended session on a late heartbeat (even one racing the end)', async () => {
    sessions.findUnique.mockResolvedValue({ endedAt: new Date(1) } as never)
    expect(await handleLiveState(body(), deps())).toBe('ended')
    expect(sessions.create).not.toHaveBeenCalled()
    expect(sessions.updateMany).not.toHaveBeenCalled()
  })

  it('a create that loses a race falls back to the conditional update', async () => {
    sessions.create.mockRejectedValue({ code: 'P2002' })
    expect(await handleLiveState(body(), deps())).toBe('ok')
    expect(sessions.updateMany).toHaveBeenCalledTimes(1)
  })

  it('hides an excluded crew, and hides when the filter cannot be read (fail closed)', async () => {
    await handleLiveState(body(), deps({ postFilter: async () => ({ ...EMPTY_POST_FILTER, excludedCrewIds: ['ops'] }) }))
    expect((sessions.create.mock.calls[0][0] as unknown as { data: { hidden: boolean } }).data.hidden).toBe(true)
    sessions.create.mockClear()
    await handleLiveState(body(), deps({ postFilter: async () => { throw new Error('down') } }))
    expect((sessions.create.mock.calls[0][0] as unknown as { data: { hidden: boolean } }).data.hidden).toBe(true)
  })

  it('hides a session whose crew is unknown (cannot be checked against the filter)', async () => {
    const filter = vi.fn(async () => EMPTY_POST_FILTER)
    await handleLiveState(body(), deps({ resolveCrew: async () => null, postFilter: filter }))
    expect((sessions.create.mock.calls[0][0] as unknown as { data: { hidden: boolean; crewId: unknown } }).data).toMatchObject({ hidden: true, crewId: null })
    sessions.create.mockClear()
    await handleLiveState(body(), deps({ resolveCrew: async () => { throw new Error('sheet down') } }))
    expect((sessions.create.mock.calls[0][0] as unknown as { data: { hidden: boolean } }).data.hidden).toBe(true)
  })

  it('de-duplicates people and drops control characters from names', async () => {
    await handleLiveState(
      body({ present: [
        { discordId: '111111111111111', displayName: 'A\nnn', presentSec: 1, inChannel: true },
        { discordId: '111111111111111', displayName: 'Again', presentSec: 2, inChannel: true },
      ] }),
      deps(),
    )
    const presence = (sessions.create.mock.calls[0][0] as unknown as { data: { presence: Array<{ displayName: string }> } }).data.presence
    expect(presence).toHaveLength(1)
    expect(presence[0].displayName).toBe('A nn')
  })
})
