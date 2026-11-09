import { mkdtempSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CallLimits } from './call-limits.js'
import { allowedChannels, parseVoiceChannels, recordableEvents, resolveEventChannel, VOICE_CHANNELS_OFF } from './channels.js'
import type { Config } from './config.js'
import { EventStatus, type EventInfo } from './event-lifecycle.js'

const DEFAULT = '823956905739026442'
const LATAM = '900000000000000001'
const OTHER = '900000000000000002'

const { captured, finalizeSession } = vi.hoisted(() => ({
  captured: { joinedChannels: [] as string[], startFails: false },
  finalizeSession: vi.fn(async () => 'uploaded' as const),
}))

vi.mock('./capture.js', () => ({
  VoiceCapture: class {
    stats = new Map()
    degraded = false
    decryptFailures = 0
    rejoins = 0
    speakingNow: string[] = []
    constructor(readonly deps: { channelId: string }) {
      captured.joinedChannels.push(deps.channelId)
    }
    async start() {
      if (captured.startFails) throw new Error('cannot join')
    }
    beginCapture() {}
    async stop() {}
  },
}))
vi.mock('./finalize.js', async (orig) => ({ ...(await orig<typeof import('./finalize.js')>()), finalizeSession }))

import { CallRecorder } from './recorder.js'
import { NicknameManager } from './nickname.js'
import { readManifest } from './manifest.js'
import { parseRemoteConfig, type RemoteConfigClient } from './remote-config.js'

const ev = (over: Partial<EventInfo> = {}): EventInfo => ({
  id: '100000000000000001',
  name: 'LATAM Call',
  channelId: LATAM,
  status: EventStatus.Scheduled,
  scheduledStartMs: Date.now(),
  ...over,
})

describe('channel resolution', () => {
  const s = { allowed: [LATAM], byEvent: [{ eventId: '7', channelId: LATAM }] }

  it("uses the event's own channel first, then the crew mapping, else nothing", () => {
    expect(resolveEventChannel({ id: '7', channelId: OTHER }, s)).toBe(OTHER)
    expect(resolveEventChannel({ id: '7', channelId: null }, s)).toBe(LATAM)
    expect(resolveEventChannel({ id: '8', channelId: null }, s)).toBeNull()
  })

  it('allows the default channel plus the allowlist; an empty allowlist means the default only', () => {
    expect([...allowedChannels(VOICE_CHANNELS_OFF, DEFAULT)]).toEqual([DEFAULT])
    expect(allowedChannels(s, DEFAULT).has(LATAM)).toBe(true)
    expect(allowedChannels(s, DEFAULT).has(DEFAULT)).toBe(true)
    expect(allowedChannels(s, DEFAULT).has(OTHER)).toBe(false)
  })

  it('keeps recordable events with their channel filled in and drops the rest', () => {
    const events = [
      ev({ id: 'a', channelId: DEFAULT }),
      ev({ id: 'b', channelId: LATAM }),
      ev({ id: '7', channelId: null }),
      ev({ id: 'c', channelId: OTHER }),
      ev({ id: 'd', channelId: null }),
    ]
    const out = recordableEvents(events, s, DEFAULT)
    expect(out.map((e) => [e.id, e.channelId])).toEqual([
      ['a', DEFAULT],
      ['b', LATAM],
      ['7', LATAM],
    ])
    expect(recordableEvents(events, VOICE_CHANNELS_OFF, DEFAULT).map((e) => e.id)).toEqual(['a'])
  })

  it('parses the delivered settings and drops malformed entries', () => {
    expect(parseVoiceChannels(undefined)).toEqual(VOICE_CHANNELS_OFF)
    expect(parseVoiceChannels({ allowed: [LATAM, 'nope', 5], byEvent: [{ eventId: '7', channelId: LATAM }, { eventId: '8', channelId: 'x' }, 'bad'] })).toEqual({
      allowed: [LATAM],
      byEvent: [{ eventId: '7', channelId: LATAM }],
    })
  })
})

