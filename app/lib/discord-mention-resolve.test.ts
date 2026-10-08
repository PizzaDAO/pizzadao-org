import { describe, it, expect, vi, beforeEach } from "vitest"
import { resolveDiscordMentions } from "./discord-mention-resolve"
import { clearGuildChannelsCache, clearGuildRolesCache } from "./discord-channels"

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
  })

  it("skips both lookups when the text has no mentions", async () => {
    const fetchImpl = vi.fn()
    const result = await resolveDiscordMentions(["no mentions here"], {
      ...OPTS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ channels: {}, roles: {}, guildId: "999" })
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
      guildId: "999",
    })
  })

  it("omits ids it can't resolve instead of throwing", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }))
    const result = await resolveDiscordMentions(["<#1099323056012394556>"], {
      ...OPTS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ channels: {}, roles: {}, guildId: "999" })
  })

  it("falls back to null guildId when none is configured", async () => {
    const result = await resolveDiscordMentions(["plain text"], {
      botToken: "t",
      guildId: "",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    })
    expect(result.guildId).toBeNull()
  })
})
