/**
 * Whether a member's Discord DMs can be reached, remembered per Discord id (DiscordDmReach), shaped like
 * TelegramReach. A 403 (DMs closed to server members) marks the member CLOSED and backs off 7 days,
 * doubling per further miss, capped at 60 days, so a closed DM is one attempt and then quiet.
 */
import { prisma } from '@/app/lib/db'

export const DAY_MS = 24 * 60 * 60 * 1000
export const FIRST_RECHECK_DAYS = 7
export const MAX_RECHECK_DAYS = 60

export interface DmReach {
  state: 'OK' | 'CLOSED'
  failures: number
  recheckAt: Date | null
}

/** OK or never seen: yes. CLOSED: only once the backoff has passed. */
export function canTryDm(reach: Pick<DmReach, 'state' | 'recheckAt'> | null | undefined, now: Date): boolean {
  if (!reach || reach.state === 'OK') return true
  return !!reach.recheckAt && reach.recheckAt.getTime() <= now.getTime()
}

/** Days until the next try after the nth consecutive closed result: 7 * 2^(n-1), capped at 60. */
export function backoffDays(failures: number): number {
  return Math.min(FIRST_RECHECK_DAYS * 2 ** Math.max(0, failures - 1), MAX_RECHECK_DAYS)
}

export function nextClosed(prev: Pick<DmReach, 'failures'> | null, now: Date): DmReach {
  const failures = (prev?.failures ?? 0) + 1
  return { state: 'CLOSED', failures, recheckAt: new Date(now.getTime() + backoffDays(failures) * DAY_MS) }
}

export async function loadDmReach(discordId: string): Promise<DmReach | null> {
  const row = await prisma.discordDmReach.findUnique({ where: { discordId }, select: { state: true, failures: true, recheckAt: true } })
  return row ? { state: row.state === 'CLOSED' ? 'CLOSED' : 'OK', failures: row.failures, recheckAt: row.recheckAt } : null
}

export async function recordDmClosed(discordId: string, prev: Pick<DmReach, 'failures'> | null, now = new Date()): Promise<void> {
  const next = nextClosed(prev, now)
  const data = { state: next.state, failures: next.failures, recheckAt: next.recheckAt, checkedAt: now }
  await prisma.discordDmReach.upsert({ where: { discordId }, create: { discordId, ...data }, update: data })
}

export async function recordDmOk(discordId: string, now = new Date()): Promise<void> {
  const data = { state: 'OK', failures: 0, recheckAt: null, checkedAt: now }
  await prisma.discordDmReach.upsert({ where: { discordId }, create: { discordId, ...data }, update: data })
}

/** The member asked to try again: clear the backoff (the next reminder tries once more). */
export async function clearDmBackoff(discordId: string): Promise<void> {
  await prisma.discordDmReach.updateMany({ where: { discordId }, data: { state: 'OK', failures: 0, recheckAt: null } })
}