function world(voiceChannels: unknown, welcome = false) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'multi-'))
  const members = new Map<string, string[]>() // channel -> member ids
  const sends: Array<{ channel: string; content: string }> = []
  const channels = new Map<string, unknown>()
  const channelOf = (id: string) => {
    if (!channels.has(id)) {
      channels.set(id, {
        id,
        isVoiceBased: () => true,
        send: vi.fn(async (m: { content: string }) => {
          sends.push({ channel: id, content: m.content })
        }),
      })
    }
    return channels.get(id)
  }
  const me = { nickname: 'Metalhead' as string | null, setNickname: vi.fn(async (n: string | null) => void (me.nickname = n)) }
  const guild = {
    id: 'g1',
    members: { fetchMe: async () => me, fetch: async () => ({ displayName: 'x' }) },
    channels: { fetch: async (id: string) => channelOf(id) },
    voiceStates: {
      cache: {
        filter: (fn: (vs: { channelId: string; id: string }) => boolean) => {
          const all = [...members].flatMap(([channelId, ids]) => ids.map((id) => ({ channelId, id })))
          return { map: (g: (vs: { id: string }) => string) => all.filter(fn).map(g) }
        },
      },
    },
  }
  const client = { guilds: { fetch: async () => guild }, users: { fetch: async () => ({ bot: false }) } }
  const cfg = { dataDir, guildId: 'g1', callChannelId: DEFAULT, maxCallMinutes: 120, eventCaps: [], emptyGraceMinutes: 5, captureVoiceChat: true } as Config
  const logs: string[] = []
  let raw: Record<string, unknown> = { voiceChannels, startNotice: 'We record.', ...(welcome ? { welcome: { enabled: true } } : {}) }
  const remote = { get: () => parseRemoteConfig(raw), refresh: async () => parseRemoteConfig(raw) } as unknown as RemoteConfigClient
  const setVoiceChannels = (v: unknown) => void (raw = { ...raw, voiceChannels: v })
  const jobs: Array<() => Promise<void>> = []
  const rec = new CallRecorder(
    client as never,
    cfg,
    new NicknameManager(dataDir, () => {}, async () => {}),
    { appBaseUrl: 'x', apiKey: 'k', uploader: {} as never, log: () => {} },
    (m) => logs.push(m),
    (fn) => void jobs.push(fn),
    remote,
  )
  return { rec, setVoiceChannels, members, sends, logs, dataDir, jobs, channelOf }
}

const sessionDir = (dataDir: string) => path.join(dataDir, readdirSync(dataDir).filter((n) => !n.endsWith('.json'))[0])

afterEach(() => {
  captured.joinedChannels.length = 0
  captured.startFails = false
  vi.useRealTimers()
})

