import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventInfo } from './event-lifecycle.js'
import { EventStatus } from './event-lifecycle.js'
import type { Config } from './config.js'

const BOT = 'Metalhead'
const REC_NICKNAME = 'Metalhead 🔴 REC'

const { calls, captureState, finalizeSession, fatal } = vi.hoisted(() => ({
  calls: [] as string[],
  captureState: { startFails: false, stopThrows: false },
  finalizeSession: vi.fn(async () => 'uploaded' as const),
  fatal: { fn: (_r: string) => {} },
}))

vi.mock('./capture.js', () => ({
  VoiceCapture: class {
    stats = new Map()
    degraded = false
    decryptFailures = 0
    rejoins = 0
    speakingNow: string[] = []
    constructor(readonly deps: { onFatal: (r: string) => void }) {
      fatal.fn = deps.onFatal
    }
    async start() {
      calls.push('join')
      if (captureState.startFails) throw new Error('cannot join')
    }
    beginCapture() {
      calls.push('begin')
    }
    async stop() {
      calls.push('capture.stop')
      if (captureState.stopThrows) throw new Error('stop boom')
    }
  },
}))
vi.mock('./finalize.js', async (orig) => ({ ...(await orig<typeof import('./finalize.js')>()), finalizeSession }))

import { CallRecorder } from './recorder.js'
import { NicknameManager, recNickname, stripRecMark } from './nickname.js'
import { consentNotice, lateJoinReminder } from './consent.js'
import { chatMessages, readManifest } from './manifest.js'

const CHANNEL = '823956905739026442'
const ev = (over: Partial<EventInfo> = {}): EventInfo => ({
  id: '100',
  name: 'Community Call',
  channelId: CHANNEL,
  status: EventStatus.Active,
  scheduledStartMs: Date.now(),
  ...over,
})

function world(opts: { nickFails?: boolean; sendFails?: boolean; dataDir?: string } = {}) {
  const dataDir = opts.dataDir ?? mkdtempSync(path.join(os.tmpdir(), 'orch-'))
  const nicknames: Array<string | null> = []
  const me = {
    nickname: BOT as string | null,
    setNickname: vi.fn(async (n: string | null) => {
      if (opts.nickFails && n === REC_NICKNAME) throw new Error('Missing Permissions')
      calls.push(`nick:${n}`)
      nicknames.push(n)
      me.nickname = n
    }),
  }
  const channel = {
    id: CHANNEL,
    isVoiceBased: () => true,
    send: vi.fn(async () => {
      calls.push('notice')
      if (opts.sendFails) throw new Error('Missing Access')
    }),
  }
  const guild = {
    id: 'g1',
    members: { fetchMe: async () => me, fetch: async () => ({ displayName: 'x' }) },
    channels: { fetch: async () => channel },
    voiceStates: { cache: { filter: () => ({ map: () => [] }) } },
  }
  const client = { guilds: { fetch: async () => guild }, users: { fetch: async () => ({ bot: false }) } }
  const cfg = { dataDir, guildId: 'g1', callChannelId: CHANNEL, maxCallMinutes: 120, emptyGraceMinutes: 5 } as Config
  const nick = new NicknameManager(dataDir, () => {}, async () => {})
  const serialJobs: Array<() => Promise<void>> = []
  const rec = new CallRecorder(
    client as never,
    cfg,
    nick,
    { appBaseUrl: 'x', apiKey: 'k', uploader: {} as never, log: () => {} },
    () => {},
    (fn) => void serialJobs.push(fn),
  )
  return { rec, dataDir, me, nicknames, channel, guild, serialJobs }
}

beforeEach(() => {
  calls.length = 0
  captureState.startFails = false
  captureState.stopThrows = false
  finalizeSession.mockClear()
})

const withHumans = (w: { guild: { voiceStates: { cache: { filter: unknown } } } }, n: number) => {
  w.guild.voiceStates.cache.filter = () => ({ map: () => Array.from({ length: n }, (_, i) => `u${i}`) })
}
/** Start a recording the way production does: humans present during the event's window. */
const begin = (w: ReturnType<typeof world>, e: EventInfo = ev()) => {
  withHumans(w, 1)
  return w.rec.checkSchedule([{ ...e, status: EventStatus.Scheduled }])
}

