/**
 * Database helpers for follow-ups: the append-only audit log, guarded status changes, opt-out and
 * the recipient context (Telegram link, timezone, locale).
 */
import type { FollowUpStatus, Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
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

export interface OwnerContext {
  telegram: { telegramId: string; dmAllowed: boolean } | null
  timezone: string | null
  locale: string | null
  memberId: string | null
}

export async function loadOwnerContext(discordId: string, memberId?: string | null): Promise<OwnerContext> {
  const telegram = await prisma.telegramAccount.findUnique({ where: { discordId }, select: { telegramId: true, dmAllowed: true, memberId: true } })
  const mid = memberId ?? telegram?.memberId ?? null
  const extras = mid ? await prisma.memberProfileExtras.findUnique({ where: { memberId: mid }, select: { timezone: true, locale: true } }) : null
  return {
    telegram: telegram ? { telegramId: telegram.telegramId, dmAllowed: telegram.dmAllowed } : null,
    timezone: extras?.timezone ?? null,
    locale: extras?.locale ?? null,
    memberId: mid,
  }
}

export async function setDmAllowed(telegramId: string, allowed: boolean): Promise<void> {
  await prisma.telegramAccount.updateMany({ where: { telegramId }, data: { dmAllowed: allowed } })
}
