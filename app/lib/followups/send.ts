/**
 * Delivery of APPROVED follow-ups (phase 2). Nothing here runs for a row nobody approved, and
 * nothing is sent while sending is off (see config.ts).
 *
 *   decideSend()      pure: hold / defer (quiet hours, daily cap) / escalate / send
 *   deliverOverChannels()  tries Telegram, then Discord, with the failure fallbacks
 *   sendFollowUp()    claims the row (a short lease so overlapping runs cannot double-send),
 *                     decides, delivers, records the outcome and escalates when unreachable
 *   processDue()      the cron loop (bounded per run)
 */
import type { FollowUp } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { appUrl, loadFollowUpConfig, type FollowUpConfig } from './config'
import { discordComponents, telegramKeyboard } from './buttons'
import { isDmClosed, sendDiscordDm } from './discord-dm'
import { deliverToContacts, MAX_CONTACTS, resolveContacts } from './notify'
import { capDecision, DAY_MS, isKnownTimezone, isQuiet, nextAllowedTime } from './quiet-hours'
import type { Channel } from './resolve'
import { addEvent, guardedTransition, isOptedOut, loadOwnerContext, setDmAllowed, type OwnerContext } from './store'
import { cannotMessage, sendTelegramMessage, telegramSenderAvailable } from './telegram'

export const LEASE_MS = 5 * 60_000
export const MAX_PER_RUN = 20

export type EscalateReason = 'requested' | 'no-owner' | 'opted-out' | 'unreachable'

export type SendDecision =
  | { action: 'hold' }
  | { action: 'defer'; until: Date; why: 'quiet' | 'cap' }
  | { action: 'escalate'; reason: EscalateReason }
  | { action: 'send'; channels: Channel[] }

export interface DecideInput {
  row: Pick<FollowUp, 'escalateOnly' | 'ownerDiscordId' | 'channel'>
  cfg: Pick<FollowUpConfig, 'sendEnabled' | 'maxPerDay' | 'quietStartHour' | 'quietEndHour'> & Partial<Pick<FollowUpConfig, 'unknownTzStartHour' | 'unknownTzEndHour'>>
  now: Date
  optedOut: boolean
  timezone: string | null
  /** When this person was last messaged (any follow-up). */
  sentAt: readonly Date[]
  telegramDmAllowed: boolean
}

export function decideSend(i: DecideInput): SendDecision {
  if (!i.cfg.sendEnabled) return { action: 'hold' }
  if (i.row.escalateOnly) return { action: 'escalate', reason: 'requested' }
  if (!i.row.ownerDiscordId) return { action: 'escalate', reason: 'no-owner' }
  if (i.optedOut) return { action: 'escalate', reason: 'opted-out' }
  // Known timezone: the normal quiet hours. Unknown: only a daytime UTC sending window (the complement is quiet).
  const known = isKnownTimezone(i.timezone)
  const qStart = known ? i.cfg.quietStartHour : (i.cfg.unknownTzEndHour ?? 22)
  const qEnd = known ? i.cfg.quietEndHour : (i.cfg.unknownTzStartHour ?? 14)
  const tz = known ? i.timezone : 'UTC'
  if (isQuiet(i.now, tz, qStart, qEnd)) {
    return { action: 'defer', until: nextAllowedTime(i.now, tz, qStart, qEnd), why: 'quiet' }
  }
  const cap = capDecision(i.sentAt, i.now, i.cfg.maxPerDay)
  if (!cap.ok) return { action: 'defer', until: cap.retryAt, why: 'cap' }
  // Telegram only when the person allowed DMs; the reviewer's channel choice is tried first.
  const preferred: Channel = i.row.channel ?? (i.telegramDmAllowed ? 'TELEGRAM' : 'DISCORD')
  const order: Channel[] = preferred === 'TELEGRAM' ? ['TELEGRAM', 'DISCORD'] : ['DISCORD', 'TELEGRAM']
  const channels = order.filter((c) => c !== 'TELEGRAM' || i.telegramDmAllowed)
  return { action: 'send', channels }
}

export const composeText = (message: string, footer: string) => `${message.trim()}\n\n${footer.trim()}`

/** The footer for a channel: Telegram people can type STOP; on Discord there is only the button. */
export const footerFor = (cfg: Pick<FollowUpConfig, 'footerTelegram' | 'footerDiscord'>, channel: Channel) => (channel === 'TELEGRAM' ? cfg.footerTelegram : cfg.footerDiscord)