const sessionDirs = (dataDir: string) => (existsSync(dataDir) ? require_readdir(dataDir) : [])
import { readdirSync } from 'node:fs'
const require_readdir = (d: string) => readdirSync(d).filter((n) => !n.endsWith('.json'))

describe('CallRecorder indicator rule', () => {
  it('orders join -> nickname -> notice -> capture', async () => {
    const w = world()
    await begin(w)
    expect(calls).toEqual(['join', `nick:${REC_NICKNAME}`, 'notice', 'begin'])
    expect(w.rec.currentEventId).toBe('100')
  })

  it('captures when only the notice worked, or only the nickname worked', async () => {
    const a = world({ nickFails: true })
    await begin(a)
    expect(calls).toContain('begin')
    calls.length = 0
    const b = world({ sendFails: true })
    await begin(b)
    expect(calls).toContain('begin')
  })

  it('never captures, and deletes the session dir, when neither indicator can be shown', async () => {
    const w = world({ nickFails: true, sendFails: true })
    await begin(w)
    expect(calls).not.toContain('begin')
    expect(calls).toContain('capture.stop') // left the channel
    expect(w.rec.currentEventId).toBeNull()
    expect(sessionDirs(w.dataDir)).toEqual([])
    expect(finalizeSession).not.toHaveBeenCalled()
  })

  it('does not capture when joining fails, and leaves nothing behind', async () => {
    captureState.startFails = true
    const w = world()
    await begin(w)
    expect(calls).not.toContain('begin')
    expect(sessionDirs(w.dataDir)).toEqual([])
  })

  it('marks the dir as starting before anything else, so recovery skips it', async () => {
    const w = world()
    await begin(w)
    const dir = path.join(w.dataDir, sessionDirs(w.dataDir)[0])
    expect(existsSync(path.join(dir, 'starting'))).toBe(true)
    w.rec.recoverPending()
    await w.rec.drain()
    expect(finalizeSession).not.toHaveBeenCalled()
  })

  it('a shutdown during start aborts without capturing', async () => {
    const w = world()
    const started = begin(w)
    const down = w.rec.shutdown()
    await Promise.all([started, down])
    expect(calls).not.toContain('begin')
    expect(sessionDirs(w.dataDir)).toEqual([])
  })
})

describe('CallRecorder stop paths', () => {
  it('stops: restores the nickname, clears the marker and queues finalize', async () => {
    const w = world()
    await begin(w)
    await w.rec.stop('empty')
    await w.rec.drain()
    expect(w.nicknames).toEqual([REC_NICKNAME, BOT])
    expect(w.rec.currentEventId).toBeNull()
    expect(finalizeSession).toHaveBeenCalledTimes(1)
    const dir = path.join(w.dataDir, sessionDirs(w.dataDir)[0])
    expect(existsSync(path.join(dir, 'starting'))).toBe(false)
    expect(JSON.parse(readFileSync(path.join(dir, 'session.json'), 'utf8')).endReason).toBe('empty')
  })

  it('still clears the session, restores the nickname and finalizes when capture.stop throws', async () => {
    const w = world()
    await begin(w)
    captureState.stopThrows = true
    await w.rec.stop('empty')
    await w.rec.drain()
    expect(w.rec.currentEventId).toBeNull()
    expect(w.nicknames.at(-1)).toBe(BOT)
    expect(finalizeSession).toHaveBeenCalledTimes(1)
    const dir = path.join(w.dataDir, sessionDirs(w.dataDir)[0])
    expect(JSON.parse(readFileSync(path.join(dir, 'session.json'), 'utf8')).partial).toBe(true)
  })

  it('clears the starting marker even when the session record cannot be written', async () => {
    const w = world()
    await begin(w)
    const dir = path.join(w.dataDir, sessionDirs(w.dataDir)[0])
    rmSync(path.join(dir, 'session.json'))
    mkdirSync(path.join(dir, 'session.json')) // writing session.json now fails
    await w.rec.stop('empty')
    expect(existsSync(path.join(dir, 'starting'))).toBe(false)
    expect(w.rec.currentEventId).toBeNull()
    expect(w.nicknames.at(-1)).toBe(BOT)
  })

  it('shutdown with a throwing capture still restores the nickname and leaves the session for the next boot', async () => {
    const w = world()
    await begin(w)
    captureState.stopThrows = true
    await w.rec.shutdown()
    expect(w.rec.currentEventId).toBeNull()
    expect(w.nicknames.at(-1)).toBe(BOT)
    const dir = path.join(w.dataDir, sessionDirs(w.dataDir)[0])
    expect(existsSync(path.join(dir, 'starting'))).toBe(false)
    expect(JSON.parse(readFileSync(path.join(dir, 'session.json'), 'utf8')).endReason).toBe('shutdown')
    expect(finalizeSession).not.toHaveBeenCalled()
  })

  it('finalizes without contacting any opt-out endpoint, even for a previously opted-out member', async () => {
    const w = world()
    await begin(w)
    await w.rec.stop('empty')
    await w.rec.drain()
    expect(finalizeSession).toHaveBeenCalledTimes(1)
  })

  it('routes a fatal capture error through the serial chain', async () => {
    const w = world()
    await begin(w)
    fatal.fn('disconnected')
    expect(w.rec.currentEventId).toBe('100') // not stopped inline
    expect(w.serialJobs).toHaveLength(1)
    await w.serialJobs[0]()
    expect(w.rec.currentEventId).toBeNull()
  })
})

