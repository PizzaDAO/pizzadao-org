'use client'

/**
 * The random send delay. A tapped vote is queued in localStorage and sent after a random wait, so server request logs
 * (IP + time) cannot pair "token fetched at T1" with "vote submitted at T2". The queue holds only the proposal id, the
 * choice, the send time and the close time; the token itself stays in its own ballot key (client.ts).
 *
 *  - one entry per proposal: tapping again before it is sent replaces the choice (no extra request, same send time);
 *  - all times are in the SERVER's clock (serverNow()), so a wrong device clock cannot push a send past the close;
 *  - never later than CLOSE_MARGIN_MS before voting closes (inside the margin: send at once);
 *  - flushDue() sends what is due and runs from the global ballot preparer on every page, under a cross-tab lock;
 *  - on pagehide (not a tab switch), only votes whose proposal closes within PAGEHIDE_SEND_WITHIN_MS are sent (keepalive);
 *  - nothing is dropped silently: a vote that cannot be sent leaves a "failed" record the vote panel shows.
 */
import { castVote, loadBallot, saveBallot, serverNow, type Choice } from './client'

export const QUEUE_KEY = 'pizzadao:proposal-vote-queue'
export const FAILED_KEY = 'pizzadao:proposal-vote-failed'
export const LEASE_KEY = 'pizzadao:proposal-vote-lease'
export const LOCK_NAME = 'pizzadao-proposal-vote-flush'
export const QUEUE_EVENT = 'pizzadao:vote-queue-changed'
export const CLOSE_MARGIN_MS = 5 * 60 * 1000
export const PAGEHIDE_SEND_WITHIN_MS = 30 * 60 * 1000
export const RETRY_MS = 60 * 1000
const LEASE_MS = 30 * 1000
/** The device clock may be off and unsynced: only fail locally as closed this long after closesAt; before that the server's 409 decides. */
export const LOCAL_CLOSE_GRACE_MS = 60 * 1000
export const FAILED_MAX_AGE_MS = 14 * 24 * 3600 * 1000

export interface QueuedVote {
  id: string
  choice: Choice
  /** ms epoch, server clock */
  sendAt: number
  /** ms epoch, or null when unknown */
  closesAt: number | null
}

/** Why a vote did not go: voting is over ('closed', also when the close passed before it could be sent) or the server refused it ('invalid'). */
export interface FailedVote {
  choice: Choice
  reason: 'closed' | 'invalid'
  /** ms epoch the failure was recorded */
  at?: number
}

const CHOICES = ['AYE', 'NAY', 'ABSTAIN']

function notify(): void {
  try {
    window.dispatchEvent(new Event(QUEUE_EVENT))
  } catch {
    /* no window */
  }
}

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
  notify()
}

function readFailed(): Record<string, FailedVote> {
  try {
    const o = JSON.parse(localStorage.getItem(FAILED_KEY) || '{}') as unknown
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, FailedVote>) : {}
  } catch {
    return {}
  }
}

function writeFailed(m: Record<string, FailedVote>): void {
  try {
    localStorage.setItem(FAILED_KEY, JSON.stringify(m))
  } catch {
    /* blocked storage */
  }
  notify()
}

/** Failed records (id -> record), without the ones older than 14 days (those are removed). */
export function listFailed(): Array<{ id: string } & FailedVote> {
  const m = readFailed()
  const keep: Record<string, FailedVote> = {}
  let pruned = false
  for (const [id, f] of Object.entries(m)) {
    if (typeof f?.at === 'number' && Date.now() - f.at > FAILED_MAX_AGE_MS) pruned = true
    else keep[id] = f
  }
  if (pruned) writeFailed(keep)
  return Object.entries(keep)
    .filter(([, f]) => f && CHOICES.includes(f.choice) && (f.reason === 'closed' || f.reason === 'invalid'))
    .map(([id, f]) => ({ id, ...f }))
}

export function getFailed(id: string): FailedVote | null {
  const f = readFailed()[id]
  return f && CHOICES.includes(f.choice) && (f.reason === 'closed' || f.reason === 'invalid') ? f : null
}

export function clearFailed(id: string): void {
  const m = readFailed()
  if (!(id in m)) return
  delete m[id]
  writeFailed(m)
}

