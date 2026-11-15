// "Member since": the date shown on a profile and hover card.
//
// It is the EARLIEST known of: the Discord server join date (stored on MemberProfileExtras so Discord
// is not called on every page view), the member's first recorded call attendance, and their site signup
// date. A long-time Discord member who only signed up on the site recently therefore shows when they
// really arrived.
//
// This is a display date only. Logic that depends on the real signup (level and mission gating,
// "new member" windows, buddy matching, activation funnels) never reads it.

import { prisma as realPrisma } from "./db"
import { fetchGuildMember } from "./discord"

/** Retry a Discord lookup that found nothing (not in the server, API error) at most this often. */
export const JOIN_LOOKUP_RETRY_MS = 7 * 24 * 60 * 60 * 1000

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** The earliest valid date of those given, or null when none is valid. */
export function earliestDate(...dates: Array<Date | string | null | undefined>): Date | null {
  let best: Date | null = null
  for (const raw of dates) {
    const d = toDate(raw)
    if (d && (!best || d.getTime() < best.getTime())) best = d
  }
  return best
}

interface ExtrasRow {
  discordJoinedAt: Date | null
  discordJoinedCheckedAt: Date | null
}

/** The slice of Prisma this module uses (kept narrow so tests can fake it). */
export interface MemberSinceDb {
  memberProfileExtras: {
    findUnique(args: unknown): Promise<ExtrasRow | null>
    upsert(args: unknown): Promise<unknown>
  }
  member: { findUnique(args: unknown): Promise<{ createdAt: Date } | null> }
  activationEvent: { findFirst(args: unknown): Promise<{ createdAt: Date } | null> }
  callAttendance: { findFirst(args: unknown): Promise<{ callDate: Date } | null> }
}

export interface MemberSinceDeps {
  db?: MemberSinceDb
  /** Discord guild member lookup; returns joined_at (ISO) or null. */
  fetchJoinedAt?: (discordId: string) => Promise<string | null>
  now?: () => Date
}

async function defaultFetchJoinedAt(discordId: string): Promise<string | null> {
  const m = await fetchGuildMember(discordId)
  return m?.joined_at ?? null
}

function depsOf(deps: MemberSinceDeps) {
  return {
    db: (deps.db ?? (realPrisma as unknown as MemberSinceDb)),
    fetchJoinedAt: deps.fetchJoinedAt ?? defaultFetchJoinedAt,
    now: deps.now ?? (() => new Date()),
  }
}

/**
 * The stored Discord join date; when missing, one Discord lookup (throttled to once per
 * JOIN_LOOKUP_RETRY_MS) that is then persisted. A stored date is never replaced by a later one:
 * Discord resets joined_at when someone leaves and rejoins, and the earliest is what we want.
 */
export async function captureDiscordJoinedAt(
  memberId: string,
  discordId: string,
  deps: MemberSinceDeps = {},
): Promise<Date | null> {
  const { db, fetchJoinedAt, now } = depsOf(deps)
  const existing = await db.memberProfileExtras.findUnique({
    where: { memberId },
    select: { discordJoinedAt: true, discordJoinedCheckedAt: true },
  })
  if (existing?.discordJoinedAt) return existing.discordJoinedAt
  const checked = existing?.discordJoinedCheckedAt
  if (checked && now().getTime() - checked.getTime() < JOIN_LOOKUP_RETRY_MS) return null

  let joined: Date | null = null
  try {
    joined = toDate(await fetchJoinedAt(discordId))
  } catch {
    joined = null
  }
  const stamp = now()
  await db.memberProfileExtras.upsert({
    where: { memberId },
    create: { memberId, discordJoinedAt: joined, discordJoinedCheckedAt: stamp },
    update: { discordJoinedAt: joined, discordJoinedCheckedAt: stamp },
  })
  return joined
}

/**
 * The "member since" date for display, or null when nothing is known. Never throws: each source
 * is optional.
 */
export async function resolveMemberSince(
  memberId: string,
  discordId: string | null | undefined,
  deps: MemberSinceDeps = {},
): Promise<Date | null> {
  const { db } = depsOf(deps)
  const settle = async <T>(p: Promise<T>): Promise<T | null> => {
    try {
      return await p
    } catch {
      return null
    }
  }
  const [discordJoined, memberRow, signupEvent, firstCall] = await Promise.all([
    discordId ? settle(captureDiscordJoinedAt(memberId, discordId, deps)) : Promise.resolve(null),
    settle(db.member.findUnique({ where: { id: memberId }, select: { createdAt: true } })),
    settle(
      db.activationEvent.findFirst({
        where: { memberKey: memberId, event: "profile_created" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ),
    discordId
      ? settle(db.callAttendance.findFirst({ where: { discordId }, orderBy: { callDate: "asc" }, select: { callDate: true } }))
      : Promise.resolve(null),
  ])
  return earliestDate(discordJoined, memberRow?.createdAt, signupEvent?.createdAt, firstCall?.callDate)
}

export interface JoinBackfillRow {
  memberId: string
  discordId: string
  joinedAt: string | null | undefined
}

export interface JoinBackfillResult {
  considered: number
  updated: number
  unchanged: number
  noJoinDate: number
}

/**
 * Backfill discordJoinedAt from guild member rows. Idempotent: a row is only written when it has
 * no stored date, or Discord's is earlier. Dry run writes nothing.
 */
export async function backfillDiscordJoinedAt(
  rows: JoinBackfillRow[],
  opts: { apply: boolean; db?: MemberSinceDb; now?: () => Date },
): Promise<JoinBackfillResult> {
  const db = opts.db ?? (realPrisma as unknown as MemberSinceDb)
  const now = opts.now ?? (() => new Date())
  const out: JoinBackfillResult = { considered: rows.length, updated: 0, unchanged: 0, noJoinDate: 0 }
  for (const row of rows) {
    const joined = toDate(row.joinedAt)
    if (!joined) {
      out.noJoinDate++
      continue
    }
    const existing = await db.memberProfileExtras.findUnique({
      where: { memberId: row.memberId },
      select: { discordJoinedAt: true, discordJoinedCheckedAt: true },
    })
    if (existing?.discordJoinedAt && existing.discordJoinedAt.getTime() <= joined.getTime()) {
      out.unchanged++
      continue
    }
    out.updated++
    if (opts.apply) {
      await db.memberProfileExtras.upsert({
        where: { memberId: row.memberId },
        create: { memberId: row.memberId, discordJoinedAt: joined, discordJoinedCheckedAt: now() },
        update: { discordJoinedAt: joined, discordJoinedCheckedAt: now() },
      })
    }
  }
  return out
}