describe('NicknameManager', () => {
  const guildWith = (me: { nickname: string | null; setNickname: (n: string | null) => Promise<unknown> }) =>
    ({ id: 'g1', members: { fetchMe: async () => me } }) as never

  it('retries the restore with backoff and keeps the saved nickname until it succeeds', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nick-'))
    let fails = 2
    const me = {
      nickname: BOT as string | null,
      setNickname: vi.fn(async (n: string | null) => {
        if (n !== REC_NICKNAME && fails-- > 0) throw new Error('rate limited')
        me.nickname = n
      }),
    }
    const sleeps: number[] = []
    const nm = new NicknameManager(dir, () => {}, async (ms) => void sleeps.push(ms))
    await nm.acquire(guildWith(me))
    expect(await nm.release(guildWith(me))).toBe(true)
    expect(me.nickname).toBe(BOT)
    expect(sleeps).toHaveLength(2)
    expect(existsSync(path.join(dir, 'nickname-restore.json'))).toBe(false)
  })

  it('keeps the saved nickname on the volume when every attempt fails, and finishes on the next boot', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nick-'))
    let broken = true
    const me = {
      nickname: BOT as string | null,
      setNickname: vi.fn(async (n: string | null) => {
        if (n !== REC_NICKNAME && broken) throw new Error('down')
        me.nickname = n
      }),
    }
    const nm = new NicknameManager(dir, () => {}, async () => {})
    await nm.acquire(guildWith(me))
    expect(await nm.release(guildWith(me))).toBe(false)
    expect(JSON.parse(readFileSync(path.join(dir, 'nickname-restore.json'), 'utf8')).nickname).toBe(BOT)
    broken = false
    await new NicknameManager(dir, () => {}, async () => {}).recoverOnBoot(guildWith(me))
    expect(me.nickname).toBe(BOT)
  })

  it('on boot removes the leftover REC mark even with no saved file', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nick-'))
    const me = { nickname: REC_NICKNAME as string | null, setNickname: vi.fn(async (n: string | null) => void (me.nickname = n)) }
    await new NicknameManager(dir, () => {}, async () => {}).recoverOnBoot(guildWith(me))
    expect(me.nickname).toBe('Metalhead')
  })

  it('keeps the bot name, appends the REC mark, and restores exactly', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nick-'))
    const me = { nickname: 'Metalhead' as string | null, setNickname: vi.fn(async (n: string | null) => void (me.nickname = n)) }
    const nm = new NicknameManager(dir, () => {}, async () => {})
    await nm.acquire(guildWith(me))
    expect(me.nickname).toBe('Metalhead 🔴 REC')
    await nm.release(guildWith(me))
    expect(me.nickname).toBe('Metalhead')
  })

  it('falls back to the global name, then the username, and restores to no nickname', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nick-'))
    const me = { nickname: null as string | null, user: { globalName: 'PizzaBot', username: 'pizzabot' }, setNickname: vi.fn(async (n: string | null) => void (me.nickname = n)) }
    const nm = new NicknameManager(dir, () => {}, async () => {})
    await nm.acquire(guildWith(me))
    expect(me.nickname).toBe('PizzaBot 🔴 REC')
    await nm.release(guildWith(me))
    expect(me.nickname).toBeNull()
    const me2 = { nickname: null as string | null, user: { globalName: null, username: 'pizzabot' }, setNickname: vi.fn(async (n: string | null) => void (me2.nickname = n)) }
    await new NicknameManager(mkdtempSync(path.join(os.tmpdir(), 'nick-')), () => {}, async () => {}).acquire(guildWith(me2))
    expect(me2.nickname).toBe('pizzabot 🔴 REC')
  })

  it('never doubles the mark and never exceeds 32 characters (the base is truncated, not the mark)', () => {
    expect(recNickname('Metalhead 🔴 REC')).toBe('Metalhead 🔴 REC')
    const long = recNickname('A'.repeat(60))
    expect(long.length).toBeLessThanOrEqual(32)
    expect(long.endsWith(' 🔴 REC')).toBe(true)
    expect(long.startsWith('AAAA')).toBe(true)
    expect(stripRecMark('Metalhead 🔴 REC')).toBe('Metalhead')
  })

  it('never saves the REC mark in the "previous" nickname', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nick-'))
    const me = { nickname: REC_NICKNAME as string | null, setNickname: vi.fn(async () => undefined) }
    await new NicknameManager(dir, () => {}, async () => {}).acquire(guildWith(me))
    expect(JSON.parse(readFileSync(path.join(dir, 'nickname-restore.json'), 'utf8')).nickname).toBe('Metalhead')
  })
})

