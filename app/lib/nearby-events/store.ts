/**
 * Database side of nearby-event invites. Claims, sends and the stop marker live in ReminderSend (kind
 * NEARBY_EVENT, refKey = the rsv.pizza event id) and ReminderPref. Every read is scoped to the ids or event
 * keys of this run and selects only the columns it needs.
 */
import { prisma } from '@/app/lib/db'
import { MAX_ATTEMPTS, prismaStore, type ReminderStore } from '@/app/lib/reminders/store'
import { WEEK_MS } from './match'

export interface NearbyPrefRow {
  discordId: string
  nearbyEvents: boolean
  nearbyRadiusKm: number | null
  channel: string
}

export interface NearbyStore {
  /** Preferences of these members (no row = defaults: opted in). */
  listPrefs(discordIds: readonly string[]): Promise<NearbyPrefRow[]>
  /** "<discordId>|<eventId>" pairs that cannot be claimed now (sent, claimed, skipped, failed, out of attempts), for these members and events only. */
  handled(eventIds: readonly string[], discordIds: readonly string[]): Promise<Set<string>>
  /** Nearby invites sent OR in flight (CLAIMED) in the last 7 days, per member. */
  sentThisWeek(discordIds: readonly string[], now: Date): Promise<Map<string, Date[]>>
  /** Every kind of reminder sent or in flight in the last 24 hours, per member (for reminders.maxPerMemberPerDay). */
  sentDay(discordIds: readonly string[], now: Date): Promise<Map<string, Date[]>>
  /** This member's nearby sends or claims in the last 7 days, other than `exceptRefKey` (the re-check inside a claim). */
  recent(discordId: string, now: Date, exceptRefKey: string): Promise<Date[]>
  /** Drop our own in-flight claim (nothing was sent). */
  unclaim(discordId: string, refKey: string): Promise<void>
  /** IANA timezone per member id. */
  timezones(memberIds: readonly string[]): Promise<Map<string, string>>
  claim: ReminderStore['claimCall']
  markSent: ReminderStore['markSent']
  markSkipped: ReminderStore['markSkipped']
  release: ReminderStore['release']
  markFailed: ReminderStore['markFailed']
}

const chunks = <T>(list: readonly T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

export const prismaNearbyStore: NearbyStore = {
  async listPrefs(discordIds) {
    const out: NearbyPrefRow[] = []
    for (const part of chunks(discordIds, 500)) {
      const rows = await prisma.reminderPref.findMany({
        where: { discordId: { in: part } },
        select: { discordId: true, nearbyEvents: true, nearbyRadiusKm: true, channel: true },
      })
      out.push(...rows)
    }
    return out
  },

  async handled(eventIds, discordIds) {
    const out = new Set<string>()
    if (!eventIds.length || !discordIds.length) return out
    for (const part of chunks(discordIds, 500)) {
      const rows = await prisma.reminderSend.findMany({
        where: { kind: 'NEARBY_EVENT', refKey: { in: [...eventIds] }, discordId: { in: part } },
        select: { discordId: true, refKey: true, status: true, attempts: true },
      })
      for (const r of rows) if (r.status !== 'RETRY' || r.attempts >= MAX_ATTEMPTS) out.add(`${r.discordId}|${r.refKey}`)
    }
    return out
  },

  async sentThisWeek(discordIds, now) {
    const out = new Map<string, Date[]>()
    const since = new Date(now.getTime() - WEEK_MS)
    for (const part of chunks(discordIds, 500)) {
      const rows = await prisma.reminderSend.findMany({
        where: { discordId: { in: part }, kind: 'NEARBY_EVENT', status: { in: ['SENT', 'CLAIMED'] }, updatedAt: { gte: since } },
        select: { discordId: true, updatedAt: true },
      })
      for (const r of rows) out.set(r.discordId, [...(out.get(r.discordId) ?? []), r.updatedAt])
    }
    return out
  },

  async sentDay(discordIds, now) {
    const out = new Map<string, Date[]>()
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    for (const part of chunks(discordIds, 500)) {
      const rows = await prisma.reminderSend.findMany({
        where: { discordId: { in: part }, status: { in: ['SENT', 'RETRY_TG', 'CLAIMED'] }, updatedAt: { gte: since } },
        select: { discordId: true, updatedAt: true },
      })
      for (const r of rows) out.set(r.discordId, [...(out.get(r.discordId) ?? []), r.updatedAt])
    }
    return out
  },

  async recent(discordId, now, exceptRefKey) {
    const rows = await prisma.reminderSend.findMany({
      where: { discordId, kind: 'NEARBY_EVENT', status: { in: ['SENT', 'CLAIMED'] }, refKey: { not: exceptRefKey }, updatedAt: { gte: new Date(now.getTime() - WEEK_MS) } },
      select: { updatedAt: true },
    })
    return rows.map((r) => r.updatedAt)
  },

  async unclaim(discordId, refKey) {
    await prisma.reminderSend.deleteMany({ where: { discordId, kind: 'NEARBY_EVENT', refKey, status: 'CLAIMED' } })
  },

  async timezones(memberIds) {
    const out = new Map<string, string>()
    for (const part of chunks(memberIds, 500)) {
      const rows = await prisma.memberProfileExtras.findMany({ where: { memberId: { in: part }, timezone: { not: null } }, select: { memberId: true, timezone: true } })
      for (const r of rows) if (r.timezone) out.set(r.memberId, r.timezone)
    }
    return out
  },

  claim: (discordId, refKey, kind = 'NEARBY_EVENT') => prismaStore.claimCall(discordId, refKey, kind),
  markSent: (discordId, refKey, kind = 'NEARBY_EVENT', channel) => prismaStore.markSent(discordId, refKey, kind, channel),
  markSkipped: (discordId, refKey, code, kind = 'NEARBY_EVENT') => prismaStore.markSkipped(discordId, refKey, code, kind),
  release: (discordId, refKey, code, attempts, countAttempt, kind = 'NEARBY_EVENT') => prismaStore.release(discordId, refKey, code, attempts, countAttempt, kind),
  markFailed: (discordId, refKey, code, kind = 'NEARBY_EVENT') => prismaStore.markFailed(discordId, refKey, code, kind),
}

/**
 * Nearby send rows are kept this long. It must stay above reminders.nearbyMaxLeadDays (at most 90) plus the weekly
 * window, so a row never disappears while its event can still be invited to (that would allow a repeat invite).
 */
export const NEARBY_SEND_RETENTION_DAYS = 100

export async function sweepOldNearbySends(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - NEARBY_SEND_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const r = await prisma.reminderSend.deleteMany({ where: { kind: 'NEARBY_EVENT', createdAt: { lt: cutoff } } })
  return r.count
}
