// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMemberIdByDiscordId = vi.fn()
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberIdByDiscordId: (...a: unknown[]) => fetchMemberIdByDiscordId(...a) }))

import { memberIdForLanes, FRESH_RETRY_MS, FRESH_HIT_MS, __resetLaneFreshRetries } from './member'

beforeEach(() => {
  vi.clearAllMocks()
  __resetLaneFreshRetries()
})

describe('memberIdForLanes', () => {
  it('uses the cached member id without a second read', async () => {
    fetchMemberIdByDiscordId.mockResolvedValueOnce('42')
    expect(await memberIdForLanes('d1')).toBe('42')
    expect(fetchMemberIdByDiscordId).toHaveBeenCalledTimes(1)
  })

  it('retries a cache miss with a fresh read, so a member created a moment ago is found', async () => {
    fetchMemberIdByDiscordId.mockResolvedValueOnce(null).mockResolvedValueOnce('77')
    expect(await memberIdForLanes('d1')).toBe('77')
    expect(fetchMemberIdByDiscordId).toHaveBeenLastCalledWith('d1', { fresh: true })
  })

  it('is null when both reads miss or fail, and never throws', async () => {
    fetchMemberIdByDiscordId.mockResolvedValue(null)
    expect(await memberIdForLanes('d1')).toBeNull()
    fetchMemberIdByDiscordId.mockRejectedValue(new Error('sheet down'))
    expect(await memberIdForLanes('d1')).toBeNull()
  })

  it('throttles the fresh retry per Discord id, then allows it again after the window', async () => {
    fetchMemberIdByDiscordId.mockResolvedValue(null)
    const t = 1_000_000
    await memberIdForLanes('d1', t)
    await memberIdForLanes('d1', t + 1000)
    const fresh = () => fetchMemberIdByDiscordId.mock.calls.filter((c) => c[1]?.fresh).length
    expect(fresh()).toBe(1)
    await memberIdForLanes('d2', t + 1000)
    expect(fresh()).toBe(2)
    await memberIdForLanes('d1', t + FRESH_RETRY_MS + 1)
    expect(fresh()).toBe(3)
  })
  it('remembers a fresh hit, so the pin and ticks right after signup still find the member', async () => {
    const t = 2_000_000
    // Cached read lags (miss), fresh read finds the new member.
    fetchMemberIdByDiscordId.mockImplementation((_id: string, o?: { fresh?: boolean }) => Promise.resolve(o?.fresh ? '88' : null))
    expect(await memberIdForLanes('d3', t)).toBe('88')
    // Inside the retry window the cache still lags: no redirect to /join, and no extra fresh read.
    fetchMemberIdByDiscordId.mockClear()
    fetchMemberIdByDiscordId.mockResolvedValue(null)
    expect(await memberIdForLanes('d3', t + 1000)).toBe('88')
    expect(fetchMemberIdByDiscordId.mock.calls.filter((c) => c[1]?.fresh)).toHaveLength(0)
    // The remembered hit expires; then a miss throttles as before.
    expect(await memberIdForLanes('d3', t + FRESH_HIT_MS + 1)).toBeNull()
  })
})
