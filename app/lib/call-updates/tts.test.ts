import { describe, expect, it, vi } from 'vitest'
import { clipKey, defaultSynth, renderClips, TTS_MODEL, type TtsDeps } from './tts'

const NOW = new Date('2026-11-12T12:00:00Z')
const V = { voice: 'ash', instructions: 'Upbeat and clear.' }

function deps(over: Partial<TtsDeps> = {}) {
  const store = new Set<string>()
  const d: TtsDeps = {
    exists: vi.fn(async (k: string) => store.has(k)),
    put: vi.fn(async (k: string) => void store.add(k)),
    sign: vi.fn(async (k: string, ttl: number) => `https://r2.example/${k}?ttl=${ttl}`),
    synth: vi.fn(async () => new Uint8Array([1, 2, 3])),
    now: () => NOW,
    ...over,
  }
  return d
}

describe('clipKey', () => {
  it('is content addressed under call-updates/<date>/', () => {
    const k = clipKey('hello', V, NOW)
    expect(k).toMatch(/^call-updates\/2026-11-12\/[0-9a-f]{64}\.ogg$/)
    expect(clipKey('hello', V, NOW)).toBe(k)
  })

  it('changes with the text, voice, model and instructions', () => {
    const k = clipKey('hello', V, NOW)
    expect(clipKey('hello!', V, NOW)).not.toBe(k)
    expect(clipKey('hello', { ...V, voice: 'echo' }, NOW)).not.toBe(k)
    expect(clipKey('hello', { ...V, instructions: 'Calm.' }, NOW)).not.toBe(k)
    expect(clipKey('hello', { ...V, model: 'tts-1' }, NOW)).not.toBe(k)
    expect(clipKey('hello', { ...V, model: TTS_MODEL }, NOW)).toBe(k)
  })

  it('does not collide across field boundaries', () => {
    expect(clipKey('ab', { voice: 'c', instructions: 'd' }, NOW)).not.toBe(clipKey('a', { voice: 'bc', instructions: 'd' }, NOW))
  })
})

describe('renderClips', () => {
  it('generates, stores and signs one clip per section, in order, for 15 minutes', async () => {
    const d = deps()
    const r = await renderClips([{ label: 'intro', text: 'One' }, { label: 'outro', text: 'Two' }], V, d)
    expect(r.generated).toBe(2)
    expect(r.cached).toBe(0)
    expect(r.clips.map((c) => c.label)).toEqual(['intro', 'outro'])
    expect(r.clips[0].url).toContain('ttl=900')
    expect(d.put).toHaveBeenCalledWith(expect.stringMatching(/^call-updates\//), expect.any(Uint8Array), 'audio/ogg')
  })

  it('a cache hit skips OpenAI', async () => {
    const d = deps()
    await renderClips([{ label: 'a', text: 'Same text' }], V, d)
    expect(d.synth).toHaveBeenCalledTimes(1)
    const again = await renderClips([{ label: 'a', text: 'Same text' }], V, d)
    expect(d.synth).toHaveBeenCalledTimes(1)
    expect(again.cached).toBe(1)
    expect(again.generated).toBe(0)
  })

  it('passes the voice, style and model to the provider', async () => {
    const d = deps()
    await renderClips([{ label: 'a', text: 'Hi' }], V, d)
    expect(d.synth).toHaveBeenCalledWith('Hi', { voice: 'ash', instructions: 'Upbeat and clear.', model: TTS_MODEL })
  })

  it('fails the whole update when a clip cannot be made (half an update is worse than none)', async () => {
    const d = deps({ synth: vi.fn(async () => { throw new Error('boom') }) })
    await expect(renderClips([{ label: 'a', text: 'Hi' }], V, d)).rejects.toThrow('boom')
  })

  it('rejects an empty audio response', async () => {
    const d = deps({ synth: vi.fn(async () => new Uint8Array()) })
    await expect(renderClips([{ label: 'a', text: 'Hi' }], V, d)).rejects.toThrow(/Empty audio/)
    expect(d.put).not.toHaveBeenCalled()
  })
})

describe('defaultSynth', () => {
  it('posts to the speech API with the style prompt and the requested format', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([9, 9]), { status: 200 }))
    const bytes = await defaultSynth('sk-test', fetchImpl as unknown as typeof fetch, 'opus')('Hello', { voice: 'ash', instructions: 'Be clear.', model: TTS_MODEL })
    expect(bytes).toEqual(new Uint8Array([9, 9]))
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/audio/speech')
    expect(JSON.parse(String(init.body))).toEqual({ model: TTS_MODEL, voice: 'ash', input: 'Hello', instructions: 'Be clear.', response_format: 'opus' })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })

  it('throws on a provider error without leaking the body', async () => {
    const fetchImpl = vi.fn(async () => new Response('secret details', { status: 500 }))
    await expect(defaultSynth('k', fetchImpl as unknown as typeof fetch)('x', { voice: 'ash', instructions: '', model: TTS_MODEL })).rejects.toThrow('OpenAI speech HTTP 500')
  })
})