function fail(q: QueuedVote, reason: FailedVote['reason']): void {
  writeFailed({ ...readFailed(), [q.id]: { choice: q.choice, reason, at: Date.now() } })
  dropQueued(q.id)
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

/** The retry time after a failed attempt: a minute on, but still before the close margin; already inside it: now. */
export function retryAt(now: number, closesAt: number | null): number {
  const at = now + RETRY_MS
  if (closesAt === null) return at
  const latest = closesAt - CLOSE_MARGIN_MS
  return latest <= now ? now : Math.min(at, latest)
}

/**
 * Queue (or replace) the member's vote. Returns the entry, or null when storage is unavailable (the caller then sends at once).
 * A replacement keeps the send time already drawn, so re-tapping never reveals anything or adds a request.
 */
export function queueVote(
  id: string,
  choice: Choice,
  opts: { minSeconds: number; maxSeconds: number; closesAt: string | null },
  now: number = serverNow(),
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
  clearFailed(id)
  writeAll([...list.filter((q) => q.id !== id), entry])
  return getQueued(id)
}

export function dropQueued(id: string): void {
  writeAll(readAll().filter((q) => q.id !== id))
}

/** "Send now": the member trades the privacy of the delay for certainty. Sends at once. */
export async function sendNow(id: string, now: number = serverNow()): Promise<void> {
  writeAll(readAll().map((q) => (q.id === id ? { ...q, sendAt: now } : q)))
  await flushDue(now)
}

// ---- one flusher at a time, across tabs ----

let held = false // this tab is flushing

/**
 * Runs fn when no other flush (this tab or another) is running; otherwise skips it. Uses the Web Locks API where there
 * is one, else a localStorage lease. A skipped caller never touches the holder's state.
 */
export async function withFlushLock(fn: () => Promise<void>): Promise<void> {
  if (held) return
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  if (locks && typeof locks.request === 'function') {
    try {
      await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock || held) return
        held = true
        try {
          await fn()
        } finally {
          held = false
        }
      })
      return
    } catch {
      /* fall back to the lease below */
    }
  }
  const me = `${Date.now()}-${Math.random()}`
  try {
    const cur = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null') as { owner?: string; until?: number } | null
    if (cur && typeof cur.until === 'number' && cur.until > Date.now()) return
    localStorage.setItem(LEASE_KEY, JSON.stringify({ owner: me, until: Date.now() + LEASE_MS }))
    // Re-read: if another tab wrote at the same moment, only the last writer proceeds.
    const check = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null') as { owner?: string } | null
    if (check?.owner !== me) return
  } catch {
    /* storage blocked: nothing is queued either, so there is nothing to protect */
  }
  held = true
  try {
    await fn()
  } finally {
    held = false
    try {
      const cur = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null') as { owner?: string } | null
      if (cur?.owner === me) localStorage.removeItem(LEASE_KEY)
    } catch {
      /* ignore */
    }
  }
}

/** Settle one queued vote after its send attempt. */
function settle(q: QueuedVote, outcome: Awaited<ReturnType<typeof castVote>>, now: number): void {
  const latest = getQueued(q.id)
  if (outcome === 'ok') {
    const b = loadBallot(q.id)
    if (b) saveBallot(q.id, { ...b, choice: q.choice })
    if (!latest || latest.choice === q.choice) dropQueued(q.id)
    else writeAll(readAll().map((x) => (x.id === q.id ? { ...x, sendAt: Math.max(x.sendAt, now) } : x)))
  } else if (outcome === 'closed' || outcome === 'invalid') {
    fail(q, outcome)
  } else {
    // Network error, timeout, rate limit, server error or a 404 (feature off for now): keep it and try again shortly.
    writeAll(readAll().map((x) => (x.id === q.id ? { ...x, sendAt: retryAt(now, x.closesAt) } : x)))
  }
}

/** Send every queued vote that is due. Never throws. */
export async function flushDue(now: number = serverNow()): Promise<void> {
  try {
    // Nothing due: do not take the lock at all.
    if (!readAll().some((q) => q.sendAt <= now)) return
    await withFlushLock(async () => {
      for (const q of readAll()) {
        if (q.sendAt > now) continue
        // Fail locally only well after the close (the device clock may be off); otherwise the server's 409 decides.
        if (q.closesAt !== null && now > q.closesAt + LOCAL_CLOSE_GRACE_MS) {
          fail(q, 'closed')
          continue
        }
        const ballot = loadBallot(q.id)
        if (!ballot) {
          fail(q, 'invalid')
          continue
        }
        settle(q, await castVote(q.id, ballot, q.choice), now)
      }
    })
  } catch {
    /* silent: this runs on every page */
  }
}

/**
 * Real pagehide only (not a tab switch): send at once what closes within 30 minutes; the rest stays queued for the next
 * visit. The fetch (keepalive) must start synchronously inside the event handler, so this takes no lock and ignores
 * `held`: a duplicate send of the same choice is harmless (the server replaces the choice for the same token).
 */
export function flushOnPageHide(now: number = serverNow()): Promise<void> {
  const sends: Promise<void>[] = []
  try {
    for (const q of readAll()) {
      if (q.closesAt === null || q.closesAt - now > PAGEHIDE_SEND_WITHIN_MS || now > q.closesAt + LOCAL_CLOSE_GRACE_MS) continue
      const ballot = loadBallot(q.id)
      if (!ballot) continue
      sends.push(castVote(q.id, ballot, q.choice, { keepalive: true }).then((o) => settle(q, o, now)))
    }
  } catch {
    /* silent */
  }
  return Promise.all(sends).then(() => {})
}
