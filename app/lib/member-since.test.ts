import { describe, it, expect, vi } from "vitest"

vi.mock("./db", () => ({ prisma: {} }))
vi.mock("./discord", () => ({ fetchGuildMember: vi.fn() }))

import {
  earliestDate,
  captureDiscordJoinedAt,
  resolveMemberSince,
  backfillDiscordJoinedAt,
  JOIN_LOOKUP_RETRY_MS,
  type MemberSinceDb,
} from "./member-since"
import { formatMemberSince } from "./member-since-format"

const NOW = new Date("2026-11-15T12:00:00Z")

function fakeDb(over: {
  extras?: { discordJoinedAt: Date | null; discordJoinedCheckedAt: Date | null } | null
  member?: Date | null
  signup?: Date | null
  call?: Date | null
} = {}) {
  const upsert = vi.fn(async () => ({}))
  const db: MemberSinceDb = {
    memberProfileExtras: { findUnique: vi.fn(async () => over.extras ?? null), upsert },
    member: { findUnique: vi.fn(async () => (over.member ? { createdAt: over.member } : null)) },
    activationEvent: { findFirst: vi.fn(async () => (over.signup ? { createdAt: over.signup } : null)) },
    callAttendance: { findFirst: vi.fn(async () => (over.call ? { callDate: over.call } : null)) },
  }
  return { db, upsert }
}

describe("earliestDate", () => {
  it("picks the earliest valid date and ignores empty or invalid ones", () => {
    expect(earliestDate("2024-05-01T00:00:00Z", new Date("2021-03-05T00:00:00Z"), null, undefined, "nonsense")?.toISOString()).toBe(
      "2021-03-05T00:00:00.000Z",
    )
    expect(earliestDate(null, "bad")).toBeNull()
  })
})

describe("captureDiscordJoinedAt", () => {
  it("returns the stored date without calling Discord", async () => {
    const { db } = fakeDb({ extras: { discordJoinedAt: new Date("2020-01-01T00:00:00Z"), discordJoinedCheckedAt: null } })
    const fetchJoinedAt = vi.fn()
    const d = await captureDiscordJoinedAt("1", "d1", { db, fetchJoinedAt })
    expect(d?.toISOString()).toBe("2020-01-01T00:00:00.000Z")
    expect(fetchJoinedAt).not.toHaveBeenCalled()
  })

  it("looks the date up once and persists it", async () => {
    const { db, upsert } = fakeDb()
    const fetchJoinedAt = vi.fn(async () => "2019-06-01T00:00:00.000Z")
    const d = await captureDiscordJoinedAt("1", "d1", { db, fetchJoinedAt, now: () => NOW })
    expect(d?.toISOString()).toBe("2019-06-01T00:00:00.000Z")
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ memberId: "1", discordJoinedAt: d }) }))
  })

  it("does not retry a recent failed lookup, but does after the retry window", async () => {
    const recent = new Date(NOW.getTime() - 1000)
    const old = new Date(NOW.getTime() - JOIN_LOOKUP_RETRY_MS - 1000)
    const fetchJoinedAt = vi.fn(async () => null)
    await captureDiscordJoinedAt("1", "d1", { db: fakeDb({ extras: { discordJoinedAt: null, discordJoinedCheckedAt: recent } }).db, fetchJoinedAt, now: () => NOW })
    expect(fetchJoinedAt).not.toHaveBeenCalled()
    await captureDiscordJoinedAt("1", "d1", { db: fakeDb({ extras: { discordJoinedAt: null, discordJoinedCheckedAt: old } }).db, fetchJoinedAt, now: () => NOW })
    expect(fetchJoinedAt).toHaveBeenCalledTimes(1)
  })

  it("survives a Discord error", async () => {
    const { db } = fakeDb()
    const d = await captureDiscordJoinedAt("1", "d1", { db, fetchJoinedAt: async () => { throw new Error("down") }, now: () => NOW })
    expect(d).toBeNull()
  })
})