describe('consent text', () => {
  it('says the call is recorded and transcribed and never mentions opt-out', () => {
    for (const t of [consentNotice(), lateJoinReminder('1')]) {
      expect(t).toMatch(/recorded and transcribed/)
      expect(t).not.toMatch(/opt|\/record/i)
    }
  })
})

void mkdirSync
void writeFileSync

describe('CallRecorder schedule-window trigger', () => {
  const T = Date.parse('2026-10-20T18:15:00Z') // Creative Crew start
  const MIN = 60_000
  const at = (min: number) => vi.setSystemTime(T + min * MIN)
  const sched = (id: string, startMin: number, over: Partial<EventInfo> = {}): EventInfo =>
    ev({ id, name: id, status: EventStatus.Scheduled, scheduledStartMs: T + startMin * MIN, ...over })
  // Music 17:30, Creative 18:15, Art 18:30, Merch 19:30, Real Estate 20:00
  const day = () => [sched('music', -45), sched('creative', 0), sched('art', 15), sched('merch', 75), sched('re', 105)]
  const joins = () => calls.filter((c) => c === 'join').length

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts for a SCHEDULED event when humans are present, and not when the channel is empty', async () => {
    const w = world()
    at(0)
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBeNull()
    withHumans(w, 2)
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBe('creative')
    await w.rec.checkSchedule(day())
    expect(joins()).toBe(1)
  })

  it('does not record humans when no event window covers now', async () => {
    const w = world()
    withHumans(w, 2)
    at(-300)
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBeNull()
  })

  it('idle at 18:15, Art set ACTIVE, Creative crew joins 18:16: records Creative; one switch to Art at 18:30', async () => {
    const w = world()
    const events = () => day().map((e) => (e.id === 'art' ? { ...e, status: EventStatus.Active } : e))
    at(0)
    await w.rec.checkSchedule(events()) // nobody yet
    expect(w.rec.currentEventId).toBeNull()
    withHumans(w, 3)
    at(1)
    await w.rec.checkSchedule(events())
    expect(w.rec.currentEventId).toBe('creative')
    for (let m = 1; m < 30; m++) {
      at(m)
      await w.rec.checkSchedule(events())
      expect(w.rec.currentEventId).toBe(m < 15 ? 'creative' : 'art')
    }
    expect(joins()).toBe(2)
    // Creative flagged ACTIVE late: nothing changes
    at(25)
    await w.rec.checkSchedule(day().map((e) => (e.id === 'creative' ? { ...e, status: EventStatus.Active } : e)))
    expect(w.rec.currentEventId).toBe('art')
    expect(joins()).toBe(2)
  })

  it('a 20:00 event set ACTIVE at 17:00 with nobody present records nothing; people at 17:30 get Music', async () => {
    const w = world()
    const events = day().map((e) => (e.id === 're' ? { ...e, status: EventStatus.Active } : e))
    at(-75) // 17:00
    await w.rec.checkSchedule(events)
    expect(w.rec.currentEventId).toBeNull()
    withHumans(w, 2)
    at(-45) // 17:30
    await w.rec.checkSchedule(events)
    expect(w.rec.currentEventId).toBe('music')
  })

  it('an idle start at 18:12 records the running Music slot (no Creative flip), then moves forward at 18:15', async () => {
    const w = world()
    withHumans(w, 2)
    at(-3) // 18:12: Music's slot is running, Creative is only upcoming -> Music directly
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBe('music')
    at(-2)
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBe('music')
    expect(joins()).toBe(1)
    at(0)
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBe('creative')
  })

  it('a lead-window drop-in stopped empty does not block the real call', async () => {
    const w = world()
    withHumans(w, 2)
    at(75 - 14)
    await w.rec.checkSchedule([sched('merch', 75)])
    expect(w.rec.currentEventId).toBe('merch')
    at(75 - 7)
    await w.rec.stop('empty')
    at(75)
    await w.rec.checkSchedule([sched('merch', 75)])
    expect(w.rec.currentEventId).toBe('merch')
  })

  it('a mid-call empty stop after audio was captured restarts as a new session when people return', async () => {
    const w = world()
    withHumans(w, 2)
    at(75)
    await w.rec.checkSchedule(day())
    ;(w.rec as unknown as { current: { capture: { stats: Map<string, unknown> } } }).current.capture.stats.set('u1', {})
    at(95)
    await w.rec.stop('empty')
    at(85)
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBe('merch')
    expect(joins()).toBe(2)
  })

  it('Real Estate: no new session long after the call, but a restart after a short empty stop', async () => {
    const w = world()
    withHumans(w, 2)
    at(105)
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBe('re')
    at(105 + 40)
    await w.rec.stop('empty') // 20:40 short empty stop
    at(105 + 45) // 20:45 people return
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBe('re')
    at(105 + 60)
    await w.rec.stop('empty') // 21:00
    at(105 + 105) // 21:45
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBeNull()
  })

  it('a running session is not cut by its window closing', async () => {
    const w = world()
    withHumans(w, 2)
    at(105)
    await w.rec.checkSchedule(day())
    at(105 + 100) // past start + 90 min
    await w.rec.checkSchedule(day())
    const tick = () => (w.rec as unknown as { onTick(): Promise<void> }).onTick()
    await tick()
    expect(w.rec.currentEventId).toBe('re')
  })

  it('max duration counts from the scheduled start when the session began early', async () => {
    const w = world()
    withHumans(w, 2)
    at(-10)
    await w.rec.checkSchedule([sched('creative', 0)])
    const tick = () => (w.rec as unknown as { onTick(): Promise<void> }).onTick()
    at(110)
    await tick()
    expect(w.rec.currentEventId).toBe('creative')
    at(120)
    await tick()
    expect(w.rec.currentEventId).toBeNull()
  })

  it('COMPLETED / CANCELED never cuts a call: Creative completed at 18:15 keeps recording, Art takes over at 18:30', async () => {
    const w = world()
    withHumans(w, 3)
    const events = (done: boolean) =>
      day().map((e) => (e.id === 'creative' && done ? { ...e, status: EventStatus.Completed } : e))
    at(-2)
    await w.rec.checkSchedule(events(false))
    expect(w.rec.currentEventId).toBe('music') // Music's slot is still running at 18:13
    at(0)
    await w.rec.checkSchedule(events(false))
    expect(w.rec.currentEventId).toBe('creative')
    for (let m = 0; m < 30; m++) {
      at(m)
      await w.rec.checkSchedule(events(true))
      expect(w.rec.currentEventId).toBe(m < 15 ? 'creative' : 'art')
    }
  })

  it('an idle bot does not start for a COMPLETED or CANCELED event', async () => {
    const w = world()
    withHumans(w, 3)
    at(1)
    await w.rec.checkSchedule([sched('creative', 0, { status: EventStatus.Canceled })])
    expect(w.rec.currentEventId).toBeNull()
  })

  it('late manual Start at 19:50 for an 18:15 event records; a restart 100 min into an ACTIVE call resumes it', async () => {
    const w = world()
    withHumans(w, 3)
    const active = [sched('creative', 0, { status: EventStatus.Active })]
    at(95) // 19:50
    await w.rec.checkSchedule(active)
    expect(w.rec.currentEventId).toBe('creative')
    await w.rec.stop('shutdown')
    at(100)
    await w.rec.checkSchedule(active)
    expect(w.rec.currentEventId).toBe('creative')
    expect(joins()).toBe(2)
  })

  it('a 20:00 event set ACTIVE at 17:00 is ignored even with people present', async () => {
    const w = world()
    withHumans(w, 3)
    at(-75)
    await w.rec.checkSchedule([sched('re', 105, { status: EventStatus.Active })])
    expect(w.rec.currentEventId).toBeNull()
  })

  describe('failure back-off', () => {
    it('repeated aborted starts: at most 3 attempts, spaced at least 5 minutes', async () => {
      captureState.startFails = true
      const w = world()
      withHumans(w, 2)
      const attempts: number[] = []
      for (let m = 0; m <= 60; m++) {
        at(m)
        const before = joins()
        await w.rec.checkSchedule([sched('creative', 0)])
        if (joins() > before) attempts.push(m)
      }
      expect(attempts.length).toBe(3)
      for (let i = 1; i < attempts.length; i++) expect(attempts[i] - attempts[i - 1]).toBeGreaterThanOrEqual(5)
    })

    it('no duplicate consent notices within the back-off when no indicator can be shown', async () => {
      const w = world({ nickFails: true, sendFails: true })
      withHumans(w, 2)
      for (let m = 0; m <= 4; m++) {
        at(m)
        await w.rec.checkSchedule([sched('creative', 0)])
      }
      expect(w.channel.send).toHaveBeenCalledTimes(1)
      for (let m = 5; m <= 60; m++) {
        at(m)
        await w.rec.checkSchedule([sched('creative', 0)])
      }
      expect(w.channel.send).toHaveBeenCalledTimes(3)
    })

    it('a fatal error mid-call retries once after 5 minutes, not every minute', async () => {
      const w = world()
      withHumans(w, 2)
      at(0)
      await w.rec.checkSchedule([sched('creative', 0)])
      expect(joins()).toBe(1)
      at(1)
      fatal.fn('disconnected')
      await w.serialJobs[0]()
      expect(w.rec.currentEventId).toBeNull()
      const retryAt: number[] = []
      for (let m = 2; m <= 8; m++) {
        at(m)
        const before = joins()
        await w.rec.checkSchedule([sched('creative', 0)])
        if (joins() > before) retryAt.push(m)
      }
      expect(retryAt).toEqual([6])
    })

    it('three blips spread over a long call, each followed by a recovery, never give up', async () => {
      const w = world()
      withHumans(w, 2)
      const one = [sched('creative', 0)]
      at(0)
      await w.rec.checkSchedule(one)
      for (const m of [20, 45, 70]) {
        at(m)
        fatal.fn('disconnected')
        await w.serialJobs.pop()!()
        expect(w.rec.currentEventId).toBeNull()
        at(m + 5)
        await w.rec.checkSchedule(one)
        expect(w.rec.currentEventId).toBe('creative')
      }
      expect(joins()).toBe(4)
    })

    it('the same event id next week is not blocked by this week\'s failures', async () => {
      captureState.startFails = true
      const w = world()
      withHumans(w, 2)
      for (let m = 0; m <= 30; m++) {
        at(m)
        await w.rec.checkSchedule([sched('creative', 0)])
      }
      expect(joins()).toBe(3)
      captureState.startFails = false
      const week = 7 * 24 * 60
      at(week + 1)
      await w.rec.checkSchedule([sched('creative', week)])
      expect(w.rec.currentEventId).toBe('creative')
    })

    it('normal empty stops are not subject to the back-off', async () => {
      const w = world()
      withHumans(w, 2)
      at(0)
      await w.rec.checkSchedule([sched('creative', 0)])
      await w.rec.stop('empty')
      at(1)
      await w.rec.checkSchedule([sched('creative', 0)])
      expect(w.rec.currentEventId).toBe('creative')
    })
  })
})

