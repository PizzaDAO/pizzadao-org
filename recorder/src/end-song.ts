/**
 * End-of-call song trigger. Metalhead never plays audio itself: when a call really ends it asks the
 * separate pizza-radio bot (its own Discord user, its own voice connection) to play the crew's
 * theme song through its `/play-crew` endpoint (Bearer API key, body `{ crew }`).
 *
 * Fire-and-forget: a failure here must never block finalize. Each call occurrence fires at most
 * once; the marker is persisted so a restart does not replay it.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

export const PLAY_CREW_TIMEOUT_MS = 5_000
/** Markers older than this are forgotten (longer than any gap between occurrences we care about). */
export const MARKER_KEEP_MS = 3 * 86_400_000

/**
 * Stop reasons that mean "the call is over and people may still be here". Not max-duration: that is the
 * recording cap, the call itself may carry on. The other trigger is the scheduled end passing (recorder.ts).
 */
export const END_SONG_STOP_REASONS = ['event-ended'] as const

/** What happened to a /play-crew request: accepted, refused for good (4xx), or unreachable / 5xx after the retry. */
export type PlayCrewOutcome = 'ok' | 'rejected' | 'failed'

export function isEndSongStop(reason: string): boolean {
  return (END_SONG_STOP_REASONS as readonly string[]).includes(reason)
}

/** POST /play-crew with one retry on a network error or 5xx. `channelId` is the voice channel to play in. */
export async function postPlayCrew(
  baseUrl: string,
  apiKey: string,
  crew: string,
  channelId: string | null,
  log: (msg: string) => void,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<PlayCrewOutcome> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/play-crew`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(channelId ? { crew, channelId } : { crew }),
        signal: AbortSignal.timeout(PLAY_CREW_TIMEOUT_MS),
      })
      if (res.ok) return 'ok'
      log(`end song: pizza-radio answered ${res.status}`)
      if (res.status < 500) return 'rejected' // a bad crew name or key will not fix itself
    } catch (err) {
      log(`end song: request failed (${err instanceof Error ? err.message : String(err)})`)
    }
    if (attempt === 0) await sleep(1_000)
  }
  return 'failed'
}

/** Which call occurrences already played their song (persisted in DATA_DIR). */
export class EndSongMarker {
  private entries: Record<string, number> = {}

  constructor(
    private readonly file: string,
    private readonly log: (msg: string) => void,
  ) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.entries = parsed as Record<string, number>
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log(`could not read ${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  has(key: string): boolean {
    return key in this.entries
  }

  /** Remember an occurrence as fired (before the request, so a crash cannot replay it). */
  mark(key: string, nowMs: number): void {
    this.entries[key] = nowMs
    for (const [k, at] of Object.entries(this.entries)) if (nowMs - at > MARKER_KEEP_MS) delete this.entries[k]
    try {
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.entries))
      renameSync(tmp, this.file)
    } catch (err) {
      this.log(`could not save ${this.file}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
