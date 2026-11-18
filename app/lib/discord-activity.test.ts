// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

vi.mock("./db", () => ({ prisma: {} }))

import { activityBatchSchema, applyActivityBatch, mergeActivity, readMonthly, type ActivityDb, type ActivityRow, type ActivityUserBatch } from "./discord-activity"

const NOW = new Date("2026-11-16T12:00:00Z")
const user = (over: Partial<ActivityUserBatch> = {}): ActivityUserBatch => ({
  discordId: "100000000000000001",
  authorName: "someone",
  firstAt: "2026-11-15T10:00:00.000Z",
  lastAt: "2026-11-16T09:00:00.000Z",
  days: { "2026-11-15": 2, "2026-11-16": 3 },
  channels: { general: 4, pizza: 1 },
  replies: 1,
  threads: 2,
  ...over,
})
const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  discordId: "100000000000000001",
  authorName: "old",
  totalMessages: 100,
  firstSeen: new Date("2024-01-05T00:00:00Z"),
  lastSeen: new Date("2026-04-20T08:00:00Z"),
  activeDays: 40,
  activeMonths: 12,
  channelsActive: 3,
  topChannels: [{ name: "general", count: 60 }, { name: "off-topic", count: 30 }],
  categoryBreakdown: { chat: 90 },
  repliesSent: 10,
  reactionsReceived: 7,
  threadMessages: 5,
  avgContentLen: 42,
  monthlyBreakdown: [{ month: "2026-04", count: 9 }],
  engagementScore: 55,
  scoreBreakdown: { volume: 1 },
  ...over,
})

describe("mergeActivity", () => {
  it("creates a row for a new member", () => {
    const d = mergeActivity(null, user(), NOW)
    expect(d).toMatchObject({ totalMessages: 5, activeDays: 2, activeMonths: 1, channelsActive: 2, repliesSent: 1, threadMessages: 2, engagementScore: 0 })
    expect(d.firstSeen.toISOString()).toBe("2026-11-15T10:00:00.000Z")
    expect(d.lastSeen.toISOString()).toBe("2026-11-16T09:00:00.000Z")
    expect(d.monthlyBreakdown).toEqual([{ month: "2026-11", count: 5 }])
    expect(d.topChannels).toEqual([{ name: "general", count: 4 }, { name: "pizza", count: 1 }])
  })

  it("adds to an existing row and keeps the older firstSeen", () => {
    const d = mergeActivity(row(), user(), NOW)
    expect(d.totalMessages).toBe(105)
    expect(d.firstSeen.toISOString()).toBe("2024-01-05T00:00:00.000Z")
    expect(d.lastSeen.toISOString()).toBe("2026-11-16T09:00:00.000Z")
    expect(d.activeDays).toBe(42)
    expect(d.activeMonths).toBe(13)
    expect(d.monthlyBreakdown).toEqual([{ month: "2026-04", count: 9 }, { month: "2026-11", count: 5 }])
    expect((d.topChannels as Array<{ name: string; count: number }>)[0]).toEqual({ name: "general", count: 64 })
    expect(d.channelsActive).toBe(4)
    expect(d.repliesSent).toBe(11)
    expect(d.threadMessages).toBe(7)
    expect(d.reactionsReceived).toBe(7)
    expect(d.authorName).toBe("someone")
  })

  it("counts a day once when it is split across batches, and a month once", () => {
    const first = mergeActivity(row(), user({ days: { "2026-11-15": 1 }, lastAt: "2026-11-15T10:00:00.000Z" }), NOW)
    const second = mergeActivity({ ...row(), ...first } as ActivityRow, user({ days: { "2026-11-15": 2 }, firstAt: "2026-11-15T11:00:00.000Z", lastAt: "2026-11-15T12:00:00.000Z" }), NOW)
    expect(second.activeDays).toBe(41)
    expect(second.activeMonths).toBe(13)
    expect(second.totalMessages).toBe(103)
  })

  it("keeps the object shape of a stored monthly breakdown", () => {
    const d = mergeActivity(row({ monthlyBreakdown: { "2026-04": 9 } }), user(), NOW)
    expect(d.monthlyBreakdown).toEqual({ "2026-04": 9, "2026-11": 5 })
    expect(readMonthly(d.monthlyBreakdown).asArray).toBe(false)
  })

  it("merges live names onto sanitized stored keys (one entry, no extra channelsActive)", () => {
    const d = mergeActivity(row({ topChannels: [{ name: "pizza_talk", count: 10 }, { name: "__-pizza", count: 4 }] }), user({ channels: { "pizza talk": 2, "\u{1F355}-pizza": 1 } }), NOW)
    expect(d.topChannels).toEqual([{ name: "pizza_talk", count: 12 }, { name: "__-pizza", count: 5 }])
    expect(d.channelsActive).toBe(3)
  })

  it("backfill: every batch day is new except the already-counted ones; the name is not replaced", () => {
    const u = user({ days: { "2026-04-20": 1, "2026-05-01": 2, "2026-05-02": 1, "2026-11-16": 1 } })
    const d = mergeActivity(row({ lastSeen: new Date("2026-04-20T08:00:00Z") }), u, NOW, { backfill: true, countedDays: ["2026-04-20", "2026-11-16"] })
    expect(d.activeDays).toBe(42)
    expect(d.authorName).toBe("old")
    // Out-of-order backfill into a row whose lastSeen is later still counts its days.
    const later = mergeActivity(row({ lastSeen: new Date("2026-11-20T00:00:00Z") }), user({ days: { "2026-05-01": 1 } }), NOW, { backfill: true })
    expect(later.activeDays).toBe(41)
  })

  it("keeps only the top ten channels", () => {
    const channels = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`c${i}`, i + 1]))
    expect(mergeActivity(null, user({ channels }), NOW).topChannels).toHaveLength(10)
  })
})

