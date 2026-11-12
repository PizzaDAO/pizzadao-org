/**
 * Text to speech for the spoken call updates (plans/metalhead-reads-updates.md, section 3).
 *
 * Provider: OpenAI gpt-4o-mini-tts (the app already has OPENAI_API_KEY). One clip per script section so
 * skip and resume work per section; clips are generated in parallel and cached in R2 under a
 * content-addressed key, so a replay costs nothing:
 *
 *   call-updates/<yyyy-mm-dd>/<sha256(text, voice, model, instructions)>.ogg
 *
 * That prefix is outside calls/<session>/ (which finalize prunes). Clips are handed to pizza-radio as
 * presigned GET URLs (15 min). The style prompt is generic and comes from an admin setting.
 */
import { createHash } from 'node:crypto'
import { objectExists, putCallUpdatesObject, signedAudioUrl, SIGNED_URL_TTL_SEC } from '@/app/lib/calls/r2'

export const TTS_MODEL = 'gpt-4o-mini-tts'
const SPEECH_URL = 'https://api.openai.com/v1/audio/speech'
const SYNTH_TIMEOUT_MS = 30_000
/** Larger than a spoken section ever is (the API allows 4096 characters). */
export const MAX_CLIP_CHARS = 1200

export interface Voice {
  voice: string
  instructions: string
  model?: string
}

export interface ClipPlan {
  key: string
  label: string
  text: string
}

export interface ClipUrl {
  url: string
  label: string
}

export interface TtsDeps {
  exists: (key: string) => Promise<boolean>
  put: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>
  sign: (key: string, ttlSec: number) => Promise<string>
  synth: (text: string, v: Required<Voice>) => Promise<Uint8Array>
  now: () => Date
}

/** The cache key: the date folder (for cleanup) and a hash of everything that changes the audio. */
export function clipKey(text: string, v: Voice, now: Date): string {
  const hash = createHash('sha256')
    .update([text, v.voice, v.model ?? TTS_MODEL, v.instructions].join('\u0000'))
    .digest('hex')
  return `call-updates/${now.toISOString().slice(0, 10)}/${hash}.ogg`
}

export function defaultSynth(apiKey: string, fetchImpl: typeof fetch = fetch, format: 'opus' | 'mp3' = 'opus') {
  return async (text: string, v: Required<Voice>): Promise<Uint8Array> => {
    const res = await fetchImpl(SPEECH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: v.model, voice: v.voice, input: text, instructions: v.instructions, response_format: format }),
      signal: AbortSignal.timeout(SYNTH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`OpenAI speech HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

export function defaultTtsDeps(env: Record<string, string | undefined> = process.env): TtsDeps {
  const apiKey = env.OPENAI_API_KEY?.trim()
  return {
    exists: objectExists,
    put: putCallUpdatesObject,
    sign: signedAudioUrl,
    synth: async (text, v) => {
      if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')
      return defaultSynth(apiKey)(text, v)
    },
    now: () => new Date(),
  }
}

/**
 * Render one clip per section (parallel, cached) and return presigned URLs in order. Throws when any
 * clip fails: half an update is worse than none.
 */
export async function renderClips(
  sections: ReadonlyArray<{ label: string; text: string }>,
  voice: Voice,
  deps: TtsDeps = defaultTtsDeps(),
): Promise<{ clips: ClipUrl[]; generated: number; cached: number }> {
  const v: Required<Voice> = { voice: voice.voice, instructions: voice.instructions, model: voice.model ?? TTS_MODEL }
  const now = deps.now()
  let generated = 0
  let cached = 0
  const clips = await Promise.all(
    sections.map(async (s) => {
      const text = s.text.slice(0, MAX_CLIP_CHARS)
      const key = clipKey(text, v, now)
      if (await deps.exists(key)) cached++
      else {
        const bytes = await deps.synth(text, v)
        if (bytes.byteLength === 0) throw new Error('Empty audio from the voice provider')
        await deps.put(key, bytes, 'audio/ogg')
        generated++
      }
      return { url: await deps.sign(key, SIGNED_URL_TTL_SEC), label: s.label }
    }),
  )
  return { clips, generated, cached }
}
