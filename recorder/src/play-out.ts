/**
 * Spoken play-out command ("That's the end of the call, Metalhead, play the song").
 *
 * Fast path, separate from the slow action-item chunks. For each short speech burst (the capture
 * closes a burst after 1 s of silence):
 *   1. the speaker must be allowed to give the command: the app is asked once per speaker
 *      (POST live-chunk, command 'play-out-allowed') and the answer is cached for a couple of
 *      minutes; bursts of anyone else are never uploaded;
 *   2. the burst is uploaded under calls/<session>/cmd/ and the app is asked whether it contains
 *      the command (command 'play-out');
 *   3. the uploaded burst is deleted again right after the check.
 * The app does everything that needs secrets or the database: transcription, the match and the
 * role checks. This side forwards bursts one request at a time and calls `onCommand` once when
 * the app says yes. Every failure is logged and dropped.
 *
 * Bounded cost: bursts outside MIN..MAX_BURST_MS are not sent, at most MAX_REQUESTS_PER_CALL
 * checks per call (the app enforces its own per-session cap too), at most MAX_QUEUED waiting.
 */
import path from 'node:path'
import { sessionKeys, type Uploader } from './storage.js'
import type { SegmentRecord } from './types.js'
import type { LiveRequest, LiveSegment } from './live-items.js'

export const MIN_BURST_MS = 1_000
export const MAX_BURST_MS = 15_000
export const MAX_QUEUED = 3
export const MAX_REQUESTS_PER_CALL = 150
export const PLAY_OUT_REQUEST_TIMEOUT_MS = 25_000
/** How long an "allowed / not allowed" answer for a speaker is kept. */
export const SPEAKER_CACHE_MS = 2 * 60_000
/** After a failed lookup POST the next lookup waits this long, doubling per failure up to the max. */
export const LOOKUP_BACKOFF_MS = 5_000
export const LOOKUP_BACKOFF_MAX_MS = 5 * 60_000

export interface PlayOutAnswer {
  playOut?: boolean
  allowed?: string[]
  denied?: string[]
  /** Set when the app's gate refused (switch off, crew unknown or excluded): the listener turns itself off. */
  reason?: string
}

