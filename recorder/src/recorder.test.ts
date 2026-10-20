import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventInfo } from './event-lifecycle.js'
import { EventStatus } from './event-lifecycle.js'
import { REC_NICKNAME, type Config } from './config.js'

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
    purgeUser() {}
  },
}))
vi.mock('./finalize.js', async (orig) => ({ ...(await orig<typeof import('./finalize.js')>()), finalizeSession }))

import { CallRecorder } from './recorder.js'
import { NicknameManager } from './nickname.js'
import { OptOutCache } from './optouts.js'

const CHANNEL = '823956905739026442'
const ev = (over: Partial<EventInfo> = {}): EventInfo => ({
  id: '100',
  name: 'Community Call',
  channelId: CHANNEL,
  status: EventStatus.Active,
  scheduledStartMs: Date.now(),
  ...over,
})

function world(opts: { nickFails?: boolean; sendFails?: boolean } = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'orch-'))
  const nicknames: Array<string | null> = []
  const me = {
    nickname: 'Pizza Bot' as string | null,
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
  let listOk = true
  const optOuts = new OptOutCache(async () => {
    if (!listOk) throw new Error('app down')
    return []
  })
  const nick = new NicknameManager(dataDir, () => {}, async () => {})
  const serialJobs: Array<() => Promise<void>> = []
  const rec = new CallRecorder(
    client as never,
    cfg,
    optOuts,
    nick,
    { appBaseUrl: 'x', apiKey: 'k', uploader: {} as never, log: () => {} },
    () => {},
    (fn) => void serialJobs.push(fn),
  )
  return { rec, dataDir, me, nicknames, channel, guild, optOuts, setListOk: (v: boolean) => (listOk = v), serialJobs }
}

beforeEach(() => {
  calls.length = 0
  captureState.startFails = false
  captureState.stopThrows = false
  finalizeSession.mockClear()
})

const sessionDirs = (dataDir: string) => (existsSync(dataDir) ? require_readdir(dataDir) : [])
import { readdirSync } from 'node:fs'
const require_readdir = (d: string) => readdirSync(d).filter((n) => !n.endsWith('.json'))

describe('CallRecorder indicator rule', () => {
  it('orders join -> nickname -> notice -> capture', async () => {
    const w = world()
    await w.optOuts.refresh()
    await w.rec.handleEvent(ev())
    expect(calls).toEqual(['join', `nick:${REC_NICKNAME}`, 'notice', 'begin'])
    expect(w.rec.currentEventId).toBe('100')
  })

  it('captures when only the notice worked, or only the nickname worked', async () => {
    const a = world({ nickFails: true })
    await a.rec.handleEvent(ev())
    expect(calls).toContain('begin')
    calls.length = 0
    const b = world({ sendFails: true })
    await b.rec.handleEvent(ev())
    expect(calls).toContain('begin')
  })

  it('never captures, and deletes the session dir, when neither indicator can be shown', async () => {
    const w = world({ nickFails: true, sendFails: true })
    await w.rec.handleEvent(ev())
    expect(calls).not.toContain('begin')
    expect(calls).toContain('capture.stop') // left the channel
    expect(w.rec.currentEventId).toBeNull()
    expect(sessionDirs(w.dataDir)).toEqual([])
    expect(finalizeSession).not.toHaveBeenCalled()
  })

  it('does not capture when joining fails, and leaves nothing behind', async () => {
    captureState.startFails = true
    const w = world()
    await w.rec.handleEvent(ev())
    expect(calls).not.toContain('begin')
    expect(sessionDirs(w.dataDir)).toEqual([])
  })

  it('marks the dir as starting before anything else, so recovery skips it', async () => {
    const w = world()
    await w.optOuts.refresh()
    await w.rec.handleEvent(ev())
    const dir = path.join(w.dataDir, sessionDirs(w.dataDir)[0])
    expect(existsSync(path.join(dir, 'starting'))).toBe(true)
    w.rec.recoverPending()
    await w.rec.drain()
    expect(finalizeSession).not.toHaveBeenCalled()
  })

  it('a shutdown during start aborts without capturing', async () => {
    const w = world()
    const started = w.rec.handleEvent(ev())
    const down = w.rec.shutdown()
    await Promise.all([started, down])
    expect(calls).not.toContain('begin')
    expect(sessionDirs(w.dataDir)).toEqual([])
  })
})

