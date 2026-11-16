// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

vi.mock("./db", () => ({ prisma: {} }))

import { activityBatchSchema } from "./discord-activity"
import { countMessage, crawlGap, msFromSnowflake, snowflakeFromMs, toBatches, type Aggregate } from "./discord-activity-backfill"

const FROM = Date.parse("2026-04-20T12:00:00Z")
const UNTIL = Date.parse("2026-11-16T12:00:00Z")
const idAt = (iso: string, n = 0) => (BigInt(snowflakeFromMs(Date.parse(iso))) + BigInt(n)).toString()
const msg = (iso: string, author: string, over: Record<string, unknown> = {}) => ({ id: idAt(iso, Math.floor(Math.random() * 1000)), type: 0, author: { id: author, username: "u" + author }, ...over })

describe("snowflakes", () => {
  it("round-trips a time", () => {
    expect(msFromSnowflake(snowflakeFromMs(UNTIL))).toBe(UNTIL)
  })
})

describe("countMessage", () => {
  it("counts people, not bots, webhooks or system messages", () => {
    const agg: Aggregate = new Map()
    expect(countMessage(agg, msg("2026-05-01T10:00:00Z", "111111111111111111"), "general", false)).toBe(true)
    expect(countMessage(agg, msg("2026-05-01T10:00:00Z", "222222222222222222", { author: { id: "222222222222222222", bot: true } }), "general", false)).toBe(false)
    expect(countMessage(agg, msg("2026-05-01T10:00:00Z", "111111111111111111", { webhook_id: "9" }), "general", false)).toBe(false)
    expect(countMessage(agg, msg("2026-05-01T10:00:00Z", "111111111111111111", { type: 7 }), "general", false)).toBe(false)
    expect(countMessage(agg, msg("2026-05-02T10:00:00Z", "111111111111111111", { type: 19 }), "general", true)).toBe(true)
    const u = agg.get("111111111111111111")!
    expect(u.days).toEqual({ "2026-05-01": 1, "2026-05-02": 1 })
    expect(u).toMatchObject({ replies: 1, threads: 1, channels: { general: 2 } })
  })
})

describe("crawlGap", () => {
  it("pages each channel from the window start, stops at the end, skips quiet channels and waits out a 429", async () => {
    const calls: string[] = []
    let limited = false
    const page1 = Array.from({ length: 100 }, (_, i) => msg("2026-05-01T10:00:00Z", "111111111111111111", { id: idAt("2026-05-01T10:00:00Z", i + 1) }))
    const page2 = [
      msg("2026-06-01T10:00:00Z", "222222222222222222"),
      msg("2026-11-20T10:00:00Z", "222222222222222222"), // after the window end: left to the live counter
    ]
    const json = (b: unknown, status = 200) => ({ status, ok: status < 400, json: async () => b, headers: new Headers() }) as unknown as Response
    const f = vi.fn(async (url: string) => {
      const path = url.replace("https://discord.com/api/v10", "")
      calls.push(path)
      if (path.startsWith("/guilds/9/channels"))
        return json([
          { id: "10", name: "general", type: 0, last_message_id: idAt("2026-11-10T00:00:00Z") },
          { id: "11", name: "quiet", type: 0, last_message_id: idAt("2026-01-01T00:00:00Z") },
          { id: "12", name: "forum", type: 15 },
        ])
      if (path.startsWith("/guilds/9/threads/active")) return json({ threads: [{ id: "20", name: "t", type: 11, parent_id: "10", last_message_id: idAt("2026-06-01T00:00:00Z") }] })
      if (path.startsWith("/channels/12/threads/archived")) return json({ threads: [], has_more: false })
      if (path.startsWith("/channels/10/threads/archived")) return json({ threads: [], has_more: false })
      if (path.startsWith("/channels/10/messages")) {
        if (!limited) {
          limited = true
          return json({ retry_after: 0.01 }, 429)
        }
        return json(path.includes(`after=${snowflakeFromMs(FROM)}`) ? page1 : page2)
      }
      if (path.startsWith("/channels/20/messages")) return json([msg("2026-06-02T10:00:00Z", "333333333333333333")])
      return json([])
    })
    const { aggregate, stats } = await crawlGap({ token: "t", guildId: "9", fromMs: FROM, untilMs: UNTIL, fetchImpl: f as unknown as typeof fetch, sleep: async () => undefined })
    expect(aggregate.get("111111111111111111")!.days["2026-05-01"]).toBe(100)
    expect(aggregate.get("222222222222222222")!.days).toEqual({ "2026-06-01": 1 })
    // The thread counts toward its parent channel and as a thread message.
    expect(aggregate.get("333333333333333333")).toMatchObject({ threads: 1, channels: { general: 1 } })
    expect(stats.counted).toBe(102)
    expect(calls.some((c) => c.startsWith("/channels/11/messages"))).toBe(false) // nothing newer than the window start
    expect(calls.filter((c) => c.startsWith("/channels/10/messages")).length).toBeGreaterThanOrEqual(3) // 429 retry + 2 pages
  })
})

describe("toBatches", () => {
  it("makes valid batches with stable ids, sorted by member", () => {
    const agg: Aggregate = new Map()
    for (let i = 0; i < 3; i++) countMessage(agg, msg("2026-05-01T10:00:00Z", `10000000000000000${3 - i}`), "general", false)
    const a = toBatches(agg, "backfill-test")
    expect(a).toHaveLength(1)
    expect(a[0].batchId).toBe("backfill-test-0000")
    expect(a[0].users.map((u) => u.discordId)).toEqual(["100000000000000001", "100000000000000002", "100000000000000003"])
    expect(activityBatchSchema.safeParse(a[0]).success).toBe(true)
    expect(toBatches(agg, "backfill-test")).toEqual(a)
  })
})
