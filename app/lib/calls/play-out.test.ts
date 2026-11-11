// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '@/app/lib/settings'
import { SETTINGS, type SettingKey } from '@/app/lib/settings/registry'
import { isPlayOutCommand } from './play-out'
import { clearPlayOutCache, handlePlayOutRequest, type PlayOutDeps } from './play-out-run'
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
    'Play the song, Metalhead',
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
const seg = (discordId: string, startMs = 1000, endMs = 4000) => ({ discordId, displayName: null, key: `calls/${SID}/live/${discordId}/${startMs}.ogg`, startMs, endMs })
const req = (...segments: ReturnType<typeof seg>[]): LiveRequest => ({
  sessionId: SID,
  eventId: '100000000000000001',
  eventName: 'Ops',
  startedAt: new Date(0).toISOString(),
  command: 'play-out',
  segments,
})
function deps(text: string, over: Partial<PlayOutDeps> & { settings?: Settings } = {}): PlayOutDeps & { transcribe: ReturnType<typeof vi.fn> } {
  const transcribe = vi.fn(async () => ({ segments: [{ start: 0, end: 2.5, text }], language: 'en', words: [] }))
  return {
    settings: settings({ 'calls.playOutCommandEnabled': true }),
    env: { VERCEL_ENV: 'production', OPENAI_API_KEY: 'sk-test' },
    resolveCrew: async () => ({ crewId: 'ops', crewLabel: 'Ops' }),
    download: async () => new Uint8Array(4),
    decode: async () => new Int16Array(16000 * 3),
    allowed: async (id: string) => id === '111111',
    log: () => {},
    ...over,
    transcribe,
  } as never
}

beforeEach(() => clearPlayOutCache())

describe('handlePlayOutRequest', () => {
  it('says yes for an allowed speaker giving the command', async () => {
    expect((await handlePlayOutRequest(req(seg('111111')), deps('Metalhead, play the song'))).playOut).toBe(true)
  })
  it('says no for ordinary speech', async () => {
    expect((await handlePlayOutRequest(req(seg('111111')), deps('we should book the venue'))).playOut).toBe(false)
  })
  it('never transcribes a speaker who may not give the command', async () => {
    const d = deps('Metalhead, play the song')
    const out = await handlePlayOutRequest(req(seg('222222')), d)
    expect(out).toEqual({ playOut: false, reason: 'speaker-not-allowed' })
    expect(d.transcribe).not.toHaveBeenCalled()
  })
  it('is off by default and when settings are unreadable', async () => {
    const d1 = deps('Metalhead, play the song', { settings: settings() })
    expect((await handlePlayOutRequest(req(seg('111111')), d1)).reason).toBe('off')
    expect(d1.transcribe).not.toHaveBeenCalled()
    expect((await handlePlayOutRequest(req(seg('111111')), deps('x', { settings: settings({ 'calls.playOutCommandEnabled': true }, true) }))).reason).toBe('off')
  })
  it('honours the env kill switch', async () => {
    const d = deps('Metalhead, play the song', { env: { VERCEL_ENV: 'production', OPENAI_API_KEY: 'sk', CALL_PLAY_OUT_COMMAND_ENABLED: 'off' } })
    expect((await handlePlayOutRequest(req(seg('111111')), d)).reason).toBe('off')
  })
  it('ignores bursts with a foreign key or the wrong length', async () => {
    const d = deps('Metalhead, play the song')
    const foreign = { ...seg('111111'), key: 'calls/other-session-123/live/111111/1000.ogg' }
    expect((await handlePlayOutRequest(req(foreign, seg('111111', 0, 300), seg('111111', 0, 60_000)), d)).reason).toBe('nothing-to-check')
    expect(d.transcribe).not.toHaveBeenCalled()
  })
  it('fails closed when the crew is unknown', async () => {
    expect((await handlePlayOutRequest(req(seg('111111')), deps('Metalhead, play the song', { resolveCrew: async () => null }))).reason).toBe('crew-unknown')
  })
})
