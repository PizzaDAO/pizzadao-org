import { describe, it, expect, vi, beforeEach } from "vitest"

const findMany = vi.fn()
vi.mock("./db", () => ({ prisma: { member: { findMany: (...a: unknown[]) => findMany(...a) } } }))

vi.mock("../api/lib/cache", () => ({ cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => {}), cacheDel: vi.fn(async () => {}) }))
vi.mock("./settings", () => ({ getSetting: vi.fn(async () => "") }))

import { resolveDiscordMentions } from "./discord-mention-resolve"
import { clearGuildChannelsCache, clearGuildRolesCache, clearGuildMemberNamesCache } from "./discord-channels"
import { clearChannelNamesCache } from "./discord-channel-name"

const OPTS = { botToken: "test-token", guildId: "999", now: 0 }

// channels: id -> name. The guild-wide /channels list is deliberately not served:
// resolving must work from per-channel GET /channels/{id} calls alone.
function fetchFor(channels: Record<string, string>, roles: unknown) {
  return vi.fn(async (url: string) => {
    const m = /\/channels\/(\d+)$/.exec(url)
    if (m && channels[m[1]]) {
      return new Response(JSON.stringify({ id: m[1], name: channels[m[1]], type: 0, guild_id: "999" }), { status: 200 })
    }
    if (url.endsWith("/roles")) {
      // @everyone (id = guild id) can view channels (VIEW_CHANNEL = 1024).
      return new Response(JSON.stringify([...(roles as unknown[]), { id: "999", name: "@everyone", permissions: "1024" }]), { status: 200 })
    }
    return new Response("not found", { status: 404 })
  })
}

