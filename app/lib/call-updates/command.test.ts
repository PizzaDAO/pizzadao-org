import { describe, expect, it, vi } from 'vitest'
import type { Settings } from '@/app/lib/settings'
import { SETTINGS, type SettingKey } from '@/app/lib/settings/registry'
import { executeMetalhead, mayRun, pickCall, runMetalheadCommand, type LiveCall } from './command'
import type { RunDeps } from './run'
import type { ScriptResult } from './script'

const call = (over: Partial<LiveCall> = {}): LiveCall => ({
  sessionId: 's1', eventId: 'e1', crewId: 'ops', crewLabel: 'Ops', channelId: '900000000000000001', startedAt: new Date('2026-11-12T12:00:00Z'), hidden: false, ...over,
})
const A = call()
const B = call({ sessionId: 's2', crewId: 'art', crewLabel: 'Art', channelId: '900000000000000002' })

function settings(over: Partial<Record<SettingKey, unknown>> = {}): Settings {
  const values = { 'calls.updatesEnabled': true, ...over } as Record<string, unknown>
  return {
    readFailed: false,
    invalidKeys: [],
    isSet: (k: string) => k in values,
    get: (k: string) => (k in values ? values[k] : SETTINGS[k as SettingKey].default),
  } as unknown as Settings
}

describe('pickCall', () => {
  it('uses the call whose voice channel chat the command was typed in', () => {
    expect(pickCall([A, B], B.channelId, undefined)).toEqual({ ok: true, call: B })
  })

  it('falls back to the only live call', () => {
    expect(pickCall([A], '123', undefined)).toEqual({ ok: true, call: A })
    expect(pickCall([A], undefined, undefined)).toEqual({ ok: true, call: A })
  })

  it('with several live calls and no match, asks which (or takes the call choice)', () => {
    const r = pickCall([A, B], '123', undefined)
    expect(r.ok).toBe(false)
    expect(pickCall([A, B], '123', 's2')).toEqual({ ok: true, call: B })
    expect(pickCall([A, B], '123', 'gone').ok).toBe(false)
  })

  it('no live call', () => {
    expect(pickCall([], '123', undefined)).toEqual({ ok: false, message: 'No call is being recorded right now.' })
  })
})

describe('mayRun', () => {
  const none = { isLead: async () => false, isHost: async () => false, isMember: async () => true, env: { VERCEL_ENV: 'production' } }
  const who = { discordId: '1', admin: false }

  it('admins, crew leads and live hosts may do everything', async () => {
    expect(await mayRun('updates', { discordId: '1', admin: true }, 'ops', settings(), none)).toBe(true)
    expect(await mayRun('updates', who, 'ops', settings(), { ...none, isLead: async () => true })).toBe(true)
    expect(await mayRun('stop', who, 'ops', settings(), { ...none, isHost: async () => true })).toBe(true)
    expect(await mayRun('script', who, 'ops', settings(), { ...none, isHost: async () => true })).toBe(true)
  })

  it('a plain member is denied', async () => {
    for (const sub of ['updates', 'stop', 'pause', 'resume', 'skip', 'script'] as const) expect(await mayRun(sub, who, 'ops', settings(), none)).toBe(false)
  })

  it('the any-member switch opens stop / pause / resume / skip but never updates or script', async () => {
    const s = settings({ 'calls.updatesControlAnyMember': true })
    for (const sub of ['stop', 'pause', 'resume', 'skip'] as const) expect(await mayRun(sub, who, 'ops', s, none)).toBe(true)
    expect(await mayRun('updates', who, 'ops', s, none)).toBe(false)
    expect(await mayRun('script', who, 'ops', s, none)).toBe(false)
    // the env kill switch wins over the saved switch
    expect(await mayRun('stop', who, 'ops', s, { ...none, env: { VERCEL_ENV: 'production', CALL_UPDATES_CONTROL_ANY_MEMBER: 'off' } })).toBe(false)
    // ...and still needs a signed-up member
    expect(await mayRun('stop', who, 'ops', s, { ...none, isMember: async () => false })).toBe(false)
  })

  it('fails closed when a lookup throws', async () => {
    const boom = async () => { throw new Error('down') }
    expect(await mayRun('stop', who, 'ops', settings({ 'calls.updatesControlAnyMember': true }), { ...none, isLead: boom, isHost: boom, isMember: boom })).toBe(false)
  })
})

