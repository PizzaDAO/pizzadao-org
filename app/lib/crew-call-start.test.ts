// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  EVENT_STATUS_ACTIVE,
  EVENT_STATUS_SCHEDULED,
  decideCrewCallStart,
  renderPost,
  runCrewCallStart,
  type DecideInput,
  type StartDeps,
  type StartInput,
} from './crew-call-start'

const NOW = Date.parse('2026-11-21T17:00:00Z')
const MIN = 60_000
const VOICE = '900000000000000001'
const settings = { allowAdHoc: false, startWindowMinutes: 30, cooldownMinutes: 30, pingRole: false, postTemplate: '{crew} call is starting now. Join: {voice} Live notes: {live}' }

const base = (over: Partial<DecideInput> = {}): DecideInput => ({
  nowMs: NOW,
  crewId: 'ops',
  event: { id: '800000000000000001', status: EVENT_STATUS_SCHEDULED, scheduledStartMs: NOW + 10 * MIN, channelId: VOICE },
  voiceChannelId: VOICE,
  recordable: [VOICE],
  live: [],
  lastStartMs: null,
  nextCallMs: NOW + 3 * 24 * 60 * MIN,
  settings,
  ...over,
})

describe('decideCrewCallStart', () => {
  it('starts the scheduled event when its start is inside the window (early or late)', () => {
    expect(decideCrewCallStart(base()).kind).toBe('start_event')
    expect(decideCrewCallStart(base({ event: { id: '1', status: EVENT_STATUS_SCHEDULED, scheduledStartMs: NOW - 20 * MIN, channelId: VOICE } })).kind).toBe('start_event')
  })
  it('keys the occurrence by event and scheduled start', () => {
    const d = decideCrewCallStart(base())
    expect(d.kind === 'start_event' && d.occurrenceKey).toBe(`800000000000000001:${new Date(NOW + 10 * MIN).toISOString()}`)
  })
  it('refuses outside the window unless ad hoc is on', () => {
    const far = { id: '1', status: EVENT_STATUS_SCHEDULED, scheduledStartMs: NOW + 5 * 60 * MIN, channelId: VOICE }
    const d = decideCrewCallStart(base({ event: far }))
    expect(d).toEqual({ kind: 'not_scheduled', nextCallMs: NOW + 3 * 24 * 60 * MIN })
    const adhoc = decideCrewCallStart(base({ event: far, settings: { ...settings, allowAdHoc: true } }))
    expect(adhoc.kind).toBe('start_adhoc')
    if (adhoc.kind === 'start_adhoc') {
      expect(adhoc.startMs).toBe(NOW + MIN)
      expect(adhoc.occurrenceKey).toBe(`adhoc:ops:${Math.floor(NOW / (10 * MIN))}`)
    }
  })
  it('handles a crew with no event', () => {
    expect(decideCrewCallStart(base({ event: null })).kind).toBe('not_scheduled')
    expect(decideCrewCallStart(base({ event: null, settings: { ...settings, allowAdHoc: true } })).kind).toBe('start_adhoc')
  })
  it('answers already_live for an ACTIVE event or a fresh live session of the crew', () => {
    expect(decideCrewCallStart(base({ event: { id: '1', status: EVENT_STATUS_ACTIVE, scheduledStartMs: NOW - MIN, channelId: VOICE } })).kind).toBe('already_live')
    const live = [{ crewId: 'ops', crewLabel: 'Ops', channelId: VOICE, lastSeenAtMs: NOW - 30_000, endedAt: false }]
    expect(decideCrewCallStart(base({ live })).kind).toBe('already_live')
    // a stale or ended session does not count
    expect(decideCrewCallStart(base({ live: [{ ...live[0], lastSeenAtMs: NOW - 10 * MIN }] })).kind).toBe('start_event')
    expect(decideCrewCallStart(base({ live: [{ ...live[0], endedAt: true }] })).kind).toBe('start_event')
  })
  it('refuses when another crew is live in the shared channel, naming it', () => {
    const live = [{ crewId: 'tech', crewLabel: 'Tech', channelId: VOICE, lastSeenAtMs: NOW - 30_000, endedAt: false }]
    expect(decideCrewCallStart(base({ live }))).toEqual({ kind: 'channel_busy', otherCrewLabel: 'Tech' })
    // another crew in a different channel is fine
    expect(decideCrewCallStart(base({ live: [{ ...live[0], channelId: '900000000000000002' }] })).kind).toBe('start_event')
  })
  it('refuses a channel the recorder cannot join', () => {
    expect(decideCrewCallStart(base({ recordable: ['900000000000000009'] })).kind).toBe('not_recordable')
    expect(decideCrewCallStart(base({ voiceChannelId: null })).kind).toBe('not_recordable')
  })
  it('applies the cooldown after a start', () => {
    const d = decideCrewCallStart(base({ lastStartMs: NOW - 10 * MIN }))
    expect(d).toEqual({ kind: 'cooldown', untilMs: NOW + 20 * MIN })
    expect(decideCrewCallStart(base({ lastStartMs: NOW - 31 * MIN })).kind).toBe('start_event')
  })
})

function makeDeps(over: Partial<StartDeps> = {}): StartDeps & { claims: Set<string> } {
  const claims = new Set<string>()
  return {
    claims,
    isProduction: true,
    now: () => NOW,
    claim: vi.fn(async (row) => {
      if (claims.has(row.occurrenceKey)) return { ok: false as const, by: 'someone', atMs: NOW - 1000 }
      claims.add(row.occurrenceKey)
      return { ok: true as const }
    }),
    release: vi.fn(async (k: string) => void claims.delete(k)),
    annotate: vi.fn(async () => {}),
    discord: {
      setActive: vi.fn(async () => {}),
      createAdHoc: vi.fn(async () => ({ id: '800000000000000099' })),
      cancel: vi.fn(async () => {}),
      post: vi.fn(async () => ({ id: 'm1' })),
    },
    ...over,
  }
}

