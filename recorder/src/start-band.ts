/**
 * House band at the start of a call. Like the end-of-call song, Metalhead never plays audio: it asks the
 * pizza-radio bot to do it through `POST /play-band` (Bearer API key, body `{ channelId, maxSongs }`;
 * pizza-radio leaves after maxSongs songs). Fire-and-forget; a failure must never touch recording.
 * Once per call occurrence (the marker is the same persisted store as the end song, in its own file).
 * Plays at the scheduled start of the call, or at the start of the recording if that is later.
 */
export const PLAY_BAND_TIMEOUT_MS = 15_000
/** Extra minutes, on top of the switch-deferral cap, a session may start after the scheduled start and still play (only used when the marker file was lost). */
export const START_BAND_LATE_EXTRA_MINUTES = 15

export type PlayBandOutcome = 'ok' | 'rejected' | 'failed'

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Does this call appear in the configured list? A listed phrase matches when the event name CONTAINS it
 * (case-insensitive, whitespace collapsed; event names carry emoji, dates and "(Recorded)"), or when the
 * crew label equals it.
 */
export function matchesStartBand(calls: readonly string[], eventName: string | null | undefined, crewLabel?: string | null): boolean {
  const phrases = calls.map(norm).filter(Boolean)
  const name = typeof eventName === 'string' ? norm(eventName) : ''
  const label = typeof crewLabel === 'string' ? norm(crewLabel) : ''
  return phrases.some((p) => (name !== '' && name.includes(p)) || (label !== '' && label === p))
}

/** POST /play-band with one retry on a network error or 5xx. */
export async function postPlayBand(
  baseUrl: string,
  apiKey: string,
  channelId: string,
  maxSongs: number,
  log: (msg: string) => void,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<PlayBandOutcome> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/play-band`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, maxSongs }),
        signal: AbortSignal.timeout(PLAY_BAND_TIMEOUT_MS),
      })
      if (res.ok) return 'ok'
      log(`start band: pizza-radio answered ${res.status}`)
      if (res.status < 500) return 'rejected'
    } catch (err) {
      log(`start band: request failed (${err instanceof Error ? err.message : String(err)})`)
      // A timeout means the request may well have been received: do not ask twice.
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'failed'
    }
    if (attempt === 0) await sleep(1_000)
  }
  return 'failed'
}
