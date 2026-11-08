/**
 * House band at the start of a call. Like the end-of-call song, Metalhead never plays audio: it asks the
 * pizza-radio bot to do it through `POST /play-band` (Bearer API key, body `{ channelId, maxSongs }`;
 * pizza-radio leaves after maxSongs songs). Fire-and-forget; a failure must never touch recording.
 * Once per call occurrence (the marker is the same persisted store as the end song, in its own file).
 */
export const PLAY_BAND_TIMEOUT_MS = 5_000
/** A session that begins later than this after the scheduled start is a resume (restart), not the call start. */
export const START_BAND_LATE_MS = 10 * 60_000

export type PlayBandOutcome = 'ok' | 'rejected' | 'failed'

/** Does this call (event name or crew label) appear in the configured list? Case-insensitive, whole name. */
export function matchesStartBand(calls: readonly string[], ...names: (string | null | undefined)[]): boolean {
  const key = (s: string) => s.trim().toLowerCase()
  const wanted = new Set(calls.map(key).filter(Boolean))
  return names.some((n) => typeof n === 'string' && n.trim() !== '' && wanted.has(key(n)))
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
    }
    if (attempt === 0) await sleep(1_000)
  }
  return 'failed'
}