describe('CallRecorder slot memory', () => {
  const OPS = '1392145084845264977'
  const OPS_START = Date.parse('2026-10-26T18:00:00Z')
  const WEEK = 7 * 86_400_000
  const at = (iso: string) => vi.setSystemTime(Date.parse(iso))
  const ops = (over: Partial<EventInfo> = {}): EventInfo =>
    ev({ id: OPS, name: 'Ops Crew', status: EventStatus.Scheduled, scheduledStartMs: OPS_START, ...over })
  const joins = () => calls.filter((c) => c === 'join').length

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('records the remembered slot after Discord moves the recurring event to next week', async () => {
    const w = world()
    at('2026-10-26T17:50:00Z')
    await w.rec.checkSchedule([ops()])
    expect(existsSync(path.join(w.dataDir, 'slots.json'))).toBe(true)
    at('2026-10-26T18:07:00Z')
    withHumans(w, 1)
    await w.rec.checkSchedule([])
    expect(w.rec.currentEventId).toBe(OPS)
    expect(w.rec.status()?.eventName).toBe('Ops Crew')
  })

  it('records when the live event shows next week and is completed', async () => {
    const w = world()
    at('2026-10-26T17:50:00Z')
    await w.rec.checkSchedule([ops()])
    at('2026-10-26T18:07:00Z')
    withHumans(w, 1)
    await w.rec.checkSchedule([ops({ status: EventStatus.Completed, scheduledStartMs: OPS_START + WEEK })])
    expect(w.rec.currentEventId).toBe(OPS)
  })

  it('derives the previous occurrence after a restart with an empty memory', async () => {
    const w = world()
    at('2026-10-26T18:10:00Z')
    withHumans(w, 1)
    await w.rec.checkSchedule([ops({ scheduledStartMs: OPS_START + WEEK, recurrenceIntervalMs: WEEK })])
    expect(w.rec.currentEventId).toBe(OPS)
  })

  it('does not derive without a (simple) recurrence rule', async () => {
    const w = world()
    at('2026-10-26T18:10:00Z')
    withHumans(w, 1)
    await w.rec.checkSchedule([ops({ scheduledStartMs: OPS_START + WEEK })])
    expect(w.rec.currentEventId).toBeNull()
  })

  it('treats a CANCELED occurrence as not happening', async () => {
    const w = world()
    at('2026-10-26T17:50:00Z')
    await w.rec.checkSchedule([ops()])
    at('2026-10-26T18:07:00Z')
    withHumans(w, 1)
    await w.rec.checkSchedule([ops({ status: EventStatus.Canceled })])
    expect(w.rec.currentEventId).toBeNull()
    expect(joins()).toBe(0)
  })

  it('survives a restart through the memory file', async () => {
    const w1 = world()
    at('2026-10-26T17:50:00Z')
    await w1.rec.checkSchedule([ops()])
    const w2 = world({ dataDir: w1.dataDir })
    at('2026-10-26T18:10:00Z')
    withHumans(w2, 1)
    await w2.rec.checkSchedule([])
    expect(w2.rec.currentEventId).toBe(OPS)
  })

  it('does not start twice when the live and remembered copies both exist', async () => {
    const w = world()
    at('2026-10-26T17:50:00Z')
    await w.rec.checkSchedule([ops()])
    at('2026-10-26T18:07:00Z')
    withHumans(w, 1)
    await w.rec.checkSchedule([ops({ status: EventStatus.Active })])
    await w.rec.checkSchedule([ops({ status: EventStatus.Active })])
    await w.rec.checkSchedule([])
    expect(joins()).toBe(1)
  })

  it('prunes slots older than 24h', async () => {
    const w = world()
    at('2026-10-26T17:50:00Z')
    await w.rec.checkSchedule([ops()])
    at('2026-10-27T18:01:00Z')
    await w.rec.checkSchedule([])
    expect(JSON.parse(readFileSync(path.join(w.dataDir, 'slots.json'), 'utf8'))).toEqual([])
  })
})

