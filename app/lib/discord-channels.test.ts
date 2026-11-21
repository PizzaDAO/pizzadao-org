import { describe, it, expect, vi, beforeEach } from "vitest"

const snap = vi.hoisted(() => ({ read: vi.fn(async (..._a: unknown[]) => null as unknown), write: vi.fn(async (..._a: unknown[]) => {}) }))
vi.mock("./discord-guild-snapshot", () => ({ readGuildSnapshot: snap.read, writeGuildSnapshotLater: snap.write }))
import {
  getChannel,
  fetchChannel,
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

describe("getChannel / fetchChannel", () => {
  const ID = "1099323056012394556"

  it("getChannel includes the name, guild and permission overwrites", async () => {
    const ow = [{ id: "999", type: 0, allow: "0", deny: "1024" }]
    const fetchImpl = vi.fn(async () => res(200, { id: ID, name: "general", type: 0, guild_id: "999", permission_overwrites: ow }))
    expect(await getChannel(ID, { ...OPTS, fetchImpl })).toMatchObject({ id: ID, name: "general", guildId: "999", permissionOverwrites: ow })
  })

  it("fetchChannel reports Retry-After on a 429", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "7" } }))
    expect(await fetchChannel(ID, { ...OPTS, fetchImpl })).toEqual({ ok: false, status: 429, retryAfterMs: 7000 })
  })
})

describe("durable last-good snapshot", () => {
  beforeEach(() => {
    clearGuildChannelsCache()
    clearGuildRolesCache()
    snap.read.mockReset()
    snap.write.mockReset()
  })

  it("writes the list once when it changes, not on every refresh of an unchanged list", async () => {
    const fetchImpl = vi.fn(async () => res(200, [{ id: "1", name: "general", type: 0 }]))
    await getGuildChannels({ ...OPTS, now: 0, fetchImpl })
    await getGuildChannels({ ...OPTS, now: TTL_MS_PLUS_ONE, fetchImpl })
    expect(snap.write).toHaveBeenCalledTimes(1)
    expect(snap.write).toHaveBeenCalledWith("999", "channels", [{ id: "1", name: "general", type: 0, parent_id: null }])
    expect(snap.read).not.toHaveBeenCalled() // a healthy path never reads the database
  })

  it("serves the saved channels on a cold start when Discord fails, reading the database once", async () => {
    const saved = [{ id: "1", name: "general", type: 0, parent_id: null }]
    snap.read.mockResolvedValue(saved)
    const fetchImpl = vi.fn(async () => res(500, { message: "down" }))
    expect(await getGuildChannels({ ...OPTS, now: 0, fetchImpl })).toEqual(saved)
    expect(await getGuildChannels({ ...OPTS, now: 10_000, fetchImpl })).toEqual(saved)
    expect(snap.read).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("returns null when Discord fails and nothing was saved", async () => {
    snap.read.mockResolvedValue(null)
    const fetchImpl = vi.fn(async () => res(500, {}))
    expect(await getGuildChannels({ ...OPTS, now: 0, fetchImpl })).toBeNull()
  })

  it("does the same for roles", async () => {
    const saved = [{ id: "5", name: "Capo" }]
    snap.read.mockResolvedValue(saved)
    const fetchImpl = vi.fn(async () => res(500, {}))
    expect(await getGuildRoles({ ...OPTS, now: 0, fetchImpl })).toEqual(saved)
    expect(snap.read).toHaveBeenCalledWith("999", "roles")
  })

  it("tries a missing snapshot once per failure window, sharing concurrent reads", async () => {
    snap.read.mockResolvedValue(null)
    const fetchImpl = vi.fn(async () => res(500, {}))
    await Promise.all([getGuildChannels({ ...OPTS, now: 0, fetchImpl }), getGuildChannels({ ...OPTS, now: 1, fetchImpl })])
    await getGuildChannels({ ...OPTS, now: 20_000, fetchImpl })
    expect(snap.read).toHaveBeenCalledTimes(1)
    await getGuildChannels({ ...OPTS, now: 70_000, fetchImpl })
    expect(snap.read).toHaveBeenCalledTimes(2)
  })

  it("treats a throwing snapshot read as missing, once per window", async () => {
    snap.read.mockRejectedValue(new Error("db down"))
    const fetchImpl = vi.fn(async () => res(500, {}))
    expect(await getGuildRoles({ ...OPTS, now: 0, fetchImpl })).toBeNull()
    expect(await getGuildRoles({ ...OPTS, now: 5_000, fetchImpl })).toBeNull()
    expect(snap.read).toHaveBeenCalledTimes(1)
  })
})
