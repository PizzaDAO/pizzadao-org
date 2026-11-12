// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const castVote = vi.fn()
vi.mock('./client', async (orig) => ({ ...(await orig<typeof import('./client')>()), castVote: (...a: unknown[]) => castVote(...a) }))

import { noteServerDate, saveBallot, serverNow } from './client'
import { CLOSE_MARGIN_MS, flushDue, flushOnPageHide, getFailed, getQueued, LEASE_KEY, queueVote, QUEUE_KEY, retryAt, sendNow } from './vote-queue'

const ID = 'abcdefgh12345678'
const NOW = Date.now()
const MIN = 60 * 1000
const opts = (closesAt: string | null) => ({ minSeconds: 60, maxSeconds: 600, closesAt })
const far = new Date(NOW + 7 * 24 * 60 * MIN).toISOString()
const seed = (sendAt: number, closesAt: number | null) =>
  localStorage.setItem(QUEUE_KEY, JSON.stringify([{ id: ID, choice: 'AYE', sendAt, closesAt }]))

beforeEach(() => {
  localStorage.clear()
  castVote.mockReset()
  castVote.mockResolvedValue('ok')
  saveBallot(ID, { token: `proposal-${ID}-x`, preparedMessage: 'p', signature: 's' })
})
afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  noteServerDate({ headers: { get: () => new Date().toUTCString() } })
})

describe('nothing is dropped silently', () => {
  it('records a failure when voting is closed (409)', async () => {
    castVote.mockResolvedValue('closed')
    seed(NOW - 1, NOW + 86_400_000)
    await flushDue(NOW)
    expect(getQueued(ID)).toBeNull()
    expect(getFailed(ID)).toMatchObject({ choice: 'AYE', reason: 'closed' })
  })
  it('records a failure when the server refuses the ballot (401/400)', async () => {
    castVote.mockResolvedValue('invalid')
    seed(NOW - 1, NOW + 86_400_000)
    await flushDue(NOW)
    expect(getFailed(ID)?.reason).toBe('invalid')
  })
  it('records "closed" for a vote still queued when the close passes', async () => {
    seed(NOW - 1, NOW - 2 * MIN)
    await flushDue(NOW)
    expect(castVote).not.toHaveBeenCalled()
    expect(getFailed(ID)?.reason).toBe('closed')
  })
  it('queueing again clears the failure', async () => {
    castVote.mockResolvedValue('closed')
    seed(NOW - 1, NOW + 86_400_000)
    await flushDue(NOW)
    queueVote(ID, 'NAY', opts(far), NOW)
    expect(getFailed(ID)).toBeNull()
  })
  it('a 404 (feature off) keeps the vote queued and retries', async () => {
    castVote.mockResolvedValue('unavailable')
    seed(NOW - 1, NOW + 86_400_000)
    await flushDue(NOW)
    expect(getQueued(ID)?.sendAt).toBe(NOW + MIN)
    expect(getFailed(ID)).toBeNull()
  })
})

describe('retry clamp', () => {
  it('retries in a minute when the close is far', () => {
    expect(retryAt(NOW, NOW + 86_400_000)).toBe(NOW + MIN)
  })
  it('never retries later than closesAt minus the margin', () => {
    expect(retryAt(NOW, NOW + CLOSE_MARGIN_MS + 20_000)).toBe(NOW + 20_000)
  })
  it('retries at once when already inside the margin', () => {
    expect(retryAt(NOW, NOW + MIN)).toBe(NOW)
  })
})

describe('clock skew', () => {
  it('uses the server clock, from the Date header', () => {
    const ahead = new Date(Date.now() + 10 * MIN).toUTCString()
    noteServerDate({ headers: { get: () => ahead } })
    expect(Math.abs(serverNow() - (Date.now() + 10 * MIN))).toBeLessThan(2000)
  })
  it('clamps a send against the server close when the device clock is behind', async () => {
    // Device is 10 min behind: the server says it is 10 min later than the device thinks.
    noteServerDate({ headers: { get: () => new Date(Date.now() + 10 * MIN).toUTCString() } })
    const closes = new Date(serverNow() + 8 * MIN).toISOString()
    const q = queueVote(ID, 'AYE', { minSeconds: 3600, maxSeconds: 3600, closesAt: closes })
    expect(q!.sendAt).toBeLessThanOrEqual(Date.parse(closes) - CLOSE_MARGIN_MS)
  })
})

