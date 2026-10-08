import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  getGuildChannels,
  getGuildRoles,
  clearGuildChannelsCache,
  clearGuildRolesCache,
} from "./discord-channels"

const OPTS = { botToken: "test-token", guildId: "999" }
const TTL_MS_PLUS_ONE = 60 * 60 * 1000 + 1

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status })
}

describe("getGuildChannels / getGuildRoles negative cache", () => {
  beforeEach(() => {
    clearGuildChannelsCache()
    clearGuildRolesCache()
  })

  it("does not refetch within an hour of a success", async () => {
    const fetchImpl = vi.fn(async () => res(200, [{ id: "1", name: "general", type: 0 }]))
    const first = await getGuildChannels({ ...OPTS, now: 0, fetchImpl })
    const second = await getGuildChannels({ ...OPTS, now: 1000, fetchImpl })
    expect(first).toEqual(second)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("starts a short negative cache after a failed fetch, returning null without retrying", async () => {
    const fetchImpl = vi.fn(async () => res(500, { message: "down" }))
    const first = await getGuildChannels({ ...OPTS, now: 0, fetchImpl })
    expect(first).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    // 30s later, still within the ~60s negative-cache window: no new fetch.
    const second = await getGuildChannels({ ...OPTS, now: 30_000, fetchImpl })
    expect(second).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("retries after the negative-cache window elapses", async () => {
    const fetchImpl = vi.fn(async () => res(500, { message: "down" }))
    await getGuildChannels({ ...OPTS, now: 0, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    // 61s later, past the ~60s window: tries again.
    await getGuildChannels({ ...OPTS, now: 61_000, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("serves the stale list (not null) from the negative-cache window after an earlier success", async () => {
    const channels = [{ id: "1", name: "general", type: 0 }]
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res(200, channels)) // succeeds, cached
      .mockResolvedValue(res(500, { message: "down" })) // then the guild goes down

    const first = await getGuildChannels({ ...OPTS, now: 0, fetchImpl })
    expect(first).toEqual([{ id: "1", name: "general", type: 0, parent_id: null }])

    // Past the hour TTL, so a refresh is attempted and fails — still falls
    // back to the stale list, and starts the negative cache.
    const second = await getGuildChannels({ ...OPTS, now: TTL_MS_PLUS_ONE, fetchImpl })
    expect(second).toEqual(first)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    // Shortly after that failed refresh: still within the negative-cache
    // window, so no third fetch — but the stale list is still returned.
    const third = await getGuildChannels({ ...OPTS, now: TTL_MS_PLUS_ONE + 10_000, fetchImpl })
    expect(third).toEqual(first)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("applies the same negative-cache behavior to getGuildRoles", async () => {
    const fetchImpl = vi.fn(async () => res(500, { message: "down" }))
    const first = await getGuildRoles({ ...OPTS, now: 0, fetchImpl })
    expect(first).toBeNull()
    const second = await getGuildRoles({ ...OPTS, now: 10_000, fetchImpl })
    expect(second).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
