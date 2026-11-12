import { describe, expect, it, vi } from 'vitest'
import type { Settings } from '@/app/lib/settings'
import { SETTINGS, type SettingKey } from '@/app/lib/settings/registry'
import { controlUpdates, safeName, startUpdates, MAX_RUNS_PER_CALL, type CallRef, type RunDeps, type RunStore } from './run'
import type { Speaker } from './speaker'
import type { ScriptResult } from './script'

const CALL: CallRef = { sessionId: 'sess1', eventId: 'ev1', crewId: 'ops', channelId: '900000000000000001', startedAt: new Date('2026-11-12T12:00:00Z'), hidden: false }
const PROD = { VERCEL_ENV: 'production' }

function settings(over: Partial<Record<SettingKey, unknown>> = {}): Settings {
  const values = { 'calls.updatesEnabled': true, ...over } as Record<string, unknown>
  return {
    readFailed: false,
    invalidKeys: [],
    isSet: (k: string) => k in values,
    get: (k: string) => (k in values ? values[k] : SETTINGS[k as SettingKey].default),
  } as unknown as Settings
}

const SCRIPT: ScriptResult = {
  kind: 'script',
  crewId: 'ops',
  crewLabel: 'Ops',
  sections: [
    { key: 'intro', lines: ['Automated call updates for the Ops call.'] },
    { key: 'last-call', lines: ['From last call, 1 action item is still open.'] },
    { key: 'outro', lines: ["That's the update."] },
  ],
  text: 'x',
  estSeconds: 12,
  hash: 'abcd1234abcd1234',
  dropped: [],
}

function memStore(initial: Array<{ seq: number; status: string }> = []): RunStore & { rows: Array<{ id: string; seq: number; status: string; [k: string]: unknown }> } {
  const rows = initial.map((r, i) => ({ id: `r${i}`, ...r })) as Array<{ id: string; seq: number; status: string; [k: string]: unknown }>
  return {
    rows,
    countActive: async () => rows.filter((r) => r.status !== 'skipped').length,
    nextSeq: async () => rows.reduce((m, r) => Math.max(m, r.seq), -1) + 1,
    create: async (row) => {
      if (rows.some((r) => r.seq === row.seq)) throw Object.assign(new Error('dup'), { code: 'P2002' })
      const r = { id: `r${rows.length}`, status: 'queued', ...row }
      rows.push(r)
      return { id: r.id }
    },
    update: async (id, data) => void Object.assign(rows.find((r) => r.id === id)!, data),
    latest: async (sessionId) => {
      const r = [...rows].filter((x) => x.status !== 'skipped').sort((a, b) => b.seq - a.seq)[0]
      return r ? { id: r.id, sessionId, seq: r.seq, status: r.status } : null
    },
  }
}

function speaker(over: Partial<Speaker> = {}): Speaker {
  return {
    live: true,
    play: vi.fn(async () => ({ status: 'playing' as const })),
    pause: vi.fn(async () => ({ ok: true })),
    resume: vi.fn(async () => ({ ok: true })),
    skip: vi.fn(async () => ({ ok: true })),
    stop: vi.fn(async () => ({ ok: true })),
    status: vi.fn(async () => null),
    ...over,
  }
}

function deps(over: Partial<RunDeps> = {}): RunDeps & { store: ReturnType<typeof memStore> } {
  return {
    settings: async () => settings(),
    env: PROD,
    build: vi.fn(async () => SCRIPT),
    render: vi.fn(async (sections: Array<{ label: string }>) => ({ clips: sections.map((s) => ({ url: `https://r2.example/${s.label}`, label: s.label })) })),
    speaker: speaker(),
    store: memStore(),
    announce: vi.fn(async () => undefined),
    ...over,
  } as RunDeps & { store: ReturnType<typeof memStore> }
}

const START = { trigger: 'command' as const, startedBy: '100000000000000001' }

