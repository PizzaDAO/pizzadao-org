// @vitest-environment node
// The delayed-vote queue: a vote made soon after the token was fetched waits, so token and vote are far apart in time.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CLOSE_MARGIN_MS, MAX_EXTRA_DELAY_MS, MIN_TOKEN_AGE_MS, planVoteSend } from './queue'

const MIN = 60_000
const now = 1_000_000_000_000

describe('planVoteSend', () => {
  it('a young token waits until it is 30 minutes old, plus a random delay', () => {
    const young = planVoteSend({ now, preparedAt: now - 2 * MIN, closesAt: now + 7 * 24 * 60 * MIN, rand: 0 })
    expect(young.immediate).toBe(false)
    expect(young.sendAt).toBe(now - 2 * MIN + MIN_TOKEN_AGE_MS)
    const later = planVoteSend({ now, preparedAt: now - 2 * MIN, closesAt: null, rand: 0.999 })
    expect(later.sendAt).toBeGreaterThan(young.sendAt)
    expect(later.sendAt).toBeLessThanOrEqual(now - 2 * MIN + MIN_TOKEN_AGE_MS + MAX_EXTRA_DELAY_MS)
  })

  it('a vote made right after the token (gap of seconds) is never sent immediately', () => {
    for (const rand of [0, 0.3, 0.99]) {
      const p = planVoteSend({ now, preparedAt: now - 3_000, closesAt: null, rand })
      expect(p.immediate).toBe(false)
      expect(p.sendAt - (now - 3_000)).toBeGreaterThanOrEqual(MIN_TOKEN_AGE_MS)
    }
  })

  it('an old token, or a restored ballot, is sent at once', () => {
    expect(planVoteSend({ now, preparedAt: now - 31 * MIN, closesAt: null, rand: 0.5 }).immediate).toBe(true)
    expect(planVoteSend({ now, preparedAt: 0, closesAt: null, rand: 0.5 }).immediate).toBe(true)
  })

  it('never holds a vote past the close', () => {
    const closesAt = now + 10 * MIN
    const p = planVoteSend({ now, preparedAt: now - MIN, closesAt, rand: 0.9 })
    expect(p.sendAt).toBeLessThanOrEqual(closesAt - CLOSE_MARGIN_MS)
    const tooLate = planVoteSend({ now, preparedAt: now - MIN, closesAt: now + MIN, rand: 0.9 })
    expect(tooLate.immediate).toBe(true)
  })
})

// The browser module on top of it: queue in localStorage, send later.
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  // Object.keys(localStorage) in flushQueuedVotes: expose stored keys as own properties.
  vi.stubGlobal('localStorage', new Proxy({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Record<string, unknown>, {
    ownKeys: () => [...store.keys()],
    getOwnPropertyDescriptor: (_t, k) => (store.has(String(k)) ? { enumerable: true, configurable: true, value: store.get(String(k)) } : undefined),
    get: (t, k) => (k in t ? t[k as string] : store.get(String(k))),
  }))
})

describe('submitVote / flushQueuedVotes', () => {
  const ballot = { token: 'proposal-p1-abc', preparedMessage: 'AA', signature: 'BB' }

  it('queues a vote on a young token, sends nothing, and sends it later when due', async () => {
    const { submitVote, flushQueuedVotes, loadBallot } = await import('./client')
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    const t = Date.now()
    const r = await submitVote('p1', { ...ballot, preparedAt: t - 10_000 }, 'AYE', null, t)
    expect(r.outcome).toBe('queued')
    expect(fetchMock).not.toHaveBeenCalled()
    const queued = loadBallot('p1')!.queued!
    expect(queued.choice).toBe('AYE')
    expect(queued.sendAt - t).toBeGreaterThanOrEqual(MIN_TOKEN_AGE_MS - 10_000)

    expect(await flushQueuedVotes(queued.sendAt - 1)).toEqual([]) // not yet
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await flushQueuedVotes(queued.sendAt)).toEqual(['p1']) // next visit after the time
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/proposals/p1/vote')
    // The vote carries no cookies and no referrer.
    expect(init.credentials).toBe('omit')
    expect(init.referrerPolicy).toBe('no-referrer')
    expect(loadBallot('p1')!.queued).toBeUndefined()
    expect(loadBallot('p1')!.choice).toBe('AYE')
  })

  it('a changed mind replaces the queued choice', async () => {
    const { submitVote, loadBallot } = await import('./client')
    vi.stubGlobal('fetch', vi.fn())
    const t = Date.now()
    const first = await submitVote('p1', { ...ballot, preparedAt: t - 1000 }, 'AYE', null, t)
    await submitVote('p1', first.ballot, 'NAY', null, t + 1000)
    expect(loadBallot('p1')!.queued!.choice).toBe('NAY')
  })

  it('an old token is sent straight away', async () => {
    const { submitVote } = await import('./client')
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    const t = Date.now()
    const r = await submitVote('p1', { ...ballot, preparedAt: t - 60 * MIN }, 'ABSTAIN', null, t)
    expect(r.outcome).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