describe('CallRecorder stop paths', () => {
  it('stops: restores the nickname, clears the marker and queues finalize', async () => {
    const w = world()
    await w.optOuts.refresh()
    await w.rec.handleEvent(ev())
    await w.rec.handleEvent(ev({ status: EventStatus.Completed }))
    await w.rec.drain()
    expect(w.nicknames).toEqual([REC_NICKNAME, 'Pizza Bot'])
    expect(w.rec.currentEventId).toBeNull()
    expect(finalizeSession).toHaveBeenCalledTimes(1)
    const dir = path.join(w.dataDir, sessionDirs(w.dataDir)[0])
    expect(existsSync(path.join(dir, 'starting'))).toBe(false)
    expect(JSON.parse(readFileSync(path.join(dir, 'session.json'), 'utf8')).endReason).toBe('event-ended')
  })

  it('still clears the session, restores the nickname and finalizes when capture.stop throws', async () => {
    const w = world()
    await w.optOuts.refresh()
    await w.rec.handleEvent(ev())
    captureState.stopThrows = true
    await w.rec.stop('empty')
    await w.rec.drain()
    expect(w.rec.currentEventId).toBeNull()
    expect(w.nicknames.at(-1)).toBe('Pizza Bot')
    expect(finalizeSession).toHaveBeenCalledTimes(1)
    const dir = path.join(w.dataDir, sessionDirs(w.dataDir)[0])
    expect(JSON.parse(readFileSync(path.join(dir, 'session.json'), 'utf8')).partial).toBe(true)
  })

  it('clears the starting marker even when the session record cannot be written', async () => {
    const w = world()
    await w.optOuts.refresh()
    await w.rec.handleEvent(ev())
    const dir = path.join(w.dataDir, sessionDirs(w.dataDir)[0])
    rmSync(path.join(dir, 'session.json'))
    mkdirSync(path.join(dir, 'session.json')) // writing session.json now fails
    await w.rec.stop('empty')
    expect(existsSync(path.join(dir, 'starting'))).toBe(false)
    expect(w.rec.currentEventId).toBeNull()
    expect(w.nicknames.at(-1)).toBe('Pizza Bot')
  })

  it('shutdown with a throwing capture still restores the nickname and leaves the session for the next boot', async () => {
    const w = world()
    await w.optOuts.refresh()
    await w.rec.handleEvent(ev())
    captureState.stopThrows = true
    await w.rec.shutdown()
    expect(w.rec.currentEventId).toBeNull()
    expect(w.nicknames.at(-1)).toBe('Pizza Bot')
    const dir = path.join(w.dataDir, sessionDirs(w.dataDir)[0])
    expect(existsSync(path.join(dir, 'starting'))).toBe(false)
    expect(JSON.parse(readFileSync(path.join(dir, 'session.json'), 'utf8')).endReason).toBe('shutdown')
    expect(finalizeSession).not.toHaveBeenCalled()
  })

  it('does not upload while the opt-out list is unavailable, and uploads once it is back', async () => {
    const w = world()
    w.setListOk(false) // never loaded
    await w.rec.handleEvent(ev())
    await w.rec.stop('empty')
    await w.rec.drain()
    expect(finalizeSession).not.toHaveBeenCalled()

    w.rec.recoverPending() // the dir is pending (no uploaded marker)
    await w.rec.drain()
    expect(finalizeSession).not.toHaveBeenCalled()

    w.setListOk(true)
    w.rec.recoverPending()
    await w.rec.drain()
    expect(finalizeSession).toHaveBeenCalledTimes(1)
  })

  it('does not upload when the list loaded earlier but is stale at finalize time', async () => {
    const w = world()
    await w.optOuts.refresh() // loaded once
    await w.rec.handleEvent(ev())
    w.setListOk(false)
    await w.rec.stop('empty')
    await w.rec.drain()
    expect(finalizeSession).not.toHaveBeenCalled()
  })

  it('routes a fatal capture error through the serial chain', async () => {
    const w = world()
    await w.optOuts.refresh()
    await w.rec.handleEvent(ev())
    fatal.fn('disconnected')
    expect(w.rec.currentEventId).toBe('100') // not stopped inline
    expect(w.serialJobs).toHaveLength(1)
    await w.serialJobs[0]()
    expect(w.rec.currentEventId).toBeNull()
  })
})

