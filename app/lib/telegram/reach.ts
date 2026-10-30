/**
 * Whether the shared sender bot can DM a Telegram user, remembered per Telegram id (TelegramReach).
 * Pure decisions here; the two small DB helpers at the bottom read and write the row.
 */
import type { TelegramReachState } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { DAY_MS } from '@/app/lib/followups/quiet-hours'
import type { DmFailureCode } from './rsv-client'

export interface ReachRow {
  state: TelegramReachState
  failures: number
  recheckAt: Date | null
}

export interface RecheckCfg {
  dmRecheckDays: number
  dmRecheckMaxDays: number
}

/** UNKNOWN or OK: yes. BLOCKED: never (only the member's "check again" clears it). NOT_STARTED: after recheckAt. */
export function canTryTelegram(reach: Pick<ReachRow, 'state' | 'recheckAt'> | null | undefined, now: Date): boolean {
  if (!reach) return true
  if (reach.state === 'BLOCKED') return false
  if (reach.state === 'NOT_STARTED') return !!reach.recheckAt && reach.recheckAt.getTime() <= now.getTime()
  return true
}

/** Days until the next try after the nth consecutive not_started: days * 2^(n-1), capped. */
export function backoffDays(failures: number, cfg: RecheckCfg): number {
  return Math.min(cfg.dmRecheckDays * 2 ** Math.max(0, failures - 1), cfg.dmRecheckMaxDays)
}

export interface ReachUpdate {
  state: TelegramReachState
  failures: number
  recheckAt: Date | null
}

/** The new row after a DM or probe outcome, or null when nothing should change (uncertain, rate_limited, config). */
export function nextReach(prev: ReachRow | null, code: DmFailureCode | 'ok', now: Date, cfg: RecheckCfg): ReachUpdate | null {
  if (code === 'ok') return { state: 'OK', failures: 0, recheckAt: null }
  if (code === 'not_started') {
    const failures = (prev?.failures ?? 0) + 1
    return { state: 'NOT_STARTED', failures, recheckAt: new Date(now.getTime() + backoffDays(failures, cfg) * DAY_MS) }
  }
  if (code === 'blocked') return { state: 'BLOCKED', failures: prev?.failures ?? 0, recheckAt: null }
  return null
}

export type TelegramSkip = 'off' | 'no-link' | 'not-started' | 'blocked'

/** Can this person be tried on Telegram now? `why` explains a no (stored on the follow-up). */
export function telegramEligibility(i: {
  toggleOn: boolean
  senderAllowed: boolean
  linkSecretSet: boolean
  telegramId: string | null
  reach: Pick<ReachRow, 'state' | 'recheckAt'> | null
  now: Date
}): { eligible: true } | { eligible: false; why: TelegramSkip } {
  if (!i.toggleOn || !i.senderAllowed || !i.linkSecretSet) return { eligible: false, why: 'off' }
  if (!i.telegramId) return { eligible: false, why: 'no-link' }
  if (!canTryTelegram(i.reach, i.now)) return { eligible: false, why: i.reach?.state === 'BLOCKED' ? 'blocked' : 'not-started' }
  return { eligible: true }
}

export async function loadReach(telegramId: string): Promise<ReachRow | null> {
  return prisma.telegramReach.findUnique({ where: { telegramId }, select: { state: true, failures: true, recheckAt: true } })
}

/** Record an outcome. uncertain / rate_limited / config codes leave the row alone. */
export async function recordResult(telegramId: string, code: DmFailureCode | 'ok', cfg: RecheckCfg, now = new Date()): Promise<void> {
  const next = nextReach(await loadReach(telegramId), code, now, cfg)
  if (!next) return
  const data = { ...next, checkedAt: now, lastCode: code === 'ok' ? null : code }
  await prisma.telegramReach.upsert({ where: { telegramId }, create: { telegramId, ...data }, update: data })
}

/** The member asked to check again: clear BLOCKED / backoff before probing. */
export async function resetReach(telegramId: string): Promise<void> {
  await prisma.telegramReach.upsert({
    where: { telegramId },
    create: { telegramId, state: 'UNKNOWN' },
    update: { state: 'UNKNOWN', failures: 0, recheckAt: null },
  })
}
