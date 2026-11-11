// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-leads', () => ({ getCrewLeadMemberIds: vi.fn() }))
vi.mock('@/app/lib/member-utils', () => ({ findMemberIdByDiscordId: vi.fn() }))
vi.mock('@/app/lib/auth-guards', () => ({ isAdminDiscordId: vi.fn() }))

import { prisma } from '@/app/lib/db'
import { getCrewLeadMemberIds } from '@/app/lib/crew-leads'
import { findMemberIdByDiscordId } from '@/app/lib/member-utils'
import { isAdminDiscordId } from '@/app/lib/auth-guards'
import type { Settings } from '@/app/lib/settings'
import { SETTINGS, type SettingKey } from '@/app/lib/settings/registry'
import { isPlayOutCommand } from './play-out'
import { clearPlayOutCache, handlePlayOutAllowed, handlePlayOutRequest, MAX_AUDIO_MS_PER_SESSION, MAX_REQUESTS_PER_SESSION, mayPlayOut, type PlayOutDeps } from './play-out-run'
import { EMPTY_POST_FILTER } from './post-filters'
import type { LiveRequest } from './live-items'

describe('isPlayOutCommand', () => {
  it.each([
    'Metalhead, play the song',
    "That's the end of the call, Metalhead, play the song.",
    "That's the end of the call Metalhead, play the song",
    'Metalhead play us out',
    'ok that is the call, metal head, play us out',
    'Medal head play the crew song please',
    'Metalhead, can you play the music',
    'Metalhead, could you please play the song',
    'Metalhead go ahead and play us out',
    'Play the song, Metalhead',
    'Play us out please, Metalhead',
    'Metal Head. Play us out.',
  ])('accepts %j', (t) => expect(isPlayOutCommand(t)).toBe(true))

  it.each([
    'metalhead is playing the song later',
    'Metalhead will play the song at the end',
    "Don't play the song yet, Metalhead",
    'We should ask Metalhead to play the song next week',
    'Metalhead played the song last call',
    'if Metalhead plays us out we can leave',
    'play the song', // not addressed to Metalhead
    'Metalhead, what time is it',
    'my metal band will play the song',
    'the metalhead convention is on tuesday and I will play some songs there',
    'Metalhead',
    '',
    // talk about the command, not the command
    'Metalhead is going to play the song when we are done',
    'so now Metalhead can play the song at the end of the call',
    'you just say Metalhead play the song and it works',
    'you can say Metalhead play us out',
    'did Metalhead play the song',
    'why did metalhead play the song',
    'Metalhead would play the song',
    'Metalhead is gonna play us out',
    'when Metalhead plays the song it is loud',
    'how does Metalhead play the song',
    'Metalhead does play the song',
  ])('rejects %j', (t) => expect(isPlayOutCommand(t)).toBe(false))

  it('rejects a long ramble that happens to contain the phrase', () => {
    const long = `${'we talked about a lot of things today and '.repeat(3)} Metalhead play the song`
    expect(isPlayOutCommand(long)).toBe(false)
  })
})

function settings(over: Partial<Record<SettingKey, unknown>> = {}, readFailed = false): Settings {
  return { readFailed, invalidKeys: [], isSet: (k) => k in over, get: ((k: SettingKey) => (k in over ? over[k] : SETTINGS[k].default)) as Settings['get'] }
}
const SID = 'evt1-1700000000000'
const seg = (discordId: string, startMs = 1000, endMs = 4000) => ({ discordId, displayName: null, key: `calls/${SID}/cmd/${discordId}/${startMs}.ogg`, startMs, endMs })
const req = (...segments: ReturnType<typeof seg>[]): LiveRequest => ({
  sessionId: SID,
  eventId: '100000000000000001',
  eventName: 'Ops',
  startedAt: new Date(0).toISOString(),
  command: 'play-out',
  segments,
})
const ON = { 'calls.playOutCommandEnabled': true }
function deps(text: string, over: Partial<PlayOutDeps> = {}): PlayOutDeps & { transcribe: ReturnType<typeof vi.fn> } {
  const transcribe = vi.fn(async () => ({ segments: [{ start: 0, end: 2.5, text }], language: 'en', words: [] }))
  return {
    settings: settings(ON),
    env: { VERCEL_ENV: 'production', OPENAI_API_KEY: 'sk-test' },
    resolveCrew: async () => ({ crewId: 'ops', crewLabel: 'Ops' }),
    postFilter: async () => EMPTY_POST_FILTER,
    download: async () => new Uint8Array(4),
    decode: async () => new Int16Array(16000 * 3),
    allowed: async (id: string) => id === '111111',
    log: () => {},
    ...over,
    transcribe,
  } as never
}

