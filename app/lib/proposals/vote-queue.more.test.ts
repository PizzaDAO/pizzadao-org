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
    expect(getFailed(ID)).toEqual({ choice: 'AYE', reason: 'closed' })
  })
  it('records a failure when the server refuses the ballot (401/400)', async () => {
    castVote.mockResolvedValue('invalid')
    seed(NOW - 1, NOW + 86_400_000)
    await flushDue(NOW)
    expect(getFailed(ID)?.reason).toBe('invalid')
  })
  it('records "closed" for a vote still queued when the close passes', async () => {
    seed(NOW - 1, NOW - 1)
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
  it('a pagehide flush during a running flush is skipped and does not release its guard', async () => {
    let release!: () => void
    castVote.mockImplementationOnce(() => new Promise((r) => (release = () => r('ok'))))
    vi.stubGlobal('navigator', {})
    seed(NOW - 1, NOW + 10 * MIN)
    const running = flushDue(NOW)
    await Promise.resolve()
    await flushOnPageHide(NOW) // skipped
    expect(castVote).toHaveBeenCalledTimes(1)
    // the first flush still holds the guard: a third call is also skipped
    await flushDue(NOW)
    expect(castVote).toHaveBeenCalledTimes(1)
    release()
    await running
    expect(getQueued(ID)).toBeNull()
  })
})
