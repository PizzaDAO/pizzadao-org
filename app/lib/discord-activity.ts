// Per-member Discord activity (table DiscordActivity): live increments from the recorder bot and the
// gap backfill script. Display side: ./discord-activity-public.ts.
//
// The recorder counts message events (no content) and posts batches to POST /api/calls/recorder/discord-activity.
// A batch is applied once: its id is stored in DiscordActivityBatch in the same transaction as the counts,
// so a retry of a request whose answer was lost is a no-op (never a double count).
//
// Keep the batch shape in sync with recorder/src/discord-activity.ts.

import { z } from "zod"
import { prisma as realPrisma } from "./db"

export const MAX_BATCH_USERS = 500
export const MAX_CHANNELS_PER_USER = 50
export const TOP_CHANNELS_KEPT = 10
/** Applied batch ids older than this are pruned (a retry never comes this late). */
export const BATCH_ID_KEEP_DAYS = 14

const snowflake = z.string().regex(/^\d{15,25}$/)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const activityUserSchema = z.object({
  discordId: snowflake,
  authorName: z.string().trim().min(1).max(100).nullish(),
  firstAt: z.string().datetime(),
  lastAt: z.string().datetime(),
  /** UTC day -> messages that day. The total is the sum. */
  days: z.record(day, z.number().int().min(1).max(1_000_000)).refine((d) => Object.keys(d).length >= 1 && Object.keys(d).length <= 400),
  /** Channel name -> messages (threads count toward their parent channel). */
  channels: z.record(z.string().min(1).max(100), z.number().int().min(1).max(1_000_000)).refine((c) => Object.keys(c).length <= MAX_CHANNELS_PER_USER),
  replies: z.number().int().min(0).max(1_000_000).default(0),
  threads: z.number().int().min(0).max(1_000_000).default(0),
})

export const activityBatchSchema = z.object({
  batchId: z.string().regex(/^[A-Za-z0-9_.:-]{8,100}$/),
  users: z.array(activityUserSchema).min(1).max(MAX_BATCH_USERS),
})

export type ActivityUserBatch = z.infer<typeof activityUserSchema>
export type ActivityBatch = z.infer<typeof activityBatchSchema>

export interface ActivityRow {
  discordId: string
  authorName: string | null
  totalMessages: number
  firstSeen: Date
  lastSeen: Date
  activeDays: number
  activeMonths: number
  channelsActive: number
  topChannels: unknown
  categoryBreakdown: unknown
  repliesSent: number
  reactionsReceived: number
  threadMessages: number
  avgContentLen: number
  monthlyBreakdown: unknown
  engagementScore: number
  scoreBreakdown: unknown
}

export type ActivityData = Omit<ActivityRow, "discordId"> & { lastSyncedAt: Date }

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

/** Monthly counts as a map, from either stored shape ([{month,count}] or {month: count}). */
export function readMonthly(raw: unknown): { map: Map<string, number>; asArray: boolean } {
  const map = new Map<string, number>()
  if (Array.isArray(raw)) {
    for (const e of raw as Array<{ month?: unknown; count?: unknown }>) {
      if (e && typeof e.month === "string" && typeof e.count === "number") map.set(e.month, (map.get(e.month) ?? 0) + e.count)
    }
    return { map, asArray: true }
  }
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "number") map.set(k, v)
    return { map, asArray: false }
  }
  return { map, asArray: true }
}