const chunks = vi.mocked(prisma.callLiveChunk)
beforeEach(() => {
  vi.clearAllMocks()
  clearPlayOutCache()
  chunks.findMany.mockResolvedValue([] as never)
  chunks.create.mockResolvedValue({} as never)
})

describe('handlePlayOutRequest', () => {
  it('says yes for an allowed speaker giving the command, and books the check', async () => {
    expect((await handlePlayOutRequest(req(seg('111111')), deps('Metalhead, play the song'))).playOut).toBe(true)
    const data = (chunks.create.mock.calls[0][0] as { data: { seq: number; segmentKeys: string[]; audioMs: number } }).data
    expect(data).toMatchObject({ seq: -1, segmentKeys: [], audioMs: 3000 }) // negative seq, no keys: live items ignore it
  })
  it('says no for ordinary speech and for talk about the command', async () => {
    expect((await handlePlayOutRequest(req(seg('111111')), deps('we should book the venue'))).playOut).toBe(false)
    expect((await handlePlayOutRequest(req(seg('111111')), deps('you just say Metalhead play the song'))).playOut).toBe(false)
  })
  it('never transcribes a speaker who may not give the command', async () => {
    const d = deps('Metalhead, play the song')
    expect(await handlePlayOutRequest(req(seg('222222')), d)).toEqual({ playOut: false, reason: 'speaker-not-allowed' })
    expect(d.transcribe).not.toHaveBeenCalled()
    expect(chunks.create).not.toHaveBeenCalled()
  })
  it('is off by default and when settings are unreadable', async () => {
    const d1 = deps('Metalhead, play the song', { settings: settings() })
    expect((await handlePlayOutRequest(req(seg('111111')), d1)).reason).toBe('off')
    expect(d1.transcribe).not.toHaveBeenCalled()
    expect((await handlePlayOutRequest(req(seg('111111')), deps('x', { settings: settings(ON, true) }))).reason).toBe('off')
  })
  it('honours the env kill switch', async () => {
    const d = deps('Metalhead, play the song', { env: { VERCEL_ENV: 'production', OPENAI_API_KEY: 'sk', CALL_PLAY_OUT_COMMAND_ENABLED: 'off' } })
    expect((await handlePlayOutRequest(req(seg('111111')), d)).reason).toBe('off')
  })
  it('ignores bursts with a foreign or live-namespace key, or the wrong length', async () => {
    const d = deps('Metalhead, play the song')
    const foreign = { ...seg('111111'), key: 'calls/other-session-123/cmd/111111/1000.ogg' }
    const live = { ...seg('111111'), key: `calls/${SID}/live/111111/1000.ogg` }
    expect((await handlePlayOutRequest(req(foreign, live, seg('111111', 0, 300), seg('111111', 0, 60_000)), d)).reason).toBe('nothing-to-check')
    expect(d.transcribe).not.toHaveBeenCalled()
  })
  it('fails closed when the crew is unknown', async () => {
    expect((await handlePlayOutRequest(req(seg('111111')), deps('Metalhead, play the song', { resolveCrew: async () => null }))).reason).toBe('crew-unknown')
  })
  it('respects excluded crews and an unreadable post filter', async () => {
    const excluded = { ...EMPTY_POST_FILTER, excludedCrewIds: ['ops'] } as never
    const d = deps('Metalhead, play the song', { postFilter: async () => excluded })
    expect((await handlePlayOutRequest(req(seg('111111')), d)).reason).toBe('crew-excluded')
    expect(d.transcribe).not.toHaveBeenCalled()
    const d2 = deps('Metalhead, play the song', { postFilter: async () => { throw new Error('down') } })
    expect((await handlePlayOutRequest(req(seg('111111')), d2)).reason).toBe('filter-unreadable')
  })
  it('refuses beyond the per-session request cap and audio cap, without transcribing', async () => {
    chunks.findMany.mockResolvedValue(Array.from({ length: MAX_REQUESTS_PER_SESSION }, (_, i) => ({ seq: -(i + 1), audioMs: 1000 })) as never)
    const d = deps('Metalhead, play the song')
    expect((await handlePlayOutRequest(req(seg('111111')), d)).reason).toBe('session-cap')
    chunks.findMany.mockResolvedValue([{ seq: -1, audioMs: MAX_AUDIO_MS_PER_SESSION - 1000 }] as never)
    expect((await handlePlayOutRequest(req(seg('111111')), d)).reason).toBe('session-cap')
    expect(d.transcribe).not.toHaveBeenCalled()
  })
  it('takes the next negative seq', async () => {
    chunks.findMany.mockResolvedValue([{ seq: -1, audioMs: 1000 }, { seq: -2, audioMs: 1000 }] as never)
    await handlePlayOutRequest(req(seg('111111')), deps('nothing'))
    expect((chunks.create.mock.calls[0][0] as { data: { seq: number } }).data.seq).toBe(-3)
  })
})

