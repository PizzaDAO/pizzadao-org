/**
 * Database helpers for follow-ups: the append-only audit log, guarded status changes, opt-out and
 * the recipient context (Telegram link and reach, timezone, locale).
 */
import type { FollowUpStatus, Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { loadReach, type ReachRow } from '@/app/lib/telegram/reach'
import { canTransition } from './state'

const MAX_EVENT_TEXT = 500

/** Append one audit row. `data` must not carry tokens; message text is cut to a short length. */
export async function addEvent(followUpId: string, type: string, actorId: string | null, data?: Record<string, unknown>): Promise<void> {
  await prisma.followUpEvent.create({
    data: { followUpId, type, actorId, ...(data ? { data: clip(data) as Prisma.InputJsonValue } : {}) },
  })
}

function clip(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) out[k] = typeof v === 'string' ? v.slice(0, MAX_EVENT_TEXT) : v
  return out
}

/**
 * Move a row from one of `from` to `to` in a single guarded update (so two writers cannot both win),
 * then log the event. Returns false when the row was no longer in a `from` status.
 */
export async function guardedTransition(
  id: string,
  from: FollowUpStatus | readonly FollowUpStatus[],
  to: FollowUpStatus,
  data: Prisma.FollowUpUpdateManyMutationInput,
  event: { type: string; actorId: string | null; data?: Record<string, unknown> },
  /** Extra conditions on the row (e.g. updatedAt, to reject a change made since it was read). */
  extraWhere: Prisma.FollowUpWhereInput = {},
): Promise<boolean> {
  const froms = (Array.isArray(from) ? from : [from]) as FollowUpStatus[]
  for (const f of froms) if (!canTransition(f, to) && f !== to) throw new Error(`Invalid follow-up transition ${f} -> ${to}`)
  const res = await prisma.followUp.updateMany({ where: { id, status: { in: froms }, ...extraWhere }, data: { ...data, status: to } })
  if (res.count !== 1) return false
  await addEvent(id, event.type, event.actorId, event.data)
  return true
}

export async function isOptedOut(discordId: string): Promise<boolean> {
  const row = await prisma.messagingOptOut.findUnique({ where: { discordId } })
  return !!row
}

export async function optOut(discordId: string, actorId: string, followUpId?: string): Promise<void> {
  await prisma.messagingOptOut.upsert({ where: { discordId }, create: { discordId, scope: 'followups' }, update: {} })
  if (followUpId) await addEvent(followUpId, 'optout', actorId)
}

/** How long after tapping Stop the confirmation page still offers "undo". */
export const UNDO_OPT_OUT_MS = 10 * 60_000

/** Remove the opt-out, but only if it was made in the last few minutes (the undo on the Stop confirmation). */
export async function undoOptOut(discordId: string, actorId: string, followUpId: string, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - UNDO_OPT_OUT_MS)
  // Only the opt-out THIS follow-up's Stop link just made: an older or admin-made opt-out is never undone here.
  const made = await prisma.followUpEvent.findFirst({ where: { followUpId, type: 'optout', actorId: 'link:stop', createdAt: { gte: since } }, select: { id: true } })
  if (!made) return false
  const res = await prisma.messagingOptOut.deleteMany({ where: { discordId, createdAt: { gte: since } } })
  if (res.count > 0) await addEvent(followUpId, 'optout-undone', actorId)
  return res.count > 0
}

async function confirmedHostMatch(discordId: string): Promise<{ telegramId: string; memberId: string } | null> {
  if (!(await toggleEnabled('telegram.hostMatchEnabled').catch(() => false))) return null
  const m = await prisma.telegramHostMatch.findFirst({ where: { discordId, consent: 'CONFIRMED' }, select: { telegramId: true, memberId: true } })
  // A Telegram id that is anyone's Login Widget link is never usable through a match.
  if (m && (await prisma.telegramAccount.findUnique({ where: { telegramId: m.telegramId }, select: { discordId: true } }))) return null
  return m
}

export interface OwnerContext {
  /** The linked Telegram id and what we know about reaching it. */
  telegram: { telegramId: string; reach: ReachRow | null } | null
  timezone: string | null
  locale: string | null
  memberId: string | null
}

export async function loadOwnerContext(discordId: string, memberId?: string | null): Promise<OwnerContext> {
  const login = await prisma.telegramAccount.findUnique({ where: { discordId }, select: { telegramId: true, memberId: true } })
  // No Telegram login: a host match counts only once both sides confirmed it (and only while matching is on).
  const matched = login ? null : await confirmedHostMatch(discordId)
  const telegram = login ?? matched
  const reach = telegram ? await loadReach(telegram.telegramId) : null
  const mid = memberId ?? telegram?.memberId ?? null
  const extras = mid ? await prisma.memberProfileExtras.findUnique({ where: { memberId: mid }, select: { timezone: true, locale: true } }) : null
  return {
    telegram: telegram ? { telegramId: telegram.telegramId, reach } : null,
    timezone: extras?.timezone ?? null,
    locale: extras?.locale ?? null,
    memberId: mid,
  }
}
