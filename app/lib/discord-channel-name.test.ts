import { describe, it, expect, vi, beforeEach } from "vitest"

const kv = new Map<string, string>()
vi.mock("../api/lib/cache", () => ({
  cacheGet: vi.fn(async (k: string) => kv.get(k) ?? null),
  cacheSet: vi.fn(async (k: string, v: string) => void kv.set(k, v)),
  cacheDel: vi.fn(async (k: string) => void kv.delete(k)),
}))
vi.mock("./settings", () => ({ getSetting: vi.fn(async () => "") }))

import { getPublicChannelName, clearChannelNamesCache } from "./discord-channel-name"
import { clearGuildRolesCache } from "./discord-channels"

const GUILD = "999"
const OPTS = { botToken: "t", guildId: GUILD }
const VIEW = "1024"
const PUB = "1000000000000000001"
const PRIV = "1000000000000000002" // @everyone denied VIEW_CHANNEL
const OTHER = "1000000000000000003" // other guild
const THREAD_PUB = "1000000000000000004" // public thread under PUB
const THREAD_PRIV = "1000000000000000005" // private thread (type 12)
const THREAD_OF_PRIV = "1000000000000000006" // public-type thread under PRIV

const CHANNELS: Record<string, unknown> = {
  [PUB]: { id: PUB, name: "general", type: 0, guild_id: GUILD, permission_overwrites: [] },
  [PRIV]: { id: PRIV, name: "mods-only", type: 0, guild_id: GUILD, permission_overwrites: [{ id: GUILD, type: 0, allow: "0", deny: VIEW }] },
  [OTHER]: { id: OTHER, name: "elsewhere", type: 0, guild_id: "123", permission_overwrites: [] },
  [THREAD_PUB]: { id: THREAD_PUB, name: "a-thread", type: 11, guild_id: GUILD, parent_id: PUB },
  [THREAD_PRIV]: { id: THREAD_PRIV, name: "secret-thread", type: 12, guild_id: GUILD, parent_id: PUB },
  [THREAD_OF_PRIV]: { id: THREAD_OF_PRIV, name: "hidden-thread", type: 11, guild_id: GUILD, parent_id: PRIV },
}

function fetchImpl() {
  return vi.fn(async (url: string) => {
    if (url.endsWith("/roles")) return new Response(JSON.stringify([{ id: GUILD, name: "@everyone", permissions: VIEW }]), { status: 200 })
    const id = /\/channels\/(\d+)$/.exec(url)?.[1]
    if (id && CHANNELS[id]) return new Response(JSON.stringify(CHANNELS[id]), { status: 200 })
    return new Response("{}", { status: 404 })
  })
}

describe("getPublicChannelName", () => {
  beforeEach(() => {
    kv.clear()
    clearChannelNamesCache()
    clearGuildRolesCache()
  })

  it("names a public channel and stores the name in KV", async () => {
    expect(await getPublicChannelName(PUB, { ...OPTS, fetchImpl: fetchImpl() as unknown as typeof fetch })).toBe("general")
    expect([...kv.values()]).toEqual(["general"])
  })

  it("returns null for a channel in another guild", async () => {
    expect(await getPublicChannelName(OTHER, { ...OPTS, fetchImpl: fetchImpl() as unknown as typeof fetch })).toBeNull()
    expect(kv.size).toBe(0)
  })

  it("returns null for a private channel and never stores its name", async () => {
    expect(await getPublicChannelName(PRIV, { ...OPTS, fetchImpl: fetchImpl() as unknown as typeof fetch })).toBeNull()
    expect(kv.size).toBe(0)
  })

  it("never names a private thread", async () => {
    expect(await getPublicChannelName(THREAD_PRIV, { ...OPTS, fetchImpl: fetchImpl() as unknown as typeof fetch })).toBeNull()
  })

  it("judges a public thread by its parent channel", async () => {
    const f = fetchImpl() as unknown as typeof fetch
    expect(await getPublicChannelName(THREAD_PUB, { ...OPTS, fetchImpl: f })).toBe("a-thread")
    expect(await getPublicChannelName(THREAD_OF_PRIV, { ...OPTS, fetchImpl: f })).toBeNull()
  })

  it("returns null when the roles can't be read (cannot vet)", async () => {
    const f = vi.fn(async (url: string) => (url.endsWith("/roles") ? new Response("{}", { status: 500 }) : new Response(JSON.stringify(CHANNELS[PUB]), { status: 200 })))
    expect(await getPublicChannelName(PUB, { ...OPTS, fetchImpl: f as unknown as typeof fetch })).toBeNull()
    expect(kv.size).toBe(0)
  })

  it("caches in memory", async () => {
    const f = fetchImpl()
    const o = { ...OPTS, fetchImpl: f as unknown as typeof fetch }
    await getPublicChannelName(PUB, { ...o, now: 0 })
    await getPublicChannelName(PUB, { ...o, now: 1000 })
    expect(f.mock.calls.filter((c) => String(c[0]).includes("/channels/")).length).toBe(1)
  })

  it("honors Retry-After for the negative cache", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "120" } }))
    const o = { ...OPTS, fetchImpl: f as unknown as typeof fetch }
    expect(await getPublicChannelName(PUB, { ...o, now: 0 })).toBeNull()
    await getPublicChannelName(PUB, { ...o, now: 100_000 })
    expect(f).toHaveBeenCalledTimes(1)
    await getPublicChannelName(PUB, { ...o, now: 121_000 })
    expect(f).toHaveBeenCalledTimes(2)
  })
})
