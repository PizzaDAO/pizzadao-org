/**
 * What a member can do with a follow-up they received (button taps, replies, STOP). Shared by the
 * Discord interactions endpoint and the signed action links sent on Telegram (app/api/fu). Only the person the row is addressed to
 * can act on it. Returns text for the approvers when they should be told.
 */
import type { FollowUpStatus } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import type { FollowUpAction } from './buttons'
import { loadFollowUpConfig } from './config'
import { DAY_MS } from './quiet-hours'
import { OPEN_AFTER_SEND } from './state'
import { addEvent, guardedTransition, optOut } from './store'
import { requestRecapRefresh } from '@/app/lib/calls/recap-refresh'
import { checkDoneUrl, doneUrlHost } from './done-url'

export const MAX_REPLY_CHARS = 1000
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
  | { ok: true; kind: 'status' | 'reply' | 'stopped' | 'snoozed' | 'link'; status: FollowUpStatus; notify?: string; until?: Date }
  | { ok: false; reason: 'not-found' | 'not-yours' | 'closed' | 'empty' | 'bad-url' }

/** Statuses the public recap shows (in progress / done): a move into or out of one of them changes it. */
const RECAP_STATES: readonly FollowUpStatus[] = ['IN_PROGRESS', 'NEEDS_HELP', 'DONE']

const STATUS_FOR: Record<'done' | 'wip' | 'help', FollowUpStatus> = { done: 'DONE', wip: 'IN_PROGRESS', help: 'NEEDS_HELP' }

export async function applyMemberAction(a: {
  followUpId: string
  discordId: string
  actorId: string
  action: FollowUpAction
  text?: string
  /** Typed reply that arrived as a direct message (not a button or link). */
  via?: 'telegram-dm' | 'discord-dm'
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
      await guardedTransition(row.id, 'SENT', 'REPLIED', data, { type: 'reply', actorId: a.actorId, data: { text, ...(a.via ? { via: a.via } : {}) } })
    } else {
      await prisma.followUp.update({ where: { id: row.id }, data })
      await addEvent(row.id, 'reply', a.actorId, { text, ...(a.via ? { via: a.via } : {}) })
    }
    const alert = !quick && (await takeAlertSlot(row.id, a.discordId, 'reply', a.actorId, now))
    return { ok: true, kind: 'reply', status: row.status === 'SENT' ? 'REPLIED' : row.status, ...(alert ? { notify: `Reply from ${row.ownerName} on "${row.ask}"${a.via ? ` (${a.via === 'telegram-dm' ? 'Telegram' : 'Discord'} DM)` : ''}: ${text}` } : {}) }
  }

  if (a.action === 'snooze') {
    // Not a status: the row stays open and shows as snoozed in the queue. Approvers are not alerted.
    const cfg = await loadFollowUpConfig()
    const until = new Date(Date.now() + cfg.snoozeDays * DAY_MS)
    await prisma.followUp.update({ where: { id: row.id }, data: { snoozedUntil: until } })
    await addEvent(row.id, 'snooze', a.actorId, { until: until.toISOString() })
    return { ok: true, kind: 'snoozed', status: row.status, until }
  }

  const to = STATUS_FOR[a.action]
  const wasHelp = row.status === 'NEEDS_HELP'
  if (row.status !== to) {
    const moved = await guardedTransition(row.id, row.status, to, {}, { type: 'button', actorId: a.actorId, data: { action: a.action } })
    if (!moved) return { ok: false, reason: 'closed' }
    // The posted recap follows by itself (live status on); never blocks or fails the answer.
    if (row.recordingId && row.actionKey && (RECAP_STATES.includes(to) || RECAP_STATES.includes(row.status))) await requestRecapRefresh(row.recordingId, 'follow-up-status')
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

/**
 * The member adds (or changes) the link to the finished work on a follow-up they marked done. The
 * link is shown publicly with the call recap, so it is validated (http(s) only, post filter) and an
 * approver is told what will appear. Only the person the row is addressed to, and only once DONE.
 */
export async function setDoneUrl(a: { followUpId: string; discordId: string; actorId: string; url: unknown }): Promise<ActionResult> {
  const row = await prisma.followUp.findUnique({ where: { id: a.followUpId } })
  if (!row) return { ok: false, reason: 'not-found' }
  if (!row.ownerDiscordId || row.ownerDiscordId !== a.discordId) return { ok: false, reason: 'not-yours' }
  if (row.status !== 'DONE') return { ok: false, reason: 'closed' }
  const url = await checkDoneUrl(a.url)
  if (!url) return { ok: false, reason: 'bad-url' }
  const res = await prisma.followUp.updateMany({ where: { id: row.id, status: 'DONE' }, data: { doneUrl: url, doneUrlAt: new Date(), doneUrlBy: a.actorId } })
  if (res.count !== 1) return { ok: false, reason: 'closed' }
  await addEvent(row.id, 'done-link', a.actorId, { host: doneUrlHost(url) })
  if (row.recordingId && row.actionKey) await requestRecapRefresh(row.recordingId, 'done-link')
  // One approver alert (within the member's daily cap) so a human sees what will show up publicly.
  const alert = await takeAlertSlot(row.id, a.discordId, 'done-link', a.actorId)
  return { ok: true, kind: 'link', status: 'DONE', ...(alert ? { notify: `${row.ownerName} added a link for "${row.ask}": ${doneUrlHost(url)}` } : {}) }
}