describe('send now', () => {
  it('sends at once, whatever delay was drawn', async () => {
    queueVote(ID, 'AYE', opts(far), NOW, () => 1)
    await sendNow(ID, NOW)
    expect(castVote).toHaveBeenCalledTimes(1)
    expect(getQueued(ID)).toBeNull()
  })
})

describe('one flusher at a time', () => {
  it('skips the flush when another tab holds the Web Lock', async () => {
    vi.stubGlobal('navigator', { locks: { request: async (_n: string, _o: unknown, cb: (l: unknown) => Promise<void>) => cb(null) } })
    seed(NOW - 1, null)
    await flushDue(NOW)
    expect(castVote).not.toHaveBeenCalled()
    expect(getQueued(ID)).not.toBeNull()
  })
  it('flushes when the Web Lock is granted', async () => {
    vi.stubGlobal('navigator', { locks: { request: async (_n: string, _o: unknown, cb: (l: unknown) => Promise<void>) => cb({}) } })
    seed(NOW - 1, null)
    await flushDue(NOW)
    expect(castVote).toHaveBeenCalledTimes(1)
  })
  it('without Web Locks, a live lease held by another tab blocks the flush', async () => {
    vi.stubGlobal('navigator', {})
    localStorage.setItem(LEASE_KEY, JSON.stringify({ owner: 'other', until: Date.now() + 20_000 }))
    seed(NOW - 1, null)
    await flushDue(NOW)
    expect(castVote).not.toHaveBeenCalled()
  })
  it('without Web Locks, an expired lease is taken over and released after', async () => {
    vi.stubGlobal('navigator', {})
    localStorage.setItem(LEASE_KEY, JSON.stringify({ owner: 'other', until: Date.now() - 1 }))
    seed(NOW - 1, null)
    await flushDue(NOW)
    expect(castVote).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(LEASE_KEY)).toBeNull()
  })
  it('a pagehide flush during a running flush still sends, and does not release the other flush\'s guard', async () => {
    let release!: () => void
    castVote.mockImplementationOnce(() => new Promise((r) => (release = () => r('ok'))))
    vi.stubGlobal('navigator', {})
    seed(NOW - 1, NOW + 10 * MIN)
    const running = flushDue(NOW)
    await Promise.resolve()
    castVote.mockResolvedValueOnce('ok')
    await flushOnPageHide(NOW) // keepalive path ignores the guard
    expect(castVote).toHaveBeenCalledTimes(2)
    expect(castVote.mock.calls[1][3]).toEqual({ keepalive: true })
    // the first flush still holds the guard: a plain call is skipped
    seed(NOW - 1, NOW + 10 * MIN)
    await flushDue(NOW)
    expect(castVote).toHaveBeenCalledTimes(2)
    release()
    await running
    expect(getQueued(ID)).toBeNull()
  })
})

describe('pagehide starts the request synchronously', () => {
  it('calls castVote with keepalive inside the handler even when the Web Lock would grant later', () => {
    vi.stubGlobal('navigator', { locks: { request: () => new Promise(() => {}) } })
    seed(NOW + 10 * MIN, NOW + 10 * MIN)
    void flushOnPageHide(NOW)
    expect(castVote).toHaveBeenCalledTimes(1) // no await happened yet
    expect(castVote.mock.calls[0][3]).toEqual({ keepalive: true })
  })
})

describe('clock persistence and the close grace', () => {
  it('a due vote just past the close is still sent (the server decides)', async () => {
    seed(NOW - 1, NOW - 10_000)
    await flushDue(NOW)
    expect(castVote).toHaveBeenCalledTimes(1)
  })
  it('a 409 from the server then records the failure', async () => {
    castVote.mockResolvedValue('closed')
    seed(NOW - 1, NOW - 10_000)
    await flushDue(NOW)
    expect(getFailed(ID)?.reason).toBe('closed')
  })
})

describe('failed records', () => {
  it('prunes records older than 14 days', async () => {
    const { listFailed, FAILED_KEY } = await import('./vote-queue')
    localStorage.setItem(
      FAILED_KEY,
      JSON.stringify({ old: { choice: 'AYE', reason: 'closed', at: Date.now() - 15 * 86_400_000 }, fresh: { choice: 'NAY', reason: 'invalid', at: Date.now() } }),
    )
    expect(listFailed().map((f) => f.id)).toEqual(['fresh'])
    expect(Object.keys(JSON.parse(localStorage.getItem(FAILED_KEY)!))).toEqual(['fresh'])
  })
})