describe('handlePlayOutAllowed', () => {
  const ask = (speakers: string[], d: PlayOutDeps) => handlePlayOutAllowed({ ...req(), command: 'play-out-allowed', speakers }, d)
  it('splits speakers into allowed and denied; a failed lookup is in neither', async () => {
    const d = deps('', { allowed: async (id: string) => (id === '1' ? true : id === '2' ? false : null) })
    expect(await ask(['1', '2', '3'], d)).toEqual({ allowed: ['1'], denied: ['2'] })
  })
  it('answers nothing when the switch is off', async () => {
    expect(await ask(['1'], deps('', { settings: settings() }))).toMatchObject({ allowed: [], denied: [] })
  })
})

describe('mayPlayOut', () => {
  const lead = vi.mocked(getCrewLeadMemberIds)
  const member = vi.mocked(findMemberIdByDiscordId)
  const admin = vi.mocked(isAdminDiscordId)
  const env = { VERCEL_ENV: 'production' }
  beforeEach(() => {
    member.mockResolvedValue('m1' as never)
    lead.mockResolvedValue(new Set(['m1']) as never)
    admin.mockResolvedValue(false as never)
  })
  it('allows a crew lead', async () => expect(await mayPlayOut('1', 'ops', settings(ON), 0, env)).toBe(true))
  it('denies a plain member by default, allows them with calls.playOutAnyMember', async () => {
    lead.mockResolvedValue(new Set(['other']) as never)
    expect(await mayPlayOut('1', 'ops', settings(ON), 0, env)).toBe(false)
    clearPlayOutCache()
    expect(await mayPlayOut('1', 'ops', settings({ ...ON, 'calls.playOutAnyMember': true }), 0, env)).toBe(true)
  })
  it('denies someone who is not signed up, unless they are an admin', async () => {
    member.mockResolvedValue(null as never)
    expect(await mayPlayOut('1', 'ops', settings({ ...ON, 'calls.playOutAnyMember': true }), 0, env)).toBe(false)
    clearPlayOutCache()
    admin.mockResolvedValue(true as never)
    expect(await mayPlayOut('1', 'ops', settings(ON), 0, env)).toBe(true)
  })
  it('does not cache a lookup failure, and caches a real answer', async () => {
    lead.mockRejectedValue(new Error('sheet down'))
    expect(await mayPlayOut('1', 'ops', settings(ON), 0, env)).toBeNull()
    lead.mockResolvedValue(new Set(['m1']) as never)
    expect(await mayPlayOut('1', 'ops', settings(ON), 1, env)).toBe(true) // asked again
    lead.mockResolvedValue(new Set() as never)
    expect(await mayPlayOut('1', 'ops', settings(ON), 2, env)).toBe(true) // cached
  })
  it('the any-member env kill switch is honoured', async () => {
    lead.mockResolvedValue(new Set(['other']) as never)
    expect(await mayPlayOut('1', 'ops', settings({ ...ON, 'calls.playOutAnyMember': true }), 0, { VERCEL_ENV: 'production', CALL_PLAY_OUT_ANY_MEMBER: 'off' })).toBe(false)
  })
})
