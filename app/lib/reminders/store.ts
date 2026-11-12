/**
 * Database side of reminders: opt-in rows, send claims and the daily-cap history. The interface lets
 * run.ts be tested without a database.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import type { PrefLite } from './schedule'

export const MAX_ATTEMPTS = 3

/** The kinds of send row. Calls are the default everywhere; proposals pass their kind explicitly. */
export type SendKind = 'CALL' | 'PROPOSAL_OPENED' | 'PROPOSAL_CLOSING'

export interface ReminderStore {
  /** Everyone who opted in to call reminders. */
  listCallPrefs(): Promise<PrefLite[]>
  /** Sends in the last 24 hours that count against the daily cap, per member (one entry per DM). */
  sentSince(discordIds: readonly string[], since: Date): Promise<Map<string, Date[]>>
  /** One query: the "<discordId>|<eventId>" pairs already sent a call reminder (any start time) since `since`. */
  sentForEventsSince(discordIds: readonly string[], eventIds: readonly string[], since: Date): Promise<Set<string>>
  /** Claim (member, kind, refKey) before sending. False when it already exists (sent, claimed, skipped, failed) and is not due a retry. */
  claimCall(discordId: string, refKey: string, kind?: SendKind): Promise<{ claimed: boolean; attempts: number }>
  markSent(discordId: string, refKey: string, kind?: SendKind): Promise<void>
  markSkipped(discordId: string, refKey: string, code: string, kind?: SendKind): Promise<void>
  /** Release the claim for the next run. `countAttempt` false keeps the attempt count (a rate limit is not the message's fault). */
  release(discordId: string, refKey: string, code: string, attempts: number, countAttempt: boolean, kind?: SendKind): Promise<void>
  markFailed(discordId: string, refKey: string, code: string, kind?: SendKind): Promise<void>
}

export const prismaStore: ReminderStore = {
  async listCallPrefs() {
    const rows = await prisma.reminderPref.findMany({ where: { calls: { not: 'NONE' } }, select: { discordId: true, calls: true, crewIds: true } })
    return rows.map((r) => ({ discordId: r.discordId, calls: r.calls, crewIds: r.crewIds }))
  },

  async sentSince(discordIds, since) {
    const out = new Map<string, Date[]>()
    if (!discordIds.length) return out
    const rows = await prisma.reminderSend.findMany({
      where: { discordId: { in: [...discordIds] }, status: 'SENT', createdAt: { gte: since } },
      select: { discordId: true, updatedAt: true },
    })
    for (const r of rows) out.set(r.discordId, [...(out.get(r.discordId) ?? []), r.updatedAt])
    return out
  },

  async sentForEventsSince(discordIds, eventIds, since) {
    const out = new Set<string>()
    if (!discordIds.length || !eventIds.length) return out
    const rows = await prisma.reminderSend.findMany({
      where: {
        discordId: { in: [...discordIds] },
        kind: 'CALL',
        status: 'SENT',
        updatedAt: { gte: since },
        OR: eventIds.map((e) => ({ refKey: { startsWith: `${e}:` } })),
      },
      select: { discordId: true, refKey: true },
    })
    for (const r of rows) out.add(`${r.discordId}|${r.refKey.split(':')[0]}`)
    return out
  },

  async claimCall(discordId, refKey, kind = 'CALL') {
    try {
      await prisma.reminderSend.create({ data: { discordId, kind, refKey, status: 'CLAIMED', channel: 'discord', attempts: 0 } })
      return { claimed: true, attempts: 0 }
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e
    }
    // Already there: only a released (RETRY) row with attempts left can be claimed again, by exactly one run.
    const won = await prisma.reminderSend.updateMany({
      where: { discordId, kind, refKey, status: 'RETRY', attempts: { lt: MAX_ATTEMPTS } },
      data: { status: 'CLAIMED' },
    })
    if (won.count !== 1) return { claimed: false, attempts: 0 }
    const row = await prisma.reminderSend.findUnique({ where: { discordId_kind_refKey: { discordId, kind, refKey } }, select: { attempts: true } })
    return { claimed: true, attempts: row?.attempts ?? 0 }
  },

  async markSent(discordId, refKey, kind = 'CALL') {
    await prisma.reminderSend.updateMany({ where: { discordId, kind, refKey }, data: { status: 'SENT', code: null } })
  },

  async markSkipped(discordId, refKey, code, kind = 'CALL') {
    await prisma.reminderSend.updateMany({ where: { discordId, kind, refKey }, data: { status: 'SKIPPED', code } })
  },

  async release(discordId, refKey, code, attempts, countAttempt, kind = 'CALL') {
    await prisma.reminderSend.updateMany({
      where: { discordId, kind, refKey },
      data: { status: 'RETRY', code, attempts: countAttempt ? attempts + 1 : attempts },
    })
  },

  async markFailed(discordId, refKey, code, kind = 'CALL') {
    await prisma.reminderSend.updateMany({ where: { discordId, kind, refKey }, data: { status: 'FAILED', code } })
  },
}

/** Call send rows older than this are swept. */
export const CALL_SEND_RETENTION_DAYS = 30

export async function sweepOldCallSends(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CALL_SEND_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const r = await prisma.reminderSend.deleteMany({ where: { kind: { in: ['CALL', 'CALL_MOVED'] }, createdAt: { lt: cutoff } } })
  return r.count
}