/** True once an approval is older than `maxDays`. */
export const isStale = (approvedAt: Date | null, now: Date, maxDays: number) => !!approvedAt && now.getTime() - approvedAt.getTime() > maxDays * DAY_MS

export interface Senders {
  telegram: typeof sendTelegramMessage
  discord: typeof sendDiscordDm
  markNoTelegramDm: (telegramId: string) => Promise<void>
}

const realSenders: Senders = { telegram: sendTelegramMessage, discord: sendDiscordDm, markNoTelegramDm: (id) => setDmAllowed(id, false) }

export type Delivered =
  | { ok: true; channel: Channel; discordChannelId?: string; discordMessageId?: string | null; telegramChatId?: string; telegramMessageId?: number }
  | { ok: false; errors: string[] }

export async function deliverOverChannels(
  channels: readonly Channel[],
  m: { id: string; message: string; footers: { TELEGRAM: string; DISCORD: string }; ownerDiscordId: string; telegramChatId: string | null; locale: string | null },
  senders: Senders = realSenders,
): Promise<Delivered> {
  const errors: string[] = []
  for (const ch of channels) {
    if (ch === 'TELEGRAM') {
      if (!m.telegramChatId) continue
      try {
        const r = await senders.telegram(m.telegramChatId, composeText(m.message, m.footers.TELEGRAM), { keyboard: telegramKeyboard(m.id, m.locale) })
        return { ok: true, channel: 'TELEGRAM', telegramChatId: m.telegramChatId, telegramMessageId: r.messageId }
      } catch (e) {
        if (cannotMessage(e)) {
          await senders.markNoTelegramDm(m.telegramChatId).catch(() => {})
          errors.push('telegram: cannot message this chat')
        } else {
          // Anything else may have been delivered already (a 5xx can still post): never also send on Discord.
          errors.push('telegram: send failed')
          return { ok: false, errors }
        }
      }
    } else {
      try {
        const r = await senders.discord(m.ownerDiscordId, composeText(m.message, m.footers.DISCORD), { components: discordComponents(m.id, m.locale) })
        return { ok: true, channel: 'DISCORD', discordChannelId: r.channelId, discordMessageId: r.messageId }
      } catch (e) {
        if (isDmClosed(e)) errors.push('discord: DMs closed')
        else {
          // A 5xx or timeout may have posted: only a clear "cannot DM" falls back to Telegram.
          errors.push('discord: send failed')
          return { ok: false, errors }
        }
      }
    }
  }
  return { ok: false, errors }
}

const REASON_TEXT: Record<EscalateReason, string> = {
  requested: 'sent to you on request',
  'no-owner': 'no matching member',
  'opted-out': 'opted out of these messages',
  unreachable: 'every channel failed',
}

export function escalationText(row: Pick<FollowUp, 'ownerName' | 'ask' | 'recordingId'>, reason: EscalateReason, base = appUrl()): string {
  const link = row.recordingId ? `${base}/admin/calls/${row.recordingId}` : `${base}/admin/followups`
  return `Couldn't reach ${row.ownerName} (${REASON_TEXT[reason]}): "${row.ask}". Call: ${link}`
}

export type SendOutcome = 'sent' | 'deferred' | 'held' | 'escalated' | 'unreachable' | 'busy' | 'stale' | 'not-approved'

export interface SendCtx {
  now?: Date
  cfg?: FollowUpConfig
  senders?: Senders
}

/** Earlier sends AND started attempts to this person in the last 24h (an attempt counts, so a crash cannot reopen the cap). */
async function recentSendTimes(db: Pick<typeof prisma, 'followUp'>, discordId: string, now: Date, exceptId: string): Promise<Date[]> {
  const since = new Date(now.getTime() - DAY_MS)
  const rows = await db.followUp.findMany({
    where: { ownerDiscordId: discordId, id: { not: exceptId }, OR: [{ sentAt: { gte: since } }, { sendAttemptAt: { gte: since } }] },
    select: { sentAt: true, sendAttemptAt: true },
  })
  return rows.flatMap((r) => {
    const d = r.sentAt ?? r.sendAttemptAt
    return d ? [d] : []
  })
}

/**
 * Write the delivery-attempt marker. Under a per-recipient advisory lock the daily cap is re-counted
 * and the marker written in one transaction, so two runs cannot both pass the cap. A row that already
 * has a marker is never claimed again.
 */
