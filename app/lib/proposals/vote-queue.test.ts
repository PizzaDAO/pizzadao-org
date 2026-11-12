// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const castVote = vi.fn()
vi.mock('./client', async (orig) => ({ ...(await orig<typeof import('./client')>()), castVote: (...a: unknown[]) => castVote(...a) }))

import { saveBallot } from './client'
import { CLOSE_MARGIN_MS, computeSendAt, delayBounds, flushDue, flushOnPageHide, getQueued, queueVote, QUEUE_KEY } from './vote-queue'

const ID = 'abcdefgh12345678'
const NOW = Date.parse('2026-11-12T12:00:00Z')
const MIN = 60 * 1000
const opts = (closesAt: string | null) => ({ minSeconds: 60, maxSeconds: 600, closesAt })
const far = new Date(NOW + 7 * 24 * 60 * MIN).toISOString()

beforeEach(() => {
  localStorage.clear()
  castVote.mockReset()
  castVote.mockResolvedValue('ok')
  saveBallot(ID, { token: `proposal-${ID}-x`, preparedMessage: 'p', signature: 's' })
})
afterEach(() => localStorage.clear())

describe('delay draw', () => {
  it('is uniform within [min, max] seconds', () => {
    expect(computeSendAt(NOW, 60, 600, null, () => 0)).toBe(NOW + 60_000)
    expect(computeSendAt(NOW, 60, 600, null, () => 1)).toBe(NOW + 600_000)
    expect(computeSendAt(NOW, 60, 600, null, () => 0.5)).toBe(NOW + 330_000)
  })
  it('uses max for both when min > max, and clamps to 3600', () => {
    expect(delayBounds(500, 100)).toEqual({ min: 500, max: 500 })
    expect(delayBounds(0, 99999)).toEqual({ min: 0, max: 3600 })
  })
})

describe('queueing', () => {
  it('stores the choice and a send time in localStorage', () => {
    const q = queueVote(ID, 'AYE', opts(far), NOW, () => 0)
    expect(q).toMatchObject({ id: ID, choice: 'AYE', sendAt: NOW + 60_000 })
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!)).toHaveLength(1)
    expect(castVote).not.toHaveBeenCalled()
  })
  it('replaces a queued vote without a new request or a new draw', () => {
    queueVote(ID, 'AYE', opts(far), NOW, () => 0.5)
    const q = queueVote(ID, 'NAY', opts(far), NOW + 5000, () => 0.99)
    expect(q).toMatchObject({ choice: 'NAY', sendAt: NOW + 330_000 })
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!)).toHaveLength(1)
    expect(castVote).not.toHaveBeenCalled()
  })
  it('queues a change after sending with a fresh delay', async () => {
    queueVote(ID, 'AYE', opts(far), NOW, () => 0)
    await flushDue(NOW + 61_000)
    expect(castVote).toHaveBeenCalledTimes(1)
    expect(getQueued(ID)).toBeNull()
    const q = queueVote(ID, 'NAY', opts(far), NOW + 62_000, () => 1)
    expect(q?.sendAt).toBe(NOW + 62_000 + 600_000)
  })
})

describe('sending', () => {
  it('sends nothing before sendAt and the vote once due, then clears it', async () => {
    queueVote(ID, 'ABSTAIN', opts(far), NOW, () => 0)
    await flushDue(NOW + 30_000)
    expect(castVote).not.toHaveBeenCalled()
    await flushDue(NOW + 60_000)
    expect(castVote).toHaveBeenCalledTimes(1)
    expect(castVote.mock.calls[0][2]).toBe('ABSTAIN')
    expect(getQueued(ID)).toBeNull()
    expect(JSON.parse(localStorage.getItem(`pizzadao:proposal-ballot:${ID}`)!).choice).toBe('ABSTAIN')
  })
  it('sends a due vote left from an earlier visit (on mount)', async () => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([{ id: ID, choice: 'AYE', sendAt: NOW - 1000, closesAt: null }]))
    await flushDue(NOW)
    expect(castVote).toHaveBeenCalledTimes(1)
  })
  it('keeps the vote queued after a network error and retries later', async () => {
    castVote.mockResolvedValue('error')
    queueVote(ID, 'AYE', opts(far), NOW, () => 0)
    await flushDue(NOW + 60_000)
    expect(getQueued(ID)?.sendAt).toBeGreaterThan(NOW + 60_000)
  })
  it('never sends after the close', async () => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([{ id: ID, choice: 'AYE', sendAt: NOW - 1000, closesAt: NOW - 1 }]))
    await flushDue(NOW)
    expect(castVote).not.toHaveBeenCalled()
    expect(getQueued(ID)).toBeNull()
  })
})

describe('close-time clamping', () => {
  it('draws before closesAt minus the margin when the delay would pass it', () => {
    const closes = NOW + 10 * MIN
    for (const r of [0, 0.5, 1]) {
      const at = computeSendAt(NOW, 600, 3600, closes, () => r)
      expect(at).toBeGreaterThanOrEqual(NOW)
      expect(at).toBeLessThanOrEqual(closes - CLOSE_MARGIN_MS)
    }
  })
  it('sends immediately when already inside the margin', () => {
    expect(computeSendAt(NOW, 60, 600, NOW + MIN, () => 0.9)).toBe(NOW)
  })
  it('leaves the delay alone when the close is far away', () => {
    expect(computeSendAt(NOW, 60, 600, NOW + 7 * 24 * 60 * MIN, () => 0)).toBe(NOW + 60_000)
  })
  it('a replacement never moves past the margin either', () => {
    queueVote(ID, 'AYE', opts(far), NOW, () => 1) // sendAt = NOW + 10 min
    const closes = new Date(NOW + 5 * MIN).toISOString()
    const q = queueVote(ID, 'NAY', opts(closes), NOW, () => 1)
    expect(q!.sendAt).toBeLessThanOrEqual(NOW + 5 * MIN - CLOSE_MARGIN_MS)
  })
})

describe('page hide', () => {
  it('sends at once, with keepalive, only a vote whose proposal closes within 30 minutes', async () => {
    queueVote(ID, 'AYE', opts(new Date(NOW + 20 * MIN).toISOString()), NOW, () => 1)
    await flushOnPageHide(NOW)
    expect(castVote).toHaveBeenCalledTimes(1)
    expect(castVote.mock.calls[0][3]).toEqual({ keepalive: true })
  })
  it('keeps the vote queued when the close is further away', async () => {
    queueVote(ID, 'AYE', opts(new Date(NOW + 60 * MIN).toISOString()), NOW, () => 1)
    await flushOnPageHide(NOW)
    expect(castVote).not.toHaveBeenCalled()
    expect(getQueued(ID)).not.toBeNull()
  })
})
