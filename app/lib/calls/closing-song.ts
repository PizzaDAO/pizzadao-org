/**
 * The closing-song button on /calls/live: asks the pizza-radio bot to play a crew song (setting
 * calls.closingSongCrew, default "Amore") in the live call's voice channel, via its /play-crew
 * endpoint. Production only (previews share the guild), and only when PIZZA_RADIO_URL and
 * PIZZA_RADIO_API_KEY are set. One play per call per minute, so a double click never queues twice.
 */
type Env = Record<string, string | undefined>

export const CLOSING_SONG_COOLDOWN_MS = 60_000
const lastPlayed = new Map<string, number>()

export type ClosingSongResult = 'ok' | 'not-configured' | 'cooldown' | 'rejected' | 'failed'

export function closingSongConfigured(env: Env = process.env): boolean {
  return env.VERCEL_ENV === 'production' && !!env.PIZZA_RADIO_URL?.trim() && !!env.PIZZA_RADIO_API_KEY?.trim()
}

export async function playClosingSong(
  a: { sessionId: string; channelId: string; crew: string },
  deps: { env?: Env; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<ClosingSongResult> {
  const env = deps.env ?? process.env
  if (!closingSongConfigured(env)) return 'not-configured'
  const now = deps.now ?? Date.now()
  const last = lastPlayed.get(a.sessionId)
  if (last !== undefined && now - last < CLOSING_SONG_COOLDOWN_MS) return 'cooldown'
  lastPlayed.set(a.sessionId, now)
  if (lastPlayed.size > 500) lastPlayed.clear()
  const base = (env.PIZZA_RADIO_URL ?? '').trim().replace(/\/+$/, '')
  try {
    const res = await (deps.fetchImpl ?? fetch)(`${base}/play-crew`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${(env.PIZZA_RADIO_API_KEY ?? '').trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ crew: a.crew, channelId: a.channelId }),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) return 'ok'
    lastPlayed.delete(a.sessionId)
    return res.status < 500 ? 'rejected' : 'failed'
  } catch {
    lastPlayed.delete(a.sessionId)
    return 'failed'
  }
}

export function clearClosingSongCooldowns(): void {
  lastPlayed.clear()
}