describe('CallRecorder restart rules', () => {
  it('does not restart an event that ended on its own when it is merely edited', async () => {
    const w = world()
    await w.optOuts.refresh()
    await w.rec.handleEvent(ev())
    await w.rec.stop('empty')
    calls.length = 0
    await w.rec.handleEvent(ev(), true, false) // description edit, still ACTIVE
    expect(calls).toEqual([])
    await w.rec.handleEvent(ev(), true, true) // went ACTIVE again
    expect(calls).toContain('begin')
  })

  it('a different event going ACTIVE closes this one and starts the next', async () => {
    const w = world()
    await w.optOuts.refresh()
    await w.rec.handleEvent(ev({ scheduledStartMs: Date.now() - 60_000 }))
    await w.rec.handleEvent(ev({ id: '200', name: 'Ops' }))
    expect(w.rec.currentEventId).toBe('200')
    await w.rec.drain()
    expect(finalizeSession).toHaveBeenCalledTimes(1)
  })
})

describe('NicknameManager', () => {
  const guildWith = (me: { nickname: string | null; setNickname: (n: string | null) => Promise<unknown> }) =>
    ({ id: 'g1', members: { fetchMe: async () => me } }) as never

  it('retries the restore with backoff and keeps the saved nickname until it succeeds', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nick-'))
    let fails = 2
    const me = {
      nickname: 'Pizza Bot' as string | null,
      setNickname: vi.fn(async (n: string | null) => {
        if (n !== REC_NICKNAME && fails-- > 0) throw new Error('rate limited')
        me.nickname = n
      }),
    }
    const sleeps: number[] = []
    const nm = new NicknameManager(dir, () => {}, async (ms) => void sleeps.push(ms))
    await nm.acquire(guildWith(me))
    expect(await nm.release(guildWith(me))).toBe(true)
    expect(me.nickname).toBe('Pizza Bot')
    expect(sleeps).toHaveLength(2)
    expect(existsSync(path.join(dir, 'nickname-restore.json'))).toBe(false)
  })

  it('keeps the saved nickname on the volume when every attempt fails, and finishes on the next boot', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nick-'))
    let broken = true
    const me = {
      nickname: 'Pizza Bot' as string | null,
      setNickname: vi.fn(async (n: string | null) => {
        if (n !== REC_NICKNAME && broken) throw new Error('down')
        me.nickname = n
      }),
    }
    const nm = new NicknameManager(dir, () => {}, async () => {})
    await nm.acquire(guildWith(me))
    expect(await nm.release(guildWith(me))).toBe(false)
    expect(JSON.parse(readFileSync(path.join(dir, 'nickname-restore.json'), 'utf8')).nickname).toBe('Pizza Bot')
    broken = false
    await new NicknameManager(dir, () => {}, async () => {}).recoverOnBoot(guildWith(me))
    expect(me.nickname).toBe('Pizza Bot')
  })

  it('on boot resets a leftover REC nickname even with no saved file', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nick-'))
    const me = { nickname: REC_NICKNAME as string | null, setNickname: vi.fn(async (n: string | null) => void (me.nickname = n)) }
    await new NicknameManager(dir, () => {}, async () => {}).recoverOnBoot(guildWith(me))
    expect(me.nickname).toBeNull()
  })

  it('never saves the REC name as the "previous" nickname', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nick-'))
    const me = { nickname: REC_NICKNAME as string | null, setNickname: vi.fn(async () => undefined) }
    await new NicknameManager(dir, () => {}, async () => {}).acquire(guildWith(me))
    expect(JSON.parse(readFileSync(path.join(dir, 'nickname-restore.json'), 'utf8')).nickname).toBeNull()
  })
})

void mkdirSync
void writeFileSync