describe('CallRecorder across voice channels', () => {
  it("joins the allowlisted channel the call's event uses, and posts the notice there only", async () => {
    const w = world({ allowed: [LATAM] })
    w.members.set(LATAM, ['u1'])
    await w.rec.checkSchedule([ev()])
    expect(captured.joinedChannels).toEqual([LATAM])
    expect(w.sends.map((s) => s.channel)).toEqual([LATAM])
    expect(w.rec.status()).not.toBeNull()
  })

  it('never joins a channel that is not allowlisted, even with people in it', async () => {
    const w = world({ allowed: [] })
    w.members.set(LATAM, ['u1'])
    await w.rec.checkSchedule([ev()])
    expect(captured.joinedChannels).toEqual([])
    expect(w.rec.status()).toBeNull()
  })

  it('the default channel still works with no settings', async () => {
    const w = world(undefined)
    w.members.set(DEFAULT, ['u1'])
    await w.rec.checkSchedule([ev({ channelId: DEFAULT })])
    expect(captured.joinedChannels).toEqual([DEFAULT])
  })

  it('an event with no channel uses the crew mapping; unmapped, it is ignored', async () => {
    const w = world({ allowed: [LATAM], byEvent: [{ eventId: '100000000000000001', channelId: LATAM }] })
    w.members.set(LATAM, ['u1'])
    await w.rec.checkSchedule([ev({ id: '100000000000000009', channelId: null })])
    expect(captured.joinedChannels).toEqual([])
    await w.rec.checkSchedule([ev({ channelId: null })])
    expect(captured.joinedChannels).toEqual([LATAM])
  })

  it("people in another channel do not start a call whose channel is empty", async () => {
    const w = world({ allowed: [LATAM] })
    w.members.set(DEFAULT, ['u1', 'u2'])
    await w.rec.checkSchedule([ev()])
    expect(captured.joinedChannels).toEqual([])
  })

  it('records presence from the session channel only', async () => {
    const w = world({ allowed: [LATAM] })
    w.members.set(LATAM, ['latam1', 'latam2'])
    w.members.set(DEFAULT, ['other'])
    await w.rec.checkSchedule([ev()])
    const rows = readManifest(sessionDir(w.dataDir))
    const presence = rows.filter((r) => r.t === 'presence') as Array<{ userIds: string[] }>
    expect(presence[0].userIds).toEqual(['latam1', 'latam2'])
    expect(JSON.stringify(rows)).not.toContain('other')
  })

  it('welcomes only people joining the session channel', async () => {
    vi.useFakeTimers()
    const w = world({ allowed: [LATAM] }, true)
    w.members.set(LATAM, ['u1'])
    await w.rec.checkSchedule([ev()])
    const before = w.sends.length
    w.rec.onVoiceState({ id: 'x', channelId: null } as never, { id: 'x', channelId: DEFAULT, channel: w.channelOf(DEFAULT) } as never)
    w.rec.onVoiceState({ id: 'y', channelId: null } as never, { id: 'y', channelId: LATAM, channel: w.channelOf(LATAM) } as never)
    await vi.advanceTimersByTimeAsync(60_000)
    const welcomes = w.sends.slice(before)
    expect(welcomes).toHaveLength(1)
    expect(welcomes[0].channel).toBe(LATAM)
    expect(welcomes[0].content).toContain('<@y>')
  })

  it('overlapping calls in different channels: keeps the running one, skips and logs the other once', async () => {
    const w = world({ allowed: [LATAM] })
    w.members.set(DEFAULT, ['a'])
    w.members.set(LATAM, ['b'])
    const defaultCall = ev({ id: '100000000000000002', channelId: DEFAULT, name: 'Community Call' })
    const latamCall = ev()
    await w.rec.checkSchedule([defaultCall, latamCall])
    expect(captured.joinedChannels).toHaveLength(1)
    const first = captured.joinedChannels[0]
    await w.rec.checkSchedule([defaultCall, latamCall])
    await w.rec.checkSchedule([defaultCall, latamCall])
    expect(captured.joinedChannels).toEqual([first])
    const skipped = w.logs.filter((l) => l.startsWith('skipping'))
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toContain('one recording at a time')
  })

  it('watches recordable channels and the one being recorded', async () => {
    const w = world({ allowed: [LATAM] })
    expect(w.rec.isWatchedChannel(LATAM)).toBe(true)
    expect(w.rec.isWatchedChannel(DEFAULT)).toBe(true)
    expect(w.rec.isWatchedChannel(OTHER)).toBe(false)
    expect(w.rec.isWatchedChannel(null)).toBe(false)
  })
})

describe('choosing among busy channels when idle', () => {
  const latamCall = (over: Partial<EventInfo> = {}) => ev(over)
  const defCall = (over: Partial<EventInfo> = {}) => ev({ id: '100000000000000002', name: 'Community Call', channelId: DEFAULT, ...over })

  it('a restart mid-Community-Call resumes the default channel even when another channel is busier', async () => {
    const w = world({ allowed: [LATAM] })
    w.members.set(DEFAULT, ['a'])
    w.members.set(LATAM, ['b', 'c', 'd'])
    await w.rec.checkSchedule([latamCall(), defCall({ scheduledStartMs: Date.now() - 600_000 })])
    expect(captured.joinedChannels).toEqual([DEFAULT])
  })

  it('without the default channel busy, the channel with the most people wins, then the earliest call', async () => {
    const w = world({ allowed: [LATAM, OTHER] })
    w.members.set(LATAM, ['b'])
    w.members.set(OTHER, ['c', 'd'])
    await w.rec.checkSchedule([latamCall(), ev({ id: '100000000000000003', channelId: OTHER })])
    expect(captured.joinedChannels).toEqual([OTHER])

    captured.joinedChannels.length = 0
    const t = world({ allowed: [LATAM, OTHER] })
    t.members.set(LATAM, ['b'])
    t.members.set(OTHER, ['c'])
    const now = Date.now()
    await t.rec.checkSchedule([ev({ id: '100000000000000003', channelId: OTHER, scheduledStartMs: now - 60_000 }), latamCall({ scheduledStartMs: now - 300_000 })])
    expect(captured.joinedChannels).toEqual([LATAM])
  })
})

