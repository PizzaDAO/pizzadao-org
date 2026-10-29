/**
 * What a member can do with a follow-up they received (button taps, replies, STOP). Shared by the
 * Telegram webhook and the Discord interactions endpoint. Only the person the row is addressed to
 * can act on it. Returns text for the approvers when they should be told.
 */
import type { FollowUpStatus } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import type { FollowUpAction } from './buttons'
import { loadFollowUpConfig } from './config'
import { DAY_MS } from './quiet-hours'
import { OPEN_AFTER_SEND } from './state'
import { addEvent, guardedTransition, optOut } from './store'

export const MAX_REPLY_CHARS = 1000
const REPLY_WINDOW_MS = 7 * 24 * 3600_000
/** Replies on one row alert the approvers at most once per this long; replies in between are merged. */
export const REPLY_ALERT_GAP_MS = 10 * 60_000

/**
 * Whether an approver alert may go out for this member now: under their daily alert cap. Records an
 * 'alert' event when it does, so the cap counts what was actually sent.
 */
export async function takeAlertSlot(rowId: string, ownerDiscordId: string, kind: string, actorId: string, now = new Date()): Promise<boolean> {
  const cfg = await loadFollowUpConfig().catch(() => null)
  const cap = cfg?.maxAlertsPerDay ?? 5
  // Count and insert under a per-member lock, so two simultaneous alerts cannot both take the last slot.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'followup-alert:' + ownerDiscordId}))`
    const used = (await tx.followUpEvent.count({ where: { type: 'alert', createdAt: { gte: new Date(now.getTime() - DAY_MS) }, followUp: { ownerDiscordId } } })) ?? 0
    if (used >= cap) return false
    await tx.followUpEvent.create({ data: { followUpId: rowId, type: 'alert', actorId, data: { kind } } })
    return true
  })
}

export type ActionResult =
  | { ok: true; kind: 'status' | 'reply' | 'stopped'; status: FollowUpStatus; notify?: string }
  | { ok: false; reason: 'not-found' | 'not-yours' | 'closed' | 'empty' }

const STATUS_FOR: Record<'done' | 'wip' | 'help', FollowUpStatus> = { done: 'DONE', wip: 'IN_PROGRESS', help: 'NEEDS_HELP' }

export async function applyMemberAction(a: {
  followUpId: string
  discordId: string
  actorId: string
  action: FollowUpAction
  text?: string
}): Promise<ActionResult> {
  const row = await prisma.followUp.findUnique({ where: { id: a.followUpId } })
  if (!row) return { ok: false, reason: 'not-found' }
  if (!row.ownerDiscordId || row.ownerDiscordId !== a.discordId) return { ok: false, reason: 'not-yours' }

  if (a.action === 'stop') {
    await optOut(a.discordId, a.actorId, row.id)
    return { ok: true, kind: 'stopped', status: row.status }
  }
  if (!OPEN_AFTER_SEND.includes(row.status) && !(row.status === 'DONE' && a.action === 'reply')) return { ok: false, reason: 'closed' }

  if (a.action === 'reply') {
    const text = (a.text ?? '').replace(/\u0000/g, '').trim().slice(0, MAX_REPLY_CHARS)
    if (!text) return { ok: false, reason: 'empty' }
    const now = new Date()
    // Replies close together are merged into one note and one alert.
    const quick = !!row.lastReplyAt && now.getTime() - row.lastReplyAt.getTime() < REPLY_ALERT_GAP_MS
    const stored = quick && row.lastReply ? `${row.lastReply}\n${text}`.slice(0, MAX_REPLY_CHARS) : text
    const data = { lastReply: stored, lastReplyAt: now }
    if (row.status === 'SENT') {
      await guardedTransition(row.id, 'SENT', 'REPLIED', data, { type: 'reply', actorId: a.actorId, data: { text } })
    } else {
      await prisma.followUp.update({ where: { id: row.id }, data })
      await addEvent(row.id, 'reply', a.actorId, { text })
    }
    const alert = !quick && (await takeAlertSlot(row.id, a.discordId, 'reply', a.actorId, now))
    return { ok: true, kind: 'reply', status: row.status === 'SENT' ? 'REPLIED' : row.status, ...(alert ? { notify: `Reply from ${row.ownerName} on "${row.ask}": ${text}` } : {}) }
  }

  const to = STATUS_FOR[a.action]
  const wasHelp = row.status === 'NEEDS_HELP'
  if (row.status !== to) {
    const moved = await guardedTransition(row.id, row.status, to, {}, { type: 'button', actorId: a.actorId, data: { action: a.action } })
    if (!moved) return { ok: false, reason: 'closed' }
  } else {
    await addEvent(row.id, 'button', a.actorId, { action: a.action })
  }
  return {
    ok: true,
    kind: 'status',
    status: to,
    // Only a change into NEEDS_HELP alerts; tapping it again does not.
    ...(a.action === 'help' && !wasHelp && (await takeAlertSlot(row.id, a.discordId, 'help', a.actorId)) ? { notify: `${row.ownerName} needs help with: "${row.ask}"` } : {}),
  }
}

/** The follow-up a Telegram message belongs to: the one it replies to, else the chat's latest open one from the last 7 days. */
export async function findFollowUpForChat(chatId: string, replyToMessageId?: number | null): Promise<{ id: string; ownerDiscordId: string | null } | null> {
  if (replyToMessageId) {
    const direct = await prisma.followUp.findFirst({ where: { telegramChatId: chatId, telegramMessageId: replyToMessageId }, select: { id: true, ownerDiscordId: true } })
    if (direct) return direct
  }
  return prisma.followUp.findFirst({
    where: { telegramChatId: chatId, status: { in: [...OPEN_AFTER_SEND] }, sentAt: { gte: new Date(Date.now() - REPLY_WINDOW_MS) } },
    orderBy: { sentAt: 'desc' },
    select: { id: true, ownerDiscordId: true },
  })
}
