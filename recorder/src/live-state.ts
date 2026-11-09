/**
 * Live state for the app's /calls/live page: a heartbeat (POST /api/calls/recorder/live-state) with who
 * is in the channel (humans only, minutes so far), the stream link once someone posts one in the call
 * chat, and `ended` at stop. Sent every livePushSeconds (remote config), and about 3 s after a join or
 * leave. Fire and forget: every failure is logged and dropped, the timeout is short, and nothing here
 * can block or fail the recording. The app answers 204 when the live view is off: then it stays quiet
 * for a while.
 *
 * Keep the body in sync with app/lib/calls/live-state.ts.
 */

export interface LivePresenceEntry {
  discordId: string
  displayName: string | null
  presentSec: number
  inChannel: boolean
}

export interface LiveStateBody {
  sessionId: string
  eventId: string | null
  eventName: string | null
  channelId: string
  startedAt: string
  present: LivePresenceEntry[]
  streamLink?: string | null
  ended?: boolean
}

export const MAX_PRESENCE = 300
export const LIVE_STATE_TIMEOUT_MS = 5_000
/** A join or leave is sent after this short delay (several at once go out together). */
export const CHANGE_DEBOUNCE_MS = 3_000
/** After the app says the live view is off, ask again this much later. */
export const OFF_RETRY_MS = 5 * 60_000
/** A failed member name lookup is not repeated for this long. */
export const NAME_RETRY_MS = 5 * 60_000

/** Adds up each person's time in the channel from successive snapshots of who is there. */
export class PresenceClock {
  private readonly secMs = new Map<string, number>()
  private readonly here = new Set<string>()
  private lastMs: number | null = null
  readonly names = new Map<string, string>()
  private readonly nameRetryAt = new Map<string, number>()

  /** The humans in the channel at `nowMs`. The time since the last snapshot goes to those who were here. */
  update(ids: readonly string[], nowMs: number): boolean {
    this.advance(nowMs)
    const next = new Set(ids)
    let changed = next.size !== this.here.size
    for (const id of next) if (!this.here.has(id)) changed = true
    for (const id of next) if (!this.secMs.has(id)) this.secMs.set(id, 0)
    this.here.clear()
    for (const id of next) this.here.add(id)
    return changed
  }

  private advance(nowMs: number): void {
    if (this.lastMs !== null && nowMs > this.lastMs) {
      for (const id of this.here) this.secMs.set(id, (this.secMs.get(id) ?? 0) + (nowMs - this.lastMs))
    }
    this.lastMs = nowMs
  }

  snapshot(nowMs: number): LivePresenceEntry[] {
    this.advance(nowMs)
    const all = [...this.secMs.entries()].map(([id, ms]) => ({
      discordId: id,
      displayName: this.names.get(id) ?? null,
      presentSec: Math.min(86_400, Math.floor(ms / 1000)),
      inChannel: this.here.has(id),
    }))
    // People still here first, so the cap never drops them.
    return all.sort((a, b) => Number(b.inChannel) - Number(a.inChannel) || b.presentSec - a.presentSec).slice(0, MAX_PRESENCE)
  }

  /** People in the channel whose name is still unknown and not waiting out a failed lookup. */
  missingNames(nowMs: number): string[] {
    return [...this.here].filter((id) => !this.names.has(id) && (this.nameRetryAt.get(id) ?? 0) <= nowMs)
  }

  /** A name lookup failed: do not try this person again for a while. */
  nameFailed(id: string, nowMs: number): void {
    this.nameRetryAt.set(id, nowMs + NAME_RETRY_MS)
  }
}

/** A broadcast link beats a status link. */
export const isBroadcastLink = (link: string | null | undefined): boolean => !!link && link.includes('/i/broadcasts/')

/** The normalized link for an x.com or twitter.com broadcast or status URL, or null. */
export function normalizeStreamLink(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  if (!/^(www\.|mobile\.)?(x|twitter)\.com$/i.test(u.hostname)) return null
  const ok = /^\/i\/broadcasts\/[A-Za-z0-9]+\/?$/.test(u.pathname) || /^\/[A-Za-z0-9_]{1,15}\/status\/\d+\/?$/.test(u.pathname)
  return ok ? `https://${u.hostname.toLowerCase()}${u.pathname}` : null
}