describe('CallRecorder schedule-window trigger', () => {
  const MIN = 60_000
  const T = Date.parse('2026-10-20T18:15:00Z') // Creative Crew start
  const at = (min: number) => vi.setSystemTime(T + min * MIN)
  const sched = (id: string, startMin: number, over: Partial<EventInfo> = {}): EventInfo =>
    ev({ id, name: id, status: EventStatus.Scheduled, scheduledStartMs: T + startMin * MIN, ...over })
  const withHumans = (w: ReturnType<typeof world>, n: number) => {
    w.guild.voiceStates.cache.filter = () => ({ map: () => Array.from({ length: n }, (_, i) => `u${i}`) }) as never
  }
  const joins = () => calls.filter((c) => c === 'join').length
  const day = () => [sched('music', -45), sched('creative', 0), sched('art', 15), sched('merch', 75)]

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts for a SCHEDULED event when humans are present, and not when the channel is empty', async () => {
    const w = world()
    await w.optOuts.refresh()
    at(0)
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBeNull()
    withHumans(w, 2)
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBe('creative')
    await w.rec.checkSchedule(day()) // no double start
    expect(joins()).toBe(1)
  })

  it('does not record humans when no event window covers now', async () => {
    const w = world()
    await w.optOuts.refresh()
    withHumans(w, 2)
    at(300)
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBeNull()
  })

  it('Creative recorded from 18:10, Art set ACTIVE at 18:15: exactly one switch, at 18:30, no ping-pong', async () => {
    const w = world()
    await w.optOuts.refresh()
    withHumans(w, 3)
    at(-5)
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBe('creative')
    const art = (status: number) => sched('art', 15, { status })
    at(0)
    await w.rec.handleEvent(art(EventStatus.Active)) // 15 min early: must not cut the call
    expect(w.rec.currentEventId).toBe('creative')
    for (let m = 0; m < 30; m++) {
      at(m)
      await w.rec.checkSchedule(day().map((e) => (e.id === 'art' ? art(EventStatus.Active) : e)))
      await w.rec.handleEvent(art(EventStatus.Active), true, false)
      expect(w.rec.currentEventId).toBe(m < 15 ? 'creative' : 'art')
    }
    expect(joins()).toBe(2) // creative, art
    // Creative flagged ACTIVE late (18:27 scenario): earlier than the current event, ignored
    at(25)
    await w.rec.handleEvent(sched('creative', 0, { status: EventStatus.Active }))
    expect(w.rec.currentEventId).toBe('art')
    expect(joins()).toBe(2)
  })

  it('Creative set ACTIVE late while Art (started idle at 18:27) is recording is ignored', async () => {
    const w = world()
    await w.optOuts.refresh()
    withHumans(w, 3)
    at(12)
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBe('art')
    await w.rec.handleEvent(sched('creative', 0, { status: EventStatus.Active }))
    expect(w.rec.currentEventId).toBe('art')
  })

  it('a lead-window drop-in stopped empty does not block the real call (no audio captured)', async () => {
    const w = world()
    await w.optOuts.refresh()
    withHumans(w, 2)
    at(75 - 14) // 19:16
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBe('merch')
    at(75 - 7) // 19:23
    await w.rec.stop('empty')
    expect(w.rec.currentEventId).toBeNull()
    at(75)
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBe('merch')
  })

  it('a mid-call empty stop after audio was captured restarts as a new session when people return in the window', async () => {
    const w = world()
    await w.optOuts.refresh()
    withHumans(w, 2)
    at(75)
    await w.rec.checkSchedule(day())
    ;(w.rec as unknown as { current: { capture: { stats: Map<string, unknown> } } }).current.capture.stats.set('u1', {})
    at(95) // everyone dropped, grace passed
    await w.rec.stop('empty')
    at(100)
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBe('merch')
    expect(joins()).toBe(2)
  })

  it('does not restart once the event window has ended', async () => {
    const w = world()
    await w.optOuts.refresh()
    withHumans(w, 2)
    at(75)
    await w.rec.checkSchedule(day())
    at(75 + 121)
    await w.rec.stop('max-duration')
    await w.rec.checkSchedule(day())
    expect(w.rec.currentEventId).toBeNull()
  })

  it('late edits of an ACTIVE event that already finished do not restart it', async () => {
    const w = world()
    await w.optOuts.refresh()
    at(0)
    await w.rec.handleEvent(sched('creative', 0, { status: EventStatus.Active }))
    await w.rec.stop('empty')
    await w.rec.handleEvent(sched('creative', 0, { status: EventStatus.Active }), true, false)
    expect(w.rec.currentEventId).toBeNull()
  })

  it('max duration counts from the scheduled start when the session began early', async () => {
    const w = world()
    await w.optOuts.refresh()
    withHumans(w, 2)
    at(-10)
    await w.rec.checkSchedule(day())
    const tick = () => (w.rec as unknown as { onTick(): Promise<void> }).onTick()
    at(110) // 120 min after the session started, but only 110 after the scheduled start
    await tick()
    expect(w.rec.currentEventId).toBe('creative')
    at(120)
    await tick()
    expect(w.rec.currentEventId).toBeNull()
  })
})