const input = (over: Partial<StartInput> = {}): StartInput => ({
  decision: decideCrewCallStart(base()),
  crewId: 'ops',
  crewLabel: 'Ops',
  startedBy: 'u1',
  startedByLabel: 'member 7',
  callLengthMinutes: 60,
  voiceUrl: 'https://discord.com/channels/1/2',
  liveUrl: 'https://example.test/calls/live',
  roleId: '700000000000000001',
  settings,
  ...over,
})

describe('runCrewCallStart', () => {
  it('sets the event active with an audit reason and posts without pinging', async () => {
    const d = makeDeps()
    const r = await runCrewCallStart(input(), d)
    expect(r).toMatchObject({ status: 'started', adHoc: false, posted: true })
    expect(d.discord.setActive).toHaveBeenCalledWith('800000000000000001', 'Started from the crew page by member 7')
    const post = vi.mocked(d.discord.post).mock.calls[0][0]
    expect(post.mentionRoleId).toBeNull()
    expect(post.content).toBe('Ops call is starting now. Join: https://discord.com/channels/1/2 Live notes: https://example.test/calls/live')
  })
  it('pings the crew role only when the setting is on', async () => {
    const d = makeDeps()
    await runCrewCallStart(input({ settings: { ...settings, pingRole: true } }), d)
    expect(vi.mocked(d.discord.post).mock.calls[0][0]).toMatchObject({ mentionRoleId: '700000000000000001' })
  })
  it('a double press starts once: the second claim loses', async () => {
    const d = makeDeps()
    const [a, b] = await Promise.all([runCrewCallStart(input(), d), runCrewCallStart(input({ startedBy: 'u2' }), d)])
    expect([a.status, b.status].sort()).toEqual(['already_started', 'started'])
    expect(d.discord.setActive).toHaveBeenCalledTimes(1)
    expect(d.discord.post).toHaveBeenCalledTimes(1)
  })
  it('a Discord failure releases the claim so the start can be retried', async () => {
    const d = makeDeps()
    vi.mocked(d.discord.setActive).mockRejectedValueOnce(new Error('Missing Permissions'))
    const r = await runCrewCallStart(input(), d)
    expect(r.status).toBe('discord_failed')
    expect(d.claims.size).toBe(0)
    expect(d.discord.post).not.toHaveBeenCalled()
    expect((await runCrewCallStart(input(), d)).status).toBe('started')
  })
  it('a failed post keeps the start', async () => {
    const d = makeDeps()
    vi.mocked(d.discord.post).mockRejectedValueOnce(new Error('boom'))
    const r = await runCrewCallStart(input(), d)
    expect(r).toMatchObject({ status: 'started', posted: false })
    expect(d.claims.size).toBe(1)
    expect(d.annotate).toHaveBeenCalledWith('800000000000000001:' + new Date(NOW + 10 * MIN).toISOString(), expect.objectContaining({ error: expect.stringContaining('post failed') }))
  })
  it('creates a one-off event for an ad hoc call, named for the crew, then starts it', async () => {
    const d = makeDeps()
    const decision = decideCrewCallStart(base({ event: null, settings: { ...settings, allowAdHoc: true } }))
    const r = await runCrewCallStart(input({ decision }), d)
    expect(r).toMatchObject({ status: 'started', adHoc: true, eventId: '800000000000000099' })
    expect(d.discord.createAdHoc).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ops call', channelId: VOICE, startMs: NOW + MIN, endMs: NOW + MIN + 60 * MIN }))
    expect(d.discord.setActive).toHaveBeenCalledWith('800000000000000099', expect.any(String))
  })
  it('cancels an ad hoc event it could not start and releases the claim', async () => {
    const d = makeDeps()
    vi.mocked(d.discord.setActive).mockRejectedValueOnce(new Error('nope'))
    const decision = decideCrewCallStart(base({ event: null, settings: { ...settings, allowAdHoc: true } }))
    const r = await runCrewCallStart(input({ decision }), d)
    expect(r.status).toBe('discord_failed')
    expect(d.discord.cancel).toHaveBeenCalledWith('800000000000000099', expect.any(String))
    expect(d.claims.size).toBe(0)
  })
  it('preview deploys write nothing: no claim, no Discord', async () => {
    const d = makeDeps({ isProduction: false })
    const r = await runCrewCallStart(input(), d)
    expect(r).toEqual({ status: 'preview', wouldDo: 'start_event' })
    expect(d.claim).not.toHaveBeenCalled()
    expect(d.discord.setActive).not.toHaveBeenCalled()
    expect(d.discord.createAdHoc).not.toHaveBeenCalled()
    expect(d.discord.post).not.toHaveBeenCalled()
  })
  it('passes refusals through without touching anything', async () => {
    const d = makeDeps()
    const r = await runCrewCallStart(input({ decision: { kind: 'channel_busy', otherCrewLabel: 'Tech' } }), d)
    expect(r.status).toBe('channel_busy')
    expect(d.claim).not.toHaveBeenCalled()
  })
})

describe('renderPost', () => {
  it('fills the placeholders', () => {
    expect(renderPost('{crew}! {voice} {live}', { crew: 'Ops', voice: 'V', live: 'L' })).toBe('Ops! V L')
  })
})
