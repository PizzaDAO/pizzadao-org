// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./db", () => ({ prisma: {} }))
vi.mock("./settings/toggles", () => ({ toggleEnabled: vi.fn(async () => true) }))

import { channelKey } from "./discord-activity"
import { countKeyMatches, clearPublicChannelCache, getPublicChannelNames, getPublicDiscordActivity, publicChannelNames, toPublicActivity } from "./discord-activity-public"

const GUILD = "900000000000000001"
const VIEW = String(1 << 10)
const ch = (name: string, ow?: { allow?: string; deny?: string }, type = 0) => ({
  name,
  type,
  permission_overwrites: ow ? [{ id: GUILD, type: 0, allow: ow.allow ?? "0", deny: ow.deny ?? "0" }] : [],
})

describe("publicChannelNames", () => {
  it("keeps channels @everyone can see, drops the ones it cannot", () => {
    const names = publicChannelNames(GUILD, VIEW, [ch("general"), ch("staff", { deny: VIEW }), ch("announcements", { allow: VIEW })])
    expect([...names.values()].sort()).toEqual(["announcements", "general"])
  })
  it("an overwrite can grant what the base role lacks, and a base without view hides by default", () => {
    expect([...publicChannelNames(GUILD, "0", [ch("open", { allow: VIEW }), ch("closed")]).values()]).toEqual(["open"])
  })
  it("drops a name shared with a hidden channel, and ignores categories", () => {
    const names = publicChannelNames(GUILD, VIEW, [ch("ops"), ch("ops", { deny: VIEW }), ch("a category", undefined, 4)])
    expect(names.size).toBe(0)
  })
})

describe("channel keys", () => {
  it("reproduces the old crawl sanitizer: each UTF-16 unit and each space becomes one underscore", () => {
    expect(channelKey("general")).toBe("general")
    expect(channelKey("pizza talk")).toBe("pizza_talk")
    expect(channelKey("\u{1F355}-pizza")).toBe("__-pizza") // an emoji is two UTF-16 units
    expect(channelKey("a_b-c")).toBe("a_b-c")
  })
  it("shows the live name for a sanitized stored key, hides thread-named keys and ambiguous keys", () => {
    const names = publicChannelNames(GUILD, VIEW, [ch("\u{1F355}-pizza"), ch("a b"), ch("a_b", { deny: VIEW })])
    expect(names.get("__-pizza")).toBe("\u{1F355}-pizza")
    expect(names.has("a_b")).toBe(false) // one live channel with this key is hidden
    const out = toPublicActivity(
      { totalMessages: 5, firstSeen: new Date(0), lastSeen: new Date(0), activeMonths: 1, topChannels: [{ name: "__-pizza", count: 9 }, { name: "some_thread_title", count: 8 }, { name: "a_b", count: 7 }] },
      names,
    )
    expect(out.topChannels).toEqual(["\u{1F355}-pizza"])
  })
  it("counts how many live channels each stored key maps to", () => {
    expect(countKeyMatches(["general", "x_y", "gone"], ["general", "x y", "x_y", "other"])).toEqual({ one: 1, many: 1, none: 1 })
  })
})

describe("toPublicActivity", () => {
  const row = { totalMessages: 757, firstSeen: new Date("2021-03-17T14:22:09Z"), lastSeen: new Date("2026-05-09T23:59:59Z"), activeMonths: 31, topChannels: [{ name: "staff", count: 900 }, { name: "general", count: 400 }, { name: "pizza", count: 100 }, { name: "memes", count: 50 }, { name: "art", count: 5 }] }
  it("month precision, public channels only, top three", () => {
    const out = toPublicActivity(row, new Map([["general", "general"], ["pizza", "pizza"], ["memes", "memes"], ["art", "art"]]))
    expect(out).toEqual({ messages: 757, since: "2021-03-01T00:00:00.000Z", lastActive: "2026-05-01T00:00:00.000Z", activeMonths: 31, topChannels: ["general", "pizza", "memes"] })
  })
  it("shows no channel names when the public set is unknown", () => {
    expect(toPublicActivity(row, null).topChannels).toEqual([])
  })
})

describe("getPublicDiscordActivity", () => {
  const row = { totalMessages: 10, firstSeen: new Date("2025-01-02T00:00:00Z"), lastSeen: new Date("2025-02-03T00:00:00Z"), activeMonths: 2, topChannels: [{ name: "general", count: 10 }] }
  it("is null with no id, no row, the switch off, or a failure", async () => {
    const channelNames = async () => new Map([["general", "general"]])
    expect(await getPublicDiscordActivity(null, { findRow: async () => row })).toBeNull()
    expect(await getPublicDiscordActivity("1", { findRow: async () => null, show: async () => true, channelNames })).toBeNull()
    expect(await getPublicDiscordActivity("1", { findRow: async () => ({ ...row, totalMessages: 0 }), show: async () => true, channelNames })).toBeNull()
    const find = vi.fn(async () => row)
    expect(await getPublicDiscordActivity("1", { findRow: find, show: async () => false, channelNames })).toBeNull()
    expect(find).not.toHaveBeenCalled()
    expect(
      await getPublicDiscordActivity("1", {
        findRow: async () => {
          throw new Error("db")
        },
        show: async () => true,
        channelNames,
      }),
    ).toBeNull()
  })
  it("returns the public view when on", async () => {
    expect(await getPublicDiscordActivity("1", { findRow: async () => row, show: async () => true, channelNames: async () => new Map([["general", "general"]]) })).toMatchObject({ messages: 10, topChannels: ["general"] })
  })
})

describe("getPublicChannelNames", () => {
  beforeEach(() => {
    clearPublicChannelCache()
    process.env.DISCORD_GUILD_ID = GUILD
    process.env.DISCORD_BOT_TOKEN = "t"
  })
  const json = (b: unknown, ok = true) => ({ ok, json: async () => b }) as unknown as Response
  it("reads roles and channels once (cached) and fails closed", async () => {
    const f = vi.fn(async (url: string) => (url.endsWith("/roles") ? json([{ id: GUILD, permissions: VIEW }]) : json([ch("general"), ch("staff", { deny: VIEW })])))
    expect([...(await getPublicChannelNames(f as unknown as typeof fetch))!.values()]).toEqual(["general"])
    await getPublicChannelNames(f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledTimes(2)
    clearPublicChannelCache()
    const bad = vi.fn(async () => json({}, false))
    expect(await getPublicChannelNames(bad as unknown as typeof fetch)).toBeNull()
  })
})
