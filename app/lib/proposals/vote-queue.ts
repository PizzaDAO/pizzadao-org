'use client'

/**
 * The random send delay. A tapped vote is queued in localStorage and sent after a random wait, so server request logs
 * (IP + time) cannot pair "token fetched at T1" with "vote submitted at T2". The queue holds only the proposal id, the
 * choice, the send time and the close time; the token itself stays in its own ballot key (client.ts).
 *
 *  - one entry per proposal: tapping again before it is sent replaces the choice (no extra request, same send time);
 *  - never later than CLOSE_MARGIN_MS before voting closes (inside the margin: send at once);
 *  - flushDue() sends what is due and runs from the global ballot preparer on every page;
 *  - on pagehide, only votes whose proposal closes within PAGEHIDE_SEND_WITHIN_MS are sent (keepalive); others stay queued.
 */
import { castVote, loadBallot, saveBallot, type Choice } from './client'

export const QUEUE_KEY = 'pizzadao:proposal-vote-queue'
export const QUEUE_EVENT = 'pizzadao:vote-queue-changed'
export const CLOSE_MARGIN_MS = 2 * 60 * 1000
export const PAGEHIDE_SEND_WITHIN_MS = 30 * 60 * 1000
const RETRY_MS = 60 * 1000

export interface QueuedVote {
  id: string
  choice: Choice
  /** ms epoch */
  sendAt: number
  /** ms epoch, or null when unknown */
  closesAt: number | null
}

const CHOICES = ['AYE', 'NAY', 'ABSTAIN']

function readAll(): QueuedVote[] {
  try {
    const raw = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (x): x is QueuedVote =>
        !!x && typeof x.id === 'string' && CHOICES.includes(x.choice) && Number.isFinite(x.sendAt) && (x.closesAt === null || Number.isFinite(x.closesAt)),
    )
  } catch {
    return []
  }
}

function writeAll(list: QueuedVote[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list))
  } catch {
    /* blocked storage: the vote cannot be queued; callers fall back to sending at once */
  }
  try {
    window.dispatchEvent(new Event(QUEUE_EVENT))
  } catch {
    /* no window */
  }
}

export function getQueued(id: string): QueuedVote | null {
  return readAll().find((q) => q.id === id) ?? null
}

/** Normalised delay bounds in seconds: clamped to 0..3600, and max never below min. */
export function delayBounds(minS: number, maxS: number): { min: number; max: number } {
  const clamp = (n: number) => (Number.isFinite(n) ? Math.min(3600, Math.max(0, n)) : 0)
  const min = clamp(minS)
  return { min, max: Math.max(min, clamp(maxS)) }
}

/** When to send: uniformly in [min, max] seconds from now, but by (closesAt - margin) at the latest. */
export function computeSendAt(now: number, minS: number, maxS: number, closesAt: number | null, rand: () => number = Math.random): number {
  const { min, max } = delayBounds(minS, maxS)
  let sendAt = now + (min + rand() * (max - min)) * 1000
  if (closesAt !== null) {
    const latest = closesAt - CLOSE_MARGIN_MS
    if (sendAt > latest) sendAt = latest <= now ? now : now + rand() * (latest - now)
  }
  return Math.round(sendAt)
}

/**
 * Queue (or replace) the member's vote. Returns the entry, or null when storage is unavailable (the caller then sends at once).
 * A replacement keeps the send time already drawn, so re-tapping never reveals anything or adds a request.
 */
export function queueVote(
  id: string,
  choice: Choice,
  opts: { minSeconds: number; maxSeconds: number; closesAt: string | null },
  now: number = Date.now(),
  rand: () => number = Math.random,
): QueuedVote | null {
  const closesAt = opts.closesAt ? Date.parse(opts.closesAt) : NaN
  const closes = Number.isFinite(closesAt) ? closesAt : null
  const list = readAll()
  const existing = list.find((q) => q.id === id)
  const entry: QueuedVote = {
    id,
    choice,
    sendAt: existing ? Math.min(existing.sendAt, closes !== null ? Math.max(now, closes - CLOSE_MARGIN_MS) : Infinity) : computeSendAt(now, opts.minSeconds, opts.maxSeconds, closes, rand),
    closesAt: closes,
  }
  writeAll([...list.filter((q) => q.id !== id), entry])
  return getQueued(id)
}

export function dropQueued(id: string): void {
  writeAll(readAll().filter((q) => q.id !== id))
}

let flushing = false

/** Send every queued vote that is due (or all whose proposal closes within `withinMs`, for page hide). Never throws. */
export async function flushDue(now: number = Date.now(), opts: { keepalive?: boolean; closingWithinMs?: number } = {}): Promise<void> {
  if (flushing && !opts.keepalive) return
  flushing = true
  try {
    for (const q of readAll()) {
      const due = opts.closingWithinMs !== undefined ? q.closesAt !== null && q.closesAt - now <= opts.closingWithinMs : q.sendAt <= now
      if (!due) continue
      if (q.closesAt !== null && q.closesAt <= now) {
        dropQueued(q.id) // voting is over: never send after the close
        continue
      }
      const ballot = loadBallot(q.id)
      if (!ballot) {
        dropQueued(q.id)
        continue
      }
      const outcome = await castVote(q.id, ballot, q.choice, { keepalive: opts.keepalive })
      // Re-read: the member may have changed the choice while this request was in flight.
      const now2 = getQueued(q.id)
      if (outcome === 'ok') {
        saveBallot(q.id, { ...(loadBallot(q.id) ?? ballot), choice: q.choice })
        if (!now2 || now2.choice === q.choice) dropQueued(q.id)
        else writeAll(readAll().map((x) => (x.id === q.id ? { ...x, sendAt: Math.max(x.sendAt, now) } : x)))
      } else if (outcome === 'closed' || outcome === 'invalid') {
        dropQueued(q.id)
      } else {
        // Network or server error: try again shortly (still before the close margin where possible).
        writeAll(readAll().map((x) => (x.id === q.id ? { ...x, sendAt: now + RETRY_MS } : x)))
      }
    }
  } catch {
    /* silent: this runs on every page */
  } finally {
    flushing = false
  }
}

/** pagehide: send at once only what closes within 30 minutes; the rest stays queued for the next visit. */
export function flushOnPageHide(now: number = Date.now()): Promise<void> {
  return flushDue(now, { keepalive: true, closingWithinMs: PAGEHIDE_SEND_WITHIN_MS })
}