describe("activityBatchSchema", () => {
  it("accepts a good batch and rejects bad ones", () => {
    expect(activityBatchSchema.safeParse({ batchId: "abcdefgh-1", users: [user()] }).success).toBe(true)
    expect(activityBatchSchema.safeParse({ batchId: "x", users: [user()] }).success).toBe(false)
    expect(activityBatchSchema.safeParse({ batchId: "abcdefgh-1", users: [] }).success).toBe(false)
    expect(activityBatchSchema.safeParse({ batchId: "abcdefgh-1", users: [user({ discordId: "abc" })] }).success).toBe(false)
    expect(activityBatchSchema.safeParse({ batchId: "abcdefgh-1", users: [user({ days: {} })] }).success).toBe(false)
  })
})

/** A tiny in-memory stand-in for the transaction: unique batch ids, rows by discord id, rollback on error. */
function fakeDb() {
  const rows = new Map<string, ActivityRow>()
  const batches = new Set<string>()
  const tx = {
    $executeRaw: async () => 0,
    discordActivity: {
      findMany: async (a: unknown) => {
        const ids = (a as { where: { discordId: { in: string[] } } }).where.discordId.in
        return ids.flatMap((id) => (rows.has(id) ? [rows.get(id)!] : []))
      },
      upsert: async (a: unknown) => {
        const x = a as { where: { discordId: string }; create: ActivityRow; update: Partial<ActivityRow> }
        const cur = rows.get(x.where.discordId)
        rows.set(x.where.discordId, cur ? { ...cur, ...x.update } : x.create)
      },
    },
    discordActivityBatch: {
      create: async (a: unknown) => {
        const id = (a as { data: { id: string } }).data.id
        if (batches.has(id)) throw Object.assign(new Error("unique"), { code: "P2002" })
        batches.add(id)
      },
      deleteMany: async () => undefined,
    },
  }
  const db: ActivityDb = {
    ...tx,
    $transaction: async (fn) => {
      const snapshot = { rows: new Map(rows), batches: new Set(batches) }
      try {
        return await fn(tx)
      } catch (e) {
        rows.clear()
        snapshot.rows.forEach((v, k) => rows.set(k, v))
        batches.clear()
        snapshot.batches.forEach((b) => batches.add(b))
        throw e
      }
    },
  }
  return { db, tx, rows, batches }
}

describe("applyActivityBatch", () => {
  it("applies a batch once: a resend with the same id changes nothing", async () => {
    const { db, rows } = fakeDb()
    const batch = { batchId: "batch-0001-a", users: [user()] }
    expect(await applyActivityBatch(batch, { db, now: () => NOW })).toEqual({ status: "applied", users: 1 })
    expect(await applyActivityBatch(batch, { db, now: () => NOW })).toEqual({ status: "duplicate" })
    expect(rows.get("100000000000000001")!.totalMessages).toBe(5)
  })

  it("a new batch id adds on top", async () => {
    const { db, rows } = fakeDb()
    await applyActivityBatch({ batchId: "batch-0001-a", users: [user()] }, { db, now: () => NOW })
    await applyActivityBatch({ batchId: "batch-0002-a", users: [user({ days: { "2026-11-16": 1 }, lastAt: "2026-11-16T10:00:00.000Z" })] }, { db, now: () => NOW })
    const r = rows.get("100000000000000001")!
    expect(r.totalMessages).toBe(6)
    expect(r.activeDays).toBe(2)
  })

  it("a failure inside the transaction does not mark the batch applied (the retry applies it)", async () => {
    const { db, tx, rows, batches } = fakeDb()
    const upsert = tx.discordActivity.upsert
    let fail = true
    tx.discordActivity.upsert = async (a: unknown) => {
      if (fail) throw new Error("db down")
      return upsert(a)
    }
    const batch = { batchId: "batch-0003-a", users: [user()] }
    await expect(applyActivityBatch(batch, { db, now: () => NOW })).rejects.toThrow("db down")
    expect(batches.size).toBe(0)
    fail = false
    expect(await applyActivityBatch(batch, { db, now: () => NOW })).toEqual({ status: "applied", users: 1 })
    expect(rows.size).toBe(1)
  })
})