async function markAttempt(row: FollowUp, cfg: FollowUpConfig, now: Date): Promise<{ ok: true } | { ok: false; retryAt: Date } | { ok: 'busy' }> {
  return prisma.$transaction(async (tx) => {
    if (row.ownerDiscordId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'followups:' + row.ownerDiscordId}))`
      const cap = capDecision(await recentSendTimes(tx, row.ownerDiscordId, now, row.id), now, cfg.maxPerDay)
      if (!cap.ok) return { ok: false as const, retryAt: cap.retryAt }
    }
    const res = await tx.followUp.updateMany({ where: { id: row.id, status: 'APPROVED', sendAttemptAt: null }, data: { sendAttemptAt: now } })
    return res.count === 1 ? { ok: true as const } : { ok: 'busy' as const }
  })
}

/** Send one APPROVED row (or defer / escalate it). Times come from the real clock; `ctx.now` is for tests only. Safe to call twice: the lease makes the second a no-op. */
export async function sendFollowUp(id: string, ctx: SendCtx = {}): Promise<SendOutcome> {
  const now = ctx.now ?? new Date()
  const cfg = ctx.cfg ?? (await loadFollowUpConfig())
  if (!cfg.sendEnabled) return 'held'

  // Claim: only a due APPROVED row that never had a delivery attempt, and push sendAfter out so a parallel run skips it.
  const claim = await prisma.followUp.updateMany({
    where: { id, status: 'APPROVED', sendAttemptAt: null, OR: [{ sendAfter: null }, { sendAfter: { lte: now } }] },
    data: { sendAfter: new Date(now.getTime() + LEASE_MS) },
  })
  if (claim.count !== 1) return 'busy'
  const row = await prisma.followUp.findUnique({ where: { id } })
  if (!row) return 'busy'

  // An approval that waited too long is not sent: back to draft, to be approved again.
  if (isStale(row.approvedAt, now, cfg.approvalMaxDays)) {
    const moved = await guardedTransition(id, 'APPROVED', 'DRAFT', { approvedBy: null, approvedAt: null, sendAfter: null, escalateOnly: false }, { type: 'stale', actorId: 'system', data: { days: cfg.approvalMaxDays } })
    return moved ? 'stale' : 'busy'
  }

  const owner: OwnerContext = row.ownerDiscordId
    ? await loadOwnerContext(row.ownerDiscordId, row.ownerMemberId)
    : { telegram: null, timezone: null, locale: null, memberId: null }
  const decision = decideSend({
    row,
    cfg,
    now,
    optedOut: row.ownerDiscordId ? await isOptedOut(row.ownerDiscordId) : false,
    timezone: owner.timezone,
    sentAt: row.ownerDiscordId ? await recentSendTimes(prisma, row.ownerDiscordId, now, id) : [],
    telegramDmAllowed: telegramSenderAvailable() && !!owner.telegram?.dmAllowed,
  })

  if (decision.action === 'hold') {
    await prisma.followUp.updateMany({ where: { id, status: 'APPROVED' }, data: { sendAfter: null } })
    return 'held'
  }
  if (decision.action === 'defer') {
    await prisma.followUp.updateMany({ where: { id, status: 'APPROVED' }, data: { sendAfter: decision.until } })
    await addEvent(id, 'deferred', 'system', { why: decision.why, until: decision.until.toISOString() })
    return 'deferred'
  }
  if (decision.action === 'escalate') return escalate(row, decision.reason, cfg, now)

  // The attempt marker goes in BEFORE anything is delivered.
  const marked = await markAttempt(row, cfg, now)
  if (marked.ok === 'busy') return 'busy'
  if (marked.ok === false) {
    await prisma.followUp.updateMany({ where: { id, status: 'APPROVED' }, data: { sendAfter: marked.retryAt } })
    await addEvent(id, 'deferred', 'system', { why: 'cap', until: marked.retryAt.toISOString() })
    return 'deferred'
  }
  const result = await deliverOverChannels(
    decision.channels,
    {
      id,
      message: row.message,
      footers: { TELEGRAM: cfg.footerTelegram, DISCORD: cfg.footerDiscord },
      ownerDiscordId: row.ownerDiscordId as string,
      telegramChatId: telegramSenderAvailable() && owner.telegram?.dmAllowed ? owner.telegram.telegramId : null,
      locale: owner.locale,
    },
    ctx.senders,
  )
  if (result.ok) {
    await guardedTransition(
      id,
      'APPROVED',
      'SENT',
      {
        sentAt: now,
        sendAfter: null,
        error: null,
        channel: result.channel,
        ...(result.channel === 'DISCORD' ? { discordChannelId: result.discordChannelId, discordMessageId: result.discordMessageId ?? null } : { telegramChatId: result.telegramChatId, telegramMessageId: result.telegramMessageId }),
      },
      { type: 'sent', actorId: 'system', data: { channel: result.channel } },
    )
    return 'sent'
  }
  const failed = await guardedTransition(id, 'APPROVED', 'UNREACHABLE', { error: result.errors.join('; ').slice(0, 300), sendAfter: null }, { type: 'failed', actorId: 'system', data: { errors: result.errors.join('; ') } })
  if (!failed) return 'busy'
  return escalate({ ...row, status: 'UNREACHABLE' }, 'unreachable', cfg, now)
}

/** Tell the approvers this person could not be reached. Only when the row really moved to UNREACHABLE. */
export async function escalate(row: FollowUp, reason: EscalateReason, cfg: FollowUpConfig, now: Date): Promise<SendOutcome> {
  if (row.status === 'APPROVED') {
    const moved = await guardedTransition(row.id, 'APPROVED', 'UNREACHABLE', { sendAfter: null, error: REASON_TEXT[reason] }, { type: 'unreachable', actorId: 'system', data: { reason } })
    if (!moved) return 'busy'
  }
  const delivered = await deliverToContacts((await resolveContacts(cfg)).slice(0, MAX_CONTACTS), escalationText(row, reason))
  if (delivered > 0) {
    await guardedTransition(row.id, 'UNREACHABLE', 'ESCALATED', { escalatedAt: now }, { type: 'escalated', actorId: 'system', data: { reason, delivered } })
    return 'escalated'
  }
  await prisma.followUp.updateMany({ where: { id: row.id, status: 'UNREACHABLE' }, data: { error: `${REASON_TEXT[reason]}; no approver could be reached` } })
  return 'unreachable'
}

/**
 * Rows whose lease ran out AFTER a delivery attempt started: we cannot know whether the message
 * went out, so they are never resent automatically. They are flagged FAILED for a human to check.
 */
export async function flagStuck(now: Date): Promise<number> {
  const rows = await prisma.followUp.findMany({
    where: { status: 'APPROVED', sendAttemptAt: { not: null }, sendAfter: { lte: now } },
    select: { id: true },
    take: 50,
  })
  let n = 0
  for (const r of rows) {
    const ok = await guardedTransition(r.id, 'APPROVED', 'FAILED', { sendAfter: null, error: 'A send was started but never confirmed. Check the recipient before approving again.' }, { type: 'needs-check', actorId: 'system' })
    if (ok) n++
  }
  return n
}

/** The cron loop: due APPROVED rows, oldest first, bounded per run, with a gap between Telegram sends to one chat. */
export async function processDue(opts: { limit?: number; now?: Date; sleep?: (ms: number) => Promise<void> } = {}): Promise<Record<string, number>> {
  const now = opts.now ?? new Date()
  const cfg = await loadFollowUpConfig()
  const counts: Record<string, number> = {}
  if (!cfg.sendEnabled) return { held: 1 }
  const flagged = await flagStuck(now)
  if (flagged) counts['needs-check'] = flagged
  const rows = await prisma.followUp.findMany({
    where: { status: 'APPROVED', sendAttemptAt: null, OR: [{ sendAfter: null }, { sendAfter: { lte: now } }] },
    orderBy: { approvedAt: 'asc' },
    take: Math.min(opts.limit ?? MAX_PER_RUN, MAX_PER_RUN),
    select: { id: true, ownerDiscordId: true },
  })
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const lastForOwner = new Map<string, number>()
  for (const r of rows) {
    const key = r.ownerDiscordId ?? ''
    const gap = Date.now() - (lastForOwner.get(key) ?? 0)
    if (key && gap < 1100) await sleep(1100 - gap)
    const out = await sendFollowUp(r.id, { now: opts.now, cfg }).catch((e) => {
      console.error('[followups] send failed:', e instanceof Error ? e.message.slice(0, 160) : 'error')
      return 'unreachable' as const
    })
    lastForOwner.set(key, Date.now())
    counts[out] = (counts[out] ?? 0) + 1
  }
  return counts
}