describe("resolveMemberSince", () => {
  it("shows the Discord join date when it is earlier than the recent site signup", async () => {
    const { db } = fakeDb({
      extras: { discordJoinedAt: new Date("2020-02-02T00:00:00Z"), discordJoinedCheckedAt: NOW },
      member: new Date("2026-10-01T00:00:00Z"),
      signup: new Date("2026-10-01T00:00:00Z"),
    })
    const d = await resolveMemberSince("1", "d1", { db })
    expect(d?.toISOString()).toBe("2020-02-02T00:00:00.000Z")
  })

  it("uses the first call when it predates everything else", async () => {
    const { db } = fakeDb({
      extras: { discordJoinedAt: null, discordJoinedCheckedAt: NOW },
      member: new Date("2026-10-01T00:00:00Z"),
      call: new Date("2022-04-04T00:00:00Z"),
    })
    expect((await resolveMemberSince("1", "d1", { db, now: () => NOW }))?.toISOString()).toBe("2022-04-04T00:00:00.000Z")
  })

  it("falls back to the signup date, and to null when nothing is known", async () => {
    const a = fakeDb({ extras: { discordJoinedAt: null, discordJoinedCheckedAt: NOW }, member: new Date("2026-10-01T00:00:00Z") })
    expect((await resolveMemberSince("1", "d1", { db: a.db, now: () => NOW }))?.toISOString()).toBe("2026-10-01T00:00:00.000Z")
    const b = fakeDb({ extras: { discordJoinedAt: null, discordJoinedCheckedAt: NOW } })
    expect(await resolveMemberSince("1", null, { db: b.db })).toBeNull()
  })

  it("does not touch Discord or calls without a Discord id", async () => {
    const { db } = fakeDb({ member: new Date("2026-10-01T00:00:00Z") })
    const fetchJoinedAt = vi.fn()
    await resolveMemberSince("1", null, { db, fetchJoinedAt })
    expect(fetchJoinedAt).not.toHaveBeenCalled()
    expect(db.callAttendance.findFirst).not.toHaveBeenCalled()
  })
})

describe("backfillDiscordJoinedAt", () => {
  const rows = [
    { memberId: "1", discordId: "d1", joinedAt: "2019-01-01T00:00:00Z" },
    { memberId: "2", discordId: "d2", joinedAt: null },
    { memberId: "3", discordId: "d3", joinedAt: "2021-01-01T00:00:00Z" },
  ]

  it("dry run counts but writes nothing", async () => {
    const { db, upsert } = fakeDb()
    const r = await backfillDiscordJoinedAt(rows, { apply: false, db })
    expect(r).toEqual({ considered: 3, updated: 2, unchanged: 0, noJoinDate: 1 })
    expect(upsert).not.toHaveBeenCalled()
  })

  it("apply writes, and is idempotent for an already stored equal or earlier date", async () => {
    const first = fakeDb()
    await backfillDiscordJoinedAt(rows, { apply: true, db: first.db, now: () => NOW })
    expect(first.upsert).toHaveBeenCalledTimes(2)
    const again = fakeDb({ extras: { discordJoinedAt: new Date("2019-01-01T00:00:00Z"), discordJoinedCheckedAt: NOW } })
    const r = await backfillDiscordJoinedAt(rows, { apply: true, db: again.db })
    expect(r.updated).toBe(0)
    expect(again.upsert).not.toHaveBeenCalled()
  })
})

describe("formatMemberSince", () => {
  it("formats month and year per locale and tolerates bad input", () => {
    expect(formatMemberSince("2021-03-05T00:00:00Z", "en")).toBe("March 2021")
    expect(formatMemberSince("2021-03-05T00:00:00Z", "fr")).toBe("mars 2021")
    expect(formatMemberSince(null, "en")).toBe("")
    expect(formatMemberSince("nope", "en")).toBe("")
  })
})