/** POST to the app; null on any failure. Never throws. */
export async function postPlayOut(
  appBaseUrl: string,
  apiKey: string,
  body: LiveRequest,
  log: (msg: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<PlayOutAnswer | null> {
  try {
    const res = await fetchImpl(`${appBaseUrl}/api/calls/recorder/live-chunk`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PLAY_OUT_REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      log(`play-out: app answered ${res.status}`)
      return null
    }
    const j = (await res.json()) as Record<string, unknown>
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)
    return { playOut: j.playOut === true, allowed: ids(j.allowed), denied: ids(j.denied), reason: typeof j.reason === 'string' ? j.reason : undefined }
  } catch (err) {
    log(`play-out: request failed (${err instanceof Error ? err.message : String(err)})`)
    return null
  }
}

export interface PlayOutListenerDeps {
  sessionId: string
  eventId: string | null
  eventName: string | null
  startedAtMs: number
  dir: string
  uploader: Pick<Uploader, 'put'> & { remove?: Uploader['remove'] }
  post: (body: LiveRequest) => Promise<PlayOutAnswer | null>
  /** Called at most once per call, when the app confirms the command. */
  onCommand: () => void
  log: (msg: string) => void
  now?: () => number
}

export class PlayOutListener {
  private queue: SegmentRecord[] = []
  private busy = false
  private stopped = false
  private fired = false
  private requests = 0
  private lookupFailures = 0
  private lookupRetryAt = 0
  private speakers = new Map<string, { ok: boolean; at: number }>()

  constructor(private readonly d: PlayOutListenerDeps) {}

  private now(): number {
    return (this.d.now ?? Date.now)()
  }

  /** A finished speech burst (from the capture). */
  onSegment(rec: SegmentRecord): void {
    if (this.stopped || this.fired || rec.bytes <= 0) return
    const len = rec.endMs - rec.startMs
    if (len < MIN_BURST_MS || len > MAX_BURST_MS) return
    const known = this.speakers.get(rec.userId)
    if (known && known.ok === false && this.now() - known.at < SPEAKER_CACHE_MS) return // not allowed: never uploaded
    this.queue.push(rec)
    if (this.queue.length > MAX_QUEUED) this.queue.splice(0, this.queue.length - MAX_QUEUED)
    void this.drain()
  }

  private base(): Pick<LiveRequest, 'sessionId' | 'eventId' | 'eventName' | 'startedAt'> {
    return { sessionId: this.d.sessionId, eventId: this.d.eventId, eventName: this.d.eventName, startedAt: new Date(this.d.startedAtMs).toISOString() }
  }

  /** Ask the app about speakers not (or no longer) in the cache. A failed lookup is not cached: the burst is dropped. */
  private async learnSpeakers(batch: SegmentRecord[]): Promise<void> {
    const unknown = [...new Set(batch.map((r) => r.userId))].filter((id) => {
      const k = this.speakers.get(id)
      return !k || this.now() - k.at >= SPEAKER_CACHE_MS
    })
    if (unknown.length === 0) return
    if (this.now() < this.lookupRetryAt) return // backing off after a failed lookup: the burst is dropped
    this.requests++ // lookups count toward the per-call cap
    const a = await this.d.post({ ...this.base(), command: 'play-out-allowed', speakers: unknown.slice(0, 10) })
    if (!a) {
      this.lookupFailures++
      this.lookupRetryAt = this.now() + Math.min(LOOKUP_BACKOFF_MAX_MS, LOOKUP_BACKOFF_MS * 2 ** (this.lookupFailures - 1))
      return
    }
    this.lookupFailures = 0
    if (a.reason) {
      // The app's gate refused (switch off, crew unknown or excluded): off for this call.
      this.d.log(`play-out: the app refused (${a.reason}); off for this call`)
      this.stop()
      return
    }
    const at = this.now()
    for (const id of a.allowed ?? []) this.speakers.set(id, { ok: true, at })
    for (const id of a.denied ?? []) this.speakers.set(id, { ok: false, at })
  }

  private async drain(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      while (!this.stopped && !this.fired && this.queue.length > 0 && this.requests < MAX_REQUESTS_PER_CALL) {
        const batch = this.queue.splice(0, this.queue.length)
        await this.learnSpeakers(batch)
        if (this.stopped) break
        const allowed = batch.filter((r) => this.speakers.get(r.userId)?.ok === true)
        if (allowed.length === 0) continue
        this.requests++
        const segments: LiveSegment[] = []
        const keys = sessionKeys(this.d.sessionId)
        for (const rec of allowed) {
          const key = keys.cmd(rec.userId, rec.startMs)
          try {
            await this.d.uploader.put(key, path.join(this.d.dir, rec.file), 'audio/ogg')
            segments.push({ discordId: rec.userId, displayName: null, key, startMs: rec.startMs, endMs: rec.endMs })
          } catch (err) {
            this.d.log(`play-out: upload failed (${err instanceof Error ? err.message : String(err)})`)
          }
        }
        if (segments.length === 0 || this.stopped) continue
        let yes = false
        try {
          yes = (await this.d.post({ ...this.base(), command: 'play-out', segments }))?.playOut === true
        } finally {
          // The burst is not needed any more (finalize would prune it anyway).
          for (const s of segments) void Promise.resolve(this.d.uploader.remove?.(s.key)).catch(() => undefined)
        }
        if (yes && !this.stopped && !this.fired) {
          this.fired = true
          this.queue = []
          this.d.onCommand()
        }
      }
    } finally {
      this.busy = false
    }
  }

  stop(): void {
    this.stopped = true
    this.queue = []
  }
}