describe('startUpdates', () => {
  it('plays one clip per section and records the run (hash and counts, never text)', async () => {
    const d = deps()
    const r = await startUpdates(CALL, START, d)
    expect(r).toEqual({ status: 'playing', estSeconds: 12, sections: 3 })
    expect(d.render).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ label: 'intro' })]), { voice: 'ash', instructions: expect.stringContaining('surfer-dude robot') })
    expect(d.speaker.play).toHaveBeenCalledWith(expect.objectContaining({ channelId: CALL.channelId, ifBusy: 'queue', pauseMaxMs: 300000 }))
    expect(d.store.rows).toHaveLength(1)
    expect(d.store.rows[0]).toMatchObject({ seq: 0, status: 'playing', scriptHash: 'abcd1234abcd1234', sectionCount: 3, estSeconds: 12, trigger: 'command', crewId: 'ops' })
    expect(JSON.stringify(d.store.rows)).not.toContain('Automated call updates')
  })

  it('refuses while the switch is off (and never builds or renders)', async () => {
    const d = deps({ settings: async () => settings({ 'calls.updatesEnabled': false }) })
    expect(await startUpdates(CALL, START, d)).toEqual({ status: 'skipped', reason: 'disabled' })
    expect(d.build).not.toHaveBeenCalled()
  })

  it('the env kill switch wins over a saved ON', async () => {
    const d = deps({ env: { ...PROD, CALL_UPDATES_ENABLED: 'off' } })
    expect((await startUpdates(CALL, START, d)).reason).toBe('disabled')
  })

  it('a preview deploy ignores a saved ON, never calls text to speech, never plays', async () => {
    const d = deps({ env: { VERCEL_ENV: 'preview' } })
    expect((await startUpdates(CALL, START, d)).reason).toBe('disabled')
    // And even with the env switch on, a non-live (preview) speaker refuses before any paid TTS.
    const d2 = deps({ env: { VERCEL_ENV: 'preview', CALL_UPDATES_ENABLED: '1' }, speaker: speaker({ live: false, play: vi.fn(async () => ({ status: 'skipped' as const, reason: 'preview' })) }) })
    expect(await startUpdates(CALL, START, d2)).toEqual({ status: 'skipped', reason: 'preview' })
    expect(d2.render).not.toHaveBeenCalled()
    expect(d2.store.rows).toHaveLength(0)
  })

  it('a hidden session never gets updates', async () => {
    const d = deps()
    expect((await startUpdates({ ...CALL, hidden: true }, START, d)).reason).toBe('hidden')
    expect(d.build).not.toHaveBeenCalled()
  })

  it('caps runs per call (skipped runs do not count)', async () => {
    const d = deps({ store: memStore([{ seq: 0, status: 'done' }, { seq: 1, status: 'skipped' }, { seq: 2, status: 'stopped' }, { seq: 3, status: 'done' }]) })
    expect((await startUpdates(CALL, START, d)).reason).toBe('cap')
    expect(MAX_RUNS_PER_CALL).toBe(3)
    const d2 = deps({ store: memStore([{ seq: 0, status: 'done' }, { seq: 1, status: 'skipped' }]) })
    expect((await startUpdates(CALL, START, d2)).status).toBe('playing')
    expect(d2.store.rows.at(-1)!.seq).toBe(2)
  })

  it('an empty or excluded script plays nothing and uses no cap slot', async () => {
    for (const reason of ['empty', 'excluded', 'filter-unreadable'] as const) {
      const d = deps({ build: vi.fn(async () => ({ kind: 'none' as const, reason })) })
      expect(await startUpdates(CALL, START, d)).toEqual({ status: 'skipped', reason })
      expect(d.render).not.toHaveBeenCalled()
      expect(d.store.rows).toHaveLength(0)
    }
  })

  it('claim idempotency: a lost unique race is retried once, then reported busy', async () => {
    const store = memStore()
    let calls = 0
    store.create = async () => {
      calls++
      throw Object.assign(new Error('dup'), { code: 'P2002' })
    }
    const d = deps({ store })
    expect(await startUpdates(CALL, START, d)).toEqual({ status: 'skipped', reason: 'busy' })
    expect(calls).toBe(2)
    expect(d.render).not.toHaveBeenCalled()
  })

  it('a pizza-radio busy-elsewhere answer becomes skipped with the reason', async () => {
    const d = deps({ speaker: speaker({ play: vi.fn(async () => ({ status: 'skipped' as const, reason: 'busy-elsewhere' })) }) })
    expect(await startUpdates(CALL, START, d)).toMatchObject({ status: 'skipped', reason: 'busy-elsewhere' })
    expect(d.store.rows[0]).toMatchObject({ status: 'skipped', reason: 'busy-elsewhere' })
  })

  it('queued behind the band is recorded as queued', async () => {
    const d = deps({ speaker: speaker({ play: vi.fn(async () => ({ status: 'queued' as const })) }) })
    expect((await startUpdates(CALL, START, d)).status).toBe('queued')
    expect(d.store.rows[0].status).toBe('queued')
  })

  it('a text-to-speech failure and a speaker failure are skipped, never thrown', async () => {
    const d = deps({ render: vi.fn(async () => { throw new Error('boom') }) })
    expect(await startUpdates(CALL, START, d)).toEqual({ status: 'skipped', reason: 'tts-failed' })
    expect(d.store.rows[0]).toMatchObject({ status: 'skipped', reason: 'tts-failed' })
    const d2 = deps({ speaker: speaker({ play: vi.fn(async () => { throw new Error('down') }) }) })
    expect(await startUpdates(CALL, START, d2)).toEqual({ status: 'skipped', reason: 'speaker-error' })
  })

  it('a pause limit from settings goes to pizza-radio', async () => {
    const d = deps({ settings: async () => settings({ 'calls.updatesPauseMaxMinutes': 2 }) })
    await startUpdates(CALL, START, d)
    expect(d.speaker.play).toHaveBeenCalledWith(expect.objectContaining({ pauseMaxMs: 120000 }))
  })

  it('never logs script text', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await startUpdates(CALL, START, deps())
    const logged = spy.mock.calls.flat().join(' ')
    expect(logged).toContain('hash=abcd1234abcd1234')
    expect(logged).not.toContain('Automated call updates')
    spy.mockRestore()
  })
})