describe('allowlist changes mid-call', () => {
  it("stops the recording on the next schedule check when its channel is removed", async () => {
    const w = world({ allowed: [LATAM] })
    w.members.set(LATAM, ['u1'])
    await w.rec.checkSchedule([ev()])
    expect(w.rec.status()).not.toBeNull()
    w.setVoiceChannels({ allowed: [] })
    await w.rec.checkSchedule([ev()])
    expect(w.rec.status()).toBeNull()
    expect(w.logs.some((l) => l.includes('stopping') && l.includes('channel-disallowed'))).toBe(true)
  })
})

describe('back-off and overlap bookkeeping', () => {
  it('back-off survives a momentarily empty channel', async () => {
    const w = world({ allowed: [LATAM] })
    w.members.set(LATAM, ['u1'])
    captured.startFails = true
    const call = ev()
    await w.rec.checkSchedule([call])
    expect(captured.joinedChannels).toHaveLength(1)
    w.members.set(LATAM, [])
    await w.rec.checkSchedule([call])
    w.members.set(LATAM, ['u1'])
    await w.rec.checkSchedule([call])
    expect(captured.joinedChannels).toHaveLength(1) // still backed off, not retried at once
  })

  it('does not log an overlap for a call whose channel is empty', async () => {
    const w = world({ allowed: [LATAM] })
    w.members.set(DEFAULT, ['a'])
    await w.rec.checkSchedule([ev({ id: '100000000000000002', channelId: DEFAULT }), ev()])
    expect(captured.joinedChannels).toEqual([DEFAULT])
    expect(w.logs.filter((l) => l.startsWith('skipping'))).toHaveLength(0)
  })
})

describe('call limits per channel', () => {
  it("a spent capped call in one channel does not block calls in another", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'limits-'))
    const l = new CallLimits(path.join(dir, 'l.json'), () => {})
    const now = Date.now()
    l.noteStart('cap', { baseMs: now - 3_600_000, limitMs: 1_800_000, startMs: now - 3_600_000, channelId: DEFAULT })
    expect(l.blocks({ id: 'cap', scheduledStartMs: now - 3_600_000, channelId: DEFAULT }, now)).toBe(true)
    expect(l.blocks({ id: 'later', scheduledStartMs: now + 600_000, channelId: DEFAULT }, now)).toBe(true)
    expect(l.blocks({ id: 'later', scheduledStartMs: now + 600_000, channelId: LATAM }, now)).toBe(false)
    l.noteChannelEmpty(now, LATAM) // another channel emptying does not release it
    expect(l.blocks({ id: 'later', scheduledStartMs: now + 600_000, channelId: DEFAULT }, now)).toBe(true)
    l.noteChannelEmpty(now, DEFAULT)
    expect(l.blocks({ id: 'later', scheduledStartMs: now + 600_000, channelId: DEFAULT }, now)).toBe(false)
  })
})

describe('remote config keeps the mapping when the app omits it', () => {
  it('uses the previous byEvent when the field is absent, and replaces it when present (even empty)', () => {
    const prev = parseRemoteConfig({ voiceChannels: { allowed: [LATAM], byEvent: [{ eventId: '7', channelId: LATAM }] } })
    expect(parseRemoteConfig({ voiceChannels: { allowed: [LATAM] } }, prev).voiceChannels.byEvent).toEqual([{ eventId: '7', channelId: LATAM }])
    expect(parseRemoteConfig({ voiceChannels: { allowed: [LATAM], byEvent: [] } }, prev).voiceChannels.byEvent).toEqual([])
  })
})