/** The best x.com / twitter.com link in a chat message (a broadcast link first, else the first status link), or null. */
export function findStreamLink(text: string): string | null {
  let best: string | null = null
  for (const m of text.matchAll(/https?:\/\/[^\s<>()"']+/gi)) {
    const hit = normalizeStreamLink(m[0].replace(/[.,;:!?]+$/, ''))
    if (hit && (!best || (!isBroadcastLink(best) && isBroadcastLink(hit)))) best = hit
  }
  return best
}

export type PostResult = 'ok' | 'off' | 'error'

/** POST to the app. Never throws. */
export async function postLiveState(
  appBaseUrl: string,
  apiKey: string,
  body: LiveStateBody,
  log: (msg: string) => void,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = LIVE_STATE_TIMEOUT_MS,
): Promise<PostResult> {
  try {
    const res = await fetchImpl(`${appBaseUrl}/api/calls/recorder/live-state`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 204) return 'off'
    if (!res.ok) {
      log(`live state: app answered ${res.status}`)
      return 'error'
    }
    return 'ok'
  } catch (err) {
    log(`live state: request failed (${err instanceof Error ? err.message : String(err)})`)
    return 'error'
  }
}

export interface LiveStatePusherDeps {
  sessionId: string
  eventId: string | null
  eventName: string | null
  channelId: string
  startedAtMs: number
  pushSeconds: number
  post: (body: LiveStateBody) => Promise<PostResult>
  now?: () => number
}

export class LiveStatePusher {
  readonly clock = new PresenceClock()
  private timer: NodeJS.Timeout | null = null
  private debounce: NodeJS.Timeout | null = null
  private streamLink: string | null = null
  private pausedUntil = 0
  private stopped = false
  private sending = false
  private again = false
  private readonly now: () => number

  constructor(private readonly d: LiveStatePusherDeps) {
    this.now = d.now ?? Date.now
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.push(), this.d.pushSeconds * 1000)
    this.timer.unref?.()
    void this.push()
  }

  /** Who is in the channel now. A join or leave is pushed soon, debounced. */
  setPresent(ids: readonly string[]): void {
    if (this.stopped) return
    if (this.clock.update(ids, this.now()) && !this.debounce) {
      this.debounce = setTimeout(() => {
        this.debounce = null
        void this.push()
      }, CHANGE_DEBOUNCE_MS)
      this.debounce.unref?.()
    }
  }

  /** A chat message: the first stream link in the call chat is kept, except that a broadcast link replaces a status link. */
  onChat(text: string): void {
    if (this.stopped) return
    const link = findStreamLink(text)
    if (!link) return
    if (this.streamLink && !(isBroadcastLink(link) && !isBroadcastLink(this.streamLink))) return
    this.streamLink = link
    void this.push()
  }

  get link(): string | null {
    return this.streamLink
  }

  private body(ended: boolean): LiveStateBody {
    return {
      sessionId: this.d.sessionId,
      eventId: this.d.eventId,
      eventName: this.d.eventName,
      channelId: this.d.channelId,
      startedAt: new Date(this.d.startedAtMs).toISOString(),
      present: this.clock.snapshot(this.now()),
      ...(this.streamLink ? { streamLink: this.streamLink } : {}),
      ...(ended ? { ended: true } : {}),
    }
  }

  private async push(): Promise<void> {
    if (this.stopped || this.now() < this.pausedUntil) return
    // One request at a time; a change that arrives meanwhile is sent right after.
    if (this.sending) {
      this.again = true
      return
    }
    this.sending = true
    try {
      if ((await this.d.post(this.body(false))) === 'off') this.pausedUntil = this.now() + OFF_RETRY_MS
    } finally {
      this.sending = false
    }
    if (this.again) {
      this.again = false
      await this.push()
    }
  }

  /** Stop the heartbeat and tell the app the call ended (one last, short attempt). Safe to call twice. */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    if (this.debounce) clearTimeout(this.debounce)
    this.timer = null
    this.debounce = null
    await this.d.post(this.body(true))
  }
}