describe("resolveDiscordMentions", () => {
  beforeEach(() => {
    clearGuildChannelsCache()
    clearGuildRolesCache()
    clearGuildMemberNamesCache()
    clearChannelNamesCache()
    findMany.mockReset()
    findMany.mockResolvedValue([])
  })

  it("skips both lookups when the text has no mentions", async () => {
    const fetchImpl = vi.fn()
    const result = await resolveDiscordMentions(["no mentions here"], {
      ...OPTS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ channels: {}, roles: {}, users: {}, guildId: "999" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("resolves only the referenced channel and role ids", async () => {
    const fetchImpl = fetchFor(
      { "1099323056012394556": "partner-suggestions", "1099323056012394999": "unrelated" },
      [
        { id: "815277786012975134", name: "Partnerships" },
        { id: "other-role", name: "Unrelated" },
      ],
    )
    const texts = [
      "Now tag <@&815277786012975134> in <#1099323056012394556> and suggest a partner.",
    ]
    const result = await resolveDiscordMentions(texts, {
      ...OPTS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({
      channels: { "1099323056012394556": "partner-suggestions" },
      roles: { "815277786012975134": "Partnerships" },
      users: {},
      guildId: "999",
    })
    // No guild-wide channel list call, and only the referenced channel was fetched.
    const urls = fetchImpl.mock.calls.map((c) => c[0] as string)
    expect(urls.some((u) => u.endsWith("/guilds/999/channels"))).toBe(false)
    expect(urls.filter((u) => u.includes("/channels/"))).toHaveLength(1)
  })

  it("cleans decorated channel names", async () => {
    const fetchImpl = fetchFor({ "1099323056012394556": "🍕・general" }, [])
    const result = await resolveDiscordMentions(["<#1099323056012394556>"], { ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.channels).toEqual({ "1099323056012394556": "general" })
  })

  it("looks up at most 25 distinct channels", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => String(1000000000000 + i))
    const names = Object.fromEntries(ids.map((id) => [id, `c${id}`]))
    const fetchImpl = fetchFor(names, [])
    const result = await resolveDiscordMentions([ids.map((id) => `<#${id}>`).join(" ")], { ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(Object.keys(result.channels)).toHaveLength(25)
    const urls = fetchImpl.mock.calls.map((c) => c[0] as string)
    expect(urls.filter((u) => /\/channels\/\d+$/.test(u))).toHaveLength(25)
    expect(urls.filter((u) => u.endsWith("/roles"))).toHaveLength(1) // one shared role fetch
  })

  it("omits ids it can't resolve instead of throwing", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }))
    const result = await resolveDiscordMentions(["<#1099323056012394556>"], {
      ...OPTS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ channels: {}, roles: {}, users: {}, guildId: "999" })
  })

  it("falls back to null guildId when none is configured", async () => {
    const result = await resolveDiscordMentions(["plain text"], {
      botToken: "t",
      guildId: "",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    })
    expect(result.guildId).toBeNull()
  })

  describe("user mentions", () => {
    const A = "100000000000000001" // an app member
    const B = "100000000000000002" // guild member, not an app member (nick)
    const C = "100000000000000003" // guild member, global name only
    const D = "100000000000000004" // guild member, username only
    const E = "100000000000000005" // unknown

    const memberFetch = () =>
      vi.fn(async (url: string) => {
        if (url.endsWith(`/members/${B}`)) return new Response(JSON.stringify({ nick: "Nick B", user: { global_name: "Glob B", username: "ub" } }), { status: 200 })
        if (url.endsWith(`/members/${C}`)) return new Response(JSON.stringify({ nick: null, user: { global_name: "Glob C", username: "uc" } }), { status: 200 })
        if (url.endsWith(`/members/${D}`)) return new Response(JSON.stringify({ user: { username: "ud" } }), { status: 200 })
        return new Response("nope", { status: 404 })
      })

    it("prefers the app member (name + member id) and only asks Discord for non-members", async () => {
      findMany.mockResolvedValue([{ id: "m-1", discordId: A, name: "Member A" }])
      const fetchImpl = memberFetch()
      const r = await resolveDiscordMentions([`<@${A}> <@!${B}> <@${C}> <@${D}> <@${E}>`], { ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch })
      expect(r.users).toEqual({
        [A]: { name: "Member A", memberId: "m-1" },
        [B]: { name: "Nick B" },
        [C]: { name: "Glob C" },
        [D]: { name: "ud" },
      })
      const urls = fetchImpl.mock.calls.map((c) => c[0])
      expect(urls.some((u) => u.endsWith(`/members/${A}`))).toBe(false)
    })

    it("cleans a non-member's guild name and skips the Pizza Trainee placeholder", async () => {
      const F = "100000000000000006"
      const G = "100000000000000007"
      const fetchImpl = vi.fn(async (url: string) => {
        if (url.endsWith(`/members/${F}`)) return new Response(JSON.stringify({ nick: "Pizza Trainee", user: { global_name: "Glob_F \u{1F355}", username: "uf" } }), { status: 200 })
        if (url.endsWith(`/members/${G}`)) return new Response(JSON.stringify({ nick: "\u{1F355}\u{1F355}", user: { global_name: null, username: "ug_123" } }), { status: 200 })
        return new Response("nope", { status: 404 })
      })
      const r = await resolveDiscordMentions([`<@${F}> <@${G}>`], { ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch })
      expect(r.users[F]).toEqual({ name: "Glob F" })
      expect(r.users[G]).toEqual({ name: "ug 123" })
    })

    it("caches member lookups across calls", async () => {
      const fetchImpl = memberFetch()
      const o = { ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch }
      await resolveDiscordMentions([`<@${B}>`], o)
      await resolveDiscordMentions([`<@${B}>`], o)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it("fails soft when the DB and Discord both fail", async () => {
      findMany.mockRejectedValue(new Error("db down"))
      const fetchImpl = vi.fn(async () => { throw new Error("net") })
      const r = await resolveDiscordMentions([`<@${B}>`], { ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch })
      expect(r.users).toEqual({})
    })
  })
})