function writeMonthly(map: Map<string, number>, asArray: boolean): unknown {
  const entries = [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return asArray ? entries.map(([month, count]) => ({ month, count })) : Object.fromEntries(entries)
}

/** [{name,count}] from the stored top channels (anything else reads as empty). */
export function readTopChannels(raw: unknown): Array<{ name: string; count: number }> {
  if (!Array.isArray(raw)) return []
  return (raw as Array<{ name?: unknown; count?: unknown }>).flatMap((e) =>
    e && typeof e.name === "string" && typeof e.count === "number" ? [{ name: e.name, count: e.count }] : [],
  )
}

/**
 * The row after adding one member's batch. Pure.
 * - activeDays: a batch day later than the stored lastSeen day is a new active day (a day at or before it
 *   is not counted again, so a day split over two batches counts once).
 * - activeMonths: a month missing from the monthly breakdown is new.
 * - topChannels: counts are added by name and the top ten kept. A channel outside the stored top ten starts
 *   again from the live count, so the list is approximate for a quiet channel; the total is exact.
 */
export function mergeActivity(existing: ActivityRow | null, u: ActivityUserBatch, now: Date): ActivityData {
  const dayEntries = Object.entries(u.days).sort(([a], [b]) => (a < b ? -1 : 1))
  const added = dayEntries.reduce((n, [, c]) => n + c, 0)
  const firstAt = new Date(u.firstAt)
  const lastAt = new Date(u.lastAt)

  const { map: monthly, asArray } = readMonthly(existing?.monthlyBreakdown)
  let newMonths = 0
  for (const [d, c] of dayEntries) {
    const m = d.slice(0, 7)
    if (!monthly.has(m)) newMonths++
    monthly.set(m, (monthly.get(m) ?? 0) + c)
  }

  const lastDay = existing ? isoDay(existing.lastSeen) : null
  const newDays = dayEntries.filter(([d]) => lastDay === null || d > lastDay).length

  const top = readTopChannels(existing?.topChannels)
  const byName = new Map(top.map((c) => [c.name, c.count]))
  let newChannels = 0
  for (const [name, c] of Object.entries(u.channels)) {
    if (!byName.has(name) && (!existing || top.length < TOP_CHANNELS_KEPT)) newChannels++
    byName.set(name, (byName.get(name) ?? 0) + c)
  }
  const topChannels = [...byName.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1))
    .slice(0, TOP_CHANNELS_KEPT)

  return {
    authorName: u.authorName ?? existing?.authorName ?? null,
    totalMessages: (existing?.totalMessages ?? 0) + added,
    firstSeen: existing && existing.firstSeen < firstAt ? existing.firstSeen : firstAt,
    lastSeen: existing && existing.lastSeen > lastAt ? existing.lastSeen : lastAt,
    activeDays: (existing?.activeDays ?? 0) + newDays,
    activeMonths: (existing?.activeMonths ?? 0) + newMonths,
    channelsActive: (existing?.channelsActive ?? 0) + newChannels,
    topChannels,
    categoryBreakdown: existing?.categoryBreakdown ?? {},
    repliesSent: (existing?.repliesSent ?? 0) + u.replies,
    reactionsReceived: existing?.reactionsReceived ?? 0,
    threadMessages: (existing?.threadMessages ?? 0) + u.threads,
    avgContentLen: existing?.avgContentLen ?? 0,
    monthlyBreakdown: writeMonthly(monthly, asArray),
    engagementScore: existing?.engagementScore ?? 0,
    scoreBreakdown: existing?.scoreBreakdown ?? {},
    lastSyncedAt: now,
  }
}

/** The slice of Prisma used here (narrow so tests can fake it). */
export interface ActivityTx {
  discordActivity: {
    findMany(args: unknown): Promise<ActivityRow[]>
    upsert(args: unknown): Promise<unknown>
  }
  discordActivityBatch: {
    create(args: unknown): Promise<unknown>
    deleteMany(args: unknown): Promise<unknown>
  }
}
export interface ActivityDb extends ActivityTx {
  $transaction<T>(fn: (tx: ActivityTx) => Promise<T>, opts?: { timeout?: number; maxWait?: number }): Promise<T>
}

const isUniqueViolation = (e: unknown) => !!e && typeof e === "object" && (e as { code?: unknown }).code === "P2002"

export type ApplyResult = { status: "applied"; users: number } | { status: "duplicate" }

/**
 * Apply one batch, once. The batch id and the counts commit together; a batch id already stored is
 * answered "duplicate" and changes nothing.
 */
export async function applyActivityBatch(
  batch: ActivityBatch,
  opts: { db?: ActivityDb; now?: () => Date } = {},
): Promise<ApplyResult> {
  const db = opts.db ?? (realPrisma as unknown as ActivityDb)
  const now = (opts.now ?? (() => new Date()))()
  // Several entries for one member (a caller bug) are folded by applying them in order to the running row.
  let duplicate = false
  try {
    await db.$transaction(
      async (tx) => {
        try {
          await tx.discordActivityBatch.create({ data: { id: batch.batchId, appliedAt: now } })
        } catch (e) {
          if (isUniqueViolation(e)) duplicate = true
          throw e
        }
        const ids = [...new Set(batch.users.map((u) => u.discordId))]
        const rows = await tx.discordActivity.findMany({ where: { discordId: { in: ids } } })
        const current = new Map(rows.map((r) => [r.discordId, r]))
        for (const u of batch.users) {
          const data = mergeActivity(current.get(u.discordId) ?? null, u, now)
          await tx.discordActivity.upsert({
            where: { discordId: u.discordId },
            create: { discordId: u.discordId, ...data },
            update: data,
          })
          current.set(u.discordId, { discordId: u.discordId, ...data })
        }
      },
      { timeout: 60_000, maxWait: 10_000 },
    )
  } catch (e) {
    if (duplicate) return { status: "duplicate" }
    throw e
  }
  // Housekeeping, best effort.
  try {
    await db.discordActivityBatch.deleteMany({ where: { appliedAt: { lt: new Date(now.getTime() - BATCH_ID_KEEP_DAYS * 86_400_000) } } })
  } catch {
    // ignore
  }
  return { status: "applied", users: batch.users.length }
}
