import { describe, it, expect, vi, beforeEach } from "vitest"

const findMany = vi.fn()
vi.mock("./db", () => ({ prisma: { member: { findMany: (...a: unknown[]) => findMany(...a) } } }))

import { resolveDiscordMentions } from "./discord-mention-resolve"
import { clearGuildChannelsCache, clearGuildRolesCache, clearGuildMemberNamesCache } from "./discord-channels"

const OPTS = { botToken: "test-token", guildId: "999", now: 0 }

function fetchFor(channels: unknown, roles: unknown) {
  return vi.fn(async (url: string) => {
    if (url.endsWith("/channels")) {
      return new Response(JSON.stringify(channels), { status: 200 })
    }
    if (url.endsWith("/roles")) {
      return new Response(JSON.stringify(roles), { status: 200 })
    }
    return new Response("not found", { status: 404 })
  })
}

describe("resolveDiscordMentions", () => {
  beforeEach(() => {
    clearGuildChannelsCache()
    clearGuildRolesCache()
    clearGuildMemberNamesCache()
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
      [
        { id: "1099323056012394556", name: "partner-suggestions", type: 0 },
        { id: "other-channel", name: "unrelated", type: 0 },
      ],
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