describe('voice channel chat capture', () => {
  const msg = (over: Record<string, unknown> = {}) => ({
    id: String(Math.floor(Math.random() * 1e12) + 1e11),
    channelId: CHANNEL,
    content: 'hello',
    cleanContent: 'hello',
    createdTimestamp: Date.now() + 1000,
    system: false,
    author: { id: '555555555555555555', bot: false, username: 'ann', globalName: 'Ann G' },
    member: { displayName: 'Ann' },
    attachments: new Map(),
    ...over,
  })
  const started = async () => {
    const w = world()
    await begin(w)
    const dir = path.join(w.dataDir, sessionDirs(w.dataDir)[0]!)
    return { w, dir }
  }
  const chat = (dir: string) => chatMessages(readManifest(dir))

  it('records a message with the author and the time since the session start', async () => {
    const { w, dir } = await started()
    w.rec.onMessage(msg({ id: '700000000000000001' }) as never)
    const [c] = chat(dir)
    expect(c).toMatchObject({ discordId: '555555555555555555', displayName: 'Ann', text: 'hello', messageId: '700000000000000001' })
    expect(c!.atMs).toBeGreaterThan(900)
  })

  it('ignores bots (including the recorder notice), system messages, other channels and messages before the session', async () => {
    const { w, dir } = await started()
    w.rec.onMessage(msg({ author: { id: '1', bot: true, username: 'Metalhead' } }) as never)
    w.rec.onMessage(msg({ system: true }) as never)
    w.rec.onMessage(msg({ channelId: '999' }) as never)
    w.rec.onMessage(msg({ createdTimestamp: Date.now() - 60_000 }) as never)
    expect(chat(dir)).toEqual([])
  })

  it('does nothing when no session is recording, and after stopping', async () => {
    const w = world()
    w.rec.onMessage(msg() as never) // no session: must not throw
    await begin(w)
    const dir = path.join(w.dataDir, sessionDirs(w.dataDir)[0]!)
    await w.rec.stop('manual' as never)
    w.rec.onMessage(msg({ id: '700000000000000009' }) as never)
    expect(chat(dir)).toEqual([])
  })

  it('stores the latest edit and drops deleted messages', async () => {
    const { w, dir } = await started()
    w.rec.onMessage(msg({ id: '700000000000000001', content: 'first', cleanContent: 'first' }) as never)
    w.rec.onMessage(msg({ id: '700000000000000002', content: 'oops', cleanContent: 'oops' }) as never)
    w.rec.onMessageUpdate(msg({ id: '700000000000000001', content: 'edited', cleanContent: 'edited' }) as never)
    w.rec.onMessageUpdate(msg({ id: '700000000000000001', content: null, cleanContent: null }) as never) // partial: ignored
    w.rec.onMessageUpdate(msg({ id: '700000000000000077', content: 'never seen', cleanContent: 'never seen' }) as never) // unknown message
    w.rec.onMessageDelete({ id: '700000000000000002', channelId: CHANNEL } as never)
    expect(chat(dir).map((c) => [c.messageId, c.text])).toEqual([['700000000000000001', 'edited']])
  })

  it('stores attachment URLs as text', async () => {
    const { w, dir } = await started()
    w.rec.onMessage(msg({ content: '', cleanContent: '', attachments: new Map([['a', { url: 'https://cdn.example/x.png' }]]) }) as never)
    expect(chat(dir)[0]!.text).toBe('https://cdn.example/x.png')
  })

  it('skips empty content (MessageContent intent off) and logs only once', async () => {
    const logs: string[] = []
    const w = world()
    ;(w.rec as unknown as { log: (m: string) => void }).log = (m: string) => logs.push(m)
    await begin(w)
    const dir = path.join(w.dataDir, sessionDirs(w.dataDir)[0]!)
    w.rec.onMessage(msg({ content: '', cleanContent: '' }) as never)
    w.rec.onMessage(msg({ content: '', cleanContent: '' }) as never)
    expect(chat(dir)).toEqual([])
    expect(logs.filter((l) => l.includes('MessageContent'))).toHaveLength(1)
  })
})
