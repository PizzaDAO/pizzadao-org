/**
 * Playback adapter for the spoken call updates (plans/metalhead-reads-updates.md, section 2).
 *
 * Today pizza-radio plays the clips (its own Discord application and voice connection, so the
 * recording connection is never touched). Everything goes through the `Speaker` interface so moving
 * to Metalhead later is one more adapter.
 *
 * Previews never speak: unless VERCEL_ENV is "production" (and PIZZA_RADIO_URL / PIZZA_RADIO_API_KEY
 * are set) the speaker is a no-op that logs "preview, not speaking".
 */
import type { ClipUrl } from './tts'

export type PlayStatus = 'playing' | 'queued' | 'skipped'
export interface PlayResult {
  status: PlayStatus
  reason?: string
}
export interface ControlResult {
  ok: boolean
  reason?: string
}
export interface SpeakerStatus {
  channelId: string | null
  kind: string | null
  tag: string | null
  paused: boolean
  clipIndex: number
  clipCount: number
}

export const UPDATES_TAG = 'updates'

export interface Speaker {
  /** True for the real adapter, false for the no-op. */
  readonly live: boolean
  play(o: { channelId: string; clips: ClipUrl[]; ifBusy?: 'queue' | 'skip'; pauseMaxMs: number }): Promise<PlayResult>
  pause(o: { pauseMaxMs: number }): Promise<ControlResult>
  resume(): Promise<ControlResult>
  skip(): Promise<ControlResult>
  /** Stop whatever pizza-radio is playing in this channel and leave it. */
  stop(o: { channelId: string }): Promise<ControlResult>
  status(): Promise<SpeakerStatus | null>
}

/** Whether this deploy may speak at all: production, and pizza-radio configured. */
export function speakerConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === 'production' && !!env.PIZZA_RADIO_URL?.trim() && !!env.PIZZA_RADIO_API_KEY?.trim()
}

export function noopSpeaker(log: (m: string) => void = (m) => console.warn('[call-updates]', m)): Speaker {
  const off = async () => {
    log('preview, not speaking')
    return { ok: false, reason: 'preview' }
  }
  return {
    live: false,
    play: async () => {
      log('preview, not speaking')
      return { status: 'skipped', reason: 'preview' }
    },
    pause: off,
    resume: off,
    skip: off,
    stop: off,
    status: async () => null,
  }
}

export function pizzaRadioSpeaker(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Speaker {
  const base = (env.PIZZA_RADIO_URL ?? '').trim().replace(/\/+$/, '')
  const key = (env.PIZZA_RADIO_API_KEY ?? '').trim()
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      // /play-url downloads the clips first, so it can take a few seconds.
      signal: AbortSignal.timeout(25_000),
      cache: 'no-store',
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, json }
  }
  const control = async (path: string, body: Record<string, unknown>): Promise<ControlResult> => {
    const r = await call('POST', path, { tag: UPDATES_TAG, ...body })
    if (r.status === 409) return { ok: false, reason: 'nothing-playing' }
    if (r.status >= 300) throw new Error(`pizza-radio ${path} HTTP ${r.status}`)
    return { ok: true }
  }
  return {
    live: true,
    async play(o) {
      const r = await call('POST', '/play-url', { channelId: o.channelId, clips: o.clips, tag: UPDATES_TAG, ifBusy: o.ifBusy ?? 'queue', pauseMaxMs: o.pauseMaxMs })
      if (r.status === 409) return { status: 'skipped', reason: 'busy-elsewhere' }
      if (r.status >= 300) throw new Error(`pizza-radio /play-url HTTP ${r.status}`)
      const st = r.json.status
      return { status: st === 'queued' ? 'queued' : st === 'skipped' ? 'skipped' : 'playing', ...(typeof r.json.reason === 'string' ? { reason: r.json.reason } : {}) }
    },
    pause: (o) => control('/pause', { pauseMaxMs: o.pauseMaxMs }),
    resume: () => control('/resume', {}),
    skip: () => control('/skip', {}),
    async stop(o) {
      // Only what is in this call's channel: a mixtape somewhere else is none of our business.
      const r = await call('POST', '/stop', { leave: true, channelId: o.channelId })
      if (r.status >= 300) throw new Error(`pizza-radio /stop HTTP ${r.status}`)
      return { ok: r.json.stopped === true, ...(r.json.stopped === true ? {} : { reason: 'nothing-playing' }) }
    },
    async status() {
      const r = await call('GET', '/status')
      return r.status < 300 ? (r.json as unknown as SpeakerStatus) : null
    },
  }
}

export function defaultSpeaker(env: Record<string, string | undefined> = process.env): Speaker {
  return speakerConfigured(env) ? pizzaRadioSpeaker(env) : noopSpeaker()
}