function runDeps(over: Partial<RunDeps> = {}): RunDeps {
  return {
    settings: async () => settings(),
    env: { VERCEL_ENV: 'production' },
    build: vi.fn(),
    render: vi.fn(async (s: Array<{ label: string }>) => ({ clips: s.map((x) => ({ url: 'https://r2.example/x', label: x.label })) })),
    speaker: {
      live: true,
      play: vi.fn(async () => ({ status: 'playing' as const })),
      pause: vi.fn(async () => ({ ok: true })),
      resume: vi.fn(async () => ({ ok: true })),
      skip: vi.fn(async () => ({ ok: true })),
      stop: vi.fn(async () => ({ ok: true })),
      status: vi.fn(async () => null),
    },
    store: {
      claim: async () => ({ id: 'r0', seq: 0 }),
      update: async () => undefined,
      latest: async () => null,
    },
    announce: vi.fn(async () => undefined),
    ...over,
  } as RunDeps
}

const SCRIPT: ScriptResult = {
  kind: 'script', crewId: 'ops', crewLabel: 'Ops', sections: [{ key: 'intro', lines: ['Hello'] }, { key: 'outro', lines: ['Bye'] }], text: 'Hello\n\nBye', estSeconds: 5, hash: 'h', dropped: ['events'],
}

const JOB = { sub: 'updates' as const, discordId: '1', displayName: 'Pat', admin: true, channelId: A.channelId }
const base = (over: Record<string, unknown> = {}, run = runDeps()) => ({
  settings: async () => settings(),
  calls: async () => [A],
  run,
  may: async () => true,
  script: vi.fn(async () => SCRIPT),
  ...over,
})

describe('executeMetalhead', () => {
  it('updates: starts the run and says how long', async () => {
    const run = runDeps({ build: vi.fn(async () => SCRIPT) })
    const r = await executeMetalhead(JOB, base({}, run))
    expect(r.tone).toBe('success')
    expect(r.body).toContain('About 5 seconds')
    expect(run.speaker.play).toHaveBeenCalled()
  })

  it('updates: a denied member gets a refusal and nothing runs', async () => {
    const run = runDeps({ build: vi.fn(async () => SCRIPT) })
    const r = await executeMetalhead(JOB, base({ may: async () => false }, run))
    expect(r.tone).toBe('error')
    expect(run.build).not.toHaveBeenCalled()
    expect(run.speaker.play).not.toHaveBeenCalled()
  })

  it('answers "not enabled" while the updates switch is off, except for the free script preview', async () => {
    const off = { settings: async () => settings({ 'calls.updatesEnabled': false }) }
    const r = await executeMetalhead(JOB, base(off))
    expect(r).toMatchObject({ tone: 'error', headline: 'Call updates are not enabled yet.' })
    const s = await executeMetalhead({ ...JOB, sub: 'script' }, base(off))
    expect(s.tone).toBe('success')
  })

  it('script: shows the text, length and what was dropped, and plays nothing', async () => {
    const run = runDeps()
    const r = await executeMetalhead({ ...JOB, sub: 'script' }, base({}, run))
    expect(r.headline).toBe('Ops updates script')
    expect(r.body).toContain('About 5 seconds')
    expect(r.body).toContain('Left out to fit the time limit: events')
    expect(r.body).toContain('Hello')
    expect(run.speaker.play).not.toHaveBeenCalled()
    expect(run.render).not.toHaveBeenCalled()
  })

  it.each([
    ['stop', 'stop'],
    ['pause', 'pause'],
    ['resume', 'resume'],
    ['skip', 'skip'],
  ] as const)('%s calls the speaker', async (sub, method) => {
    const run = runDeps()
    const r = await executeMetalhead({ ...JOB, sub }, base({}, run))
    expect(r.tone).toBe('success')
    expect(run.speaker[method]).toHaveBeenCalled()
    expect(run.announce).toHaveBeenCalled()
  })

  it('control with nothing playing says so', async () => {
    const run = runDeps()
    run.speaker.pause = vi.fn(async () => ({ ok: false, reason: 'nothing-playing' }))
    expect(await executeMetalhead({ ...JOB, sub: 'pause' }, base({}, run))).toMatchObject({ tone: 'error', headline: 'Nothing is playing.' })
  })

  it('no live call / ambiguous call', async () => {
    expect((await executeMetalhead(JOB, base({ calls: async () => [] }))).headline).toMatch(/No call is being recorded/)
    expect((await executeMetalhead({ ...JOB, channelId: '1' }, base({ calls: async () => [A, B] }))).headline).toMatch(/More than one call/)
  })

  it('a failure becomes a generic error, never a throw', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await executeMetalhead(JOB, base({ calls: async () => { throw new Error('db') } }))
    expect(r).toEqual({ tone: 'error', headline: 'Something went wrong. Please try again.' })
    spy.mockRestore()
  })
})

describe('runMetalheadCommand', () => {
  it('edits the ephemeral reply via the interaction webhook', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    await runMetalheadCommand({ ...JOB, applicationId: 'app1', token: 'tok' }, base({}, runDeps({ build: vi.fn(async () => SCRIPT) })), f as unknown as typeof fetch)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/webhooks/app1/tok/messages/@original')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body)).allowed_mentions).toEqual({ parse: [] })
  })
})