describe('controlUpdates', () => {
  const ACTOR = { discordId: '100000000000000002', displayName: 'Pat' }

  it.each([
    ['pause', 'paused', 'Updates paused by Pat.'],
    ['resume', 'playing', 'Updates resumed by Pat.'],
    ['skip', 'playing', 'Updates skipped ahead by Pat.'],
    ['stop', 'stopped', 'Playback stopped by Pat.'],
  ] as const)('%s updates the run row and posts one line naming who did it', async (action, status, line) => {
    const d = deps({ store: memStore([{ seq: 0, status: 'playing' }]) })
    expect(await controlUpdates(action, CALL, ACTOR, d)).toEqual({ ok: true })
    expect(d.store.rows[0]).toMatchObject({ status, controlledBy: ACTOR.discordId })
    expect(d.announce).toHaveBeenCalledWith(CALL.channelId, line)
  })

  it('stop is scoped to the call channel and leaves; pause passes the settings limit', async () => {
    const d = deps()
    await controlUpdates('stop', CALL, ACTOR, d)
    expect(d.speaker.stop).toHaveBeenCalledWith({ channelId: CALL.channelId })
    await controlUpdates('pause', CALL, ACTOR, d)
    expect(d.speaker.pause).toHaveBeenCalledWith({ pauseMaxMs: 300000 })
  })

  it('nothing playing: reports it, posts nothing', async () => {
    const d = deps({ speaker: speaker({ pause: vi.fn(async () => ({ ok: false, reason: 'nothing-playing' })) }) })
    expect(await controlUpdates('pause', CALL, ACTOR, d)).toEqual({ ok: false, reason: 'nothing-playing' })
    expect(d.announce).not.toHaveBeenCalled()
  })

  it('a speaker failure is a result, not an exception', async () => {
    const d = deps({ speaker: speaker({ skip: vi.fn(async () => { throw new Error('down') }) }) })
    expect(await controlUpdates('skip', CALL, ACTOR, d)).toEqual({ ok: false, reason: 'speaker-error' })
  })

  it('never stops the recording: only the speaker is touched', async () => {
    const d = deps()
    await controlUpdates('stop', CALL, ACTOR, d)
    expect(Object.keys(d.speaker).filter((k) => /record/i.test(k))).toEqual([])
  })
})

describe('safeName', () => {
  it('cannot ping or format', () => {
    expect(safeName('@everyone <@123> **Bob**')).toBe('everyone 123 Bob')
    expect(safeName('  ')).toBe('a member')
  })
})
