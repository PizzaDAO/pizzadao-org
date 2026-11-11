/**
 * Spoken play-out command ("That's the end of the call, Metalhead, play the song").
 *
 * Fast path, separate from the slow action-item chunks: every short speech burst is uploaded to R2
 * as soon as it finishes (the capture closes a burst after 1 s of silence) and the app is asked
 * whether it contains the command (POST /api/calls/recorder/live-chunk with command 'play-out').
 * The app does everything that needs secrets or the database: transcription, the fuzzy match and
 * the "who may give the command" check. This side only forwards bursts, one request at a time, and
 * calls `onCommand` once when the app says yes. Every failure is logged and dropped.
 *
 * Bounded cost: bursts outside MIN..MAX_BURST_MS are not sent, at most MAX_REQUESTS_PER_CALL
 * requests per call, at most MAX_QUEUED waiting (the newest win: a command is said right now).
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

/** POST the bursts to the app; true only when it answers that the command was given. Never throws. */
export async function postPlayOutCheck(
  appBaseUrl: string,
  apiKey: string,
  body: LiveRequest,
  log: (msg: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${appBaseUrl}/api/calls/recorder/live-chunk`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PLAY_OUT_REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      log(`play-out: app answered ${res.status}`)
      return false
    }
    return ((await res.json()) as { playOut?: unknown }).playOut === true
  } catch (err) {
    log(`play-out: request failed (${err instanceof Error ? err.message : String(err)})`)
    return false
  }
}

export interface PlayOutListenerDeps {
  sessionId: string
  eventId: string | null
  eventName: string | null
  startedAtMs: number
  dir: string
  uploader: Pick<Uploader, 'put'>
  check: (body: LiveRequest) => Promise<boolean>
  /** Called at most once per call, when the app confirms the command. */
  onCommand: () => void
  log: (msg: string) => void
}

export class PlayOutListener {
  private queue: SegmentRecord[] = []
  private busy = false
  private stopped = false
  private fired = false
  private requests = 0
  /** Keys already uploaded (the regular live chunk can skip them). */
  readonly uploaded = new Set<string>()

  constructor(private readonly d: PlayOutListenerDeps) {}

  /** A finished speech burst (from the capture). */
  onSegment(rec: SegmentRecord): void {
    if (this.stopped || this.fired || rec.bytes <= 0) return
    const len = rec.endMs - rec.startMs
    if (len < MIN_BURST_MS || len > MAX_BURST_MS) return
    this.queue.push(rec)
    if (this.queue.length > MAX_QUEUED) this.queue.splice(0, this.queue.length - MAX_QUEUED)
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      while (!this.stopped && !this.fired && this.queue.length > 0 && this.requests < MAX_REQUESTS_PER_CALL) {
        const batch = this.queue.splice(0, this.queue.length)
        this.requests++
        const segments: LiveSegment[] = []
        const keys = sessionKeys(this.d.sessionId)
        for (const rec of batch) {
          const key = keys.live(rec.userId, rec.startMs)
          try {
            await this.d.uploader.put(key, path.join(this.d.dir, rec.file), 'audio/ogg')
            this.uploaded.add(key)
            segments.push({ discordId: rec.userId, displayName: null, key, startMs: rec.startMs, endMs: rec.endMs })
          } catch (err) {
            this.d.log(`play-out: upload failed (${err instanceof Error ? err.message : String(err)})`)
          }
        }
        if (segments.length === 0 || this.stopped) continue
        const yes = await this.d.check({
          sessionId: this.d.sessionId,
          eventId: this.d.eventId,
          eventName: this.d.eventName,
          startedAt: new Date(this.d.startedAtMs).toISOString(),
          command: 'play-out',
          segments,
        })
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
