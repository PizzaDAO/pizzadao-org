/**
 * Delivery of APPROVED follow-ups (phase 2). Nothing here runs for a row nobody approved, and
 * nothing is sent while sending is off (see config.ts).
 *
 *   decideSend()      pure: hold / defer (quiet hours, daily cap) / escalate / send
 *   deliverOverChannels()  tries Telegram (over the rsv.pizza proxy), then Discord, with the failure fallbacks
 *   sendFollowUp()    claims the row (a short lease so overlapping runs cannot double-send),
 *                     decides, delivers, records the outcome and escalates when unreachable
 *   processDue()      the cron loop (bounded per run)
 */
import type { FollowUp } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { appUrl, loadFollowUpConfig, type FollowUpConfig } from './config'
import { recordResult, telegramEligibility, type RecheckCfg, type TelegramSkip } from '@/app/lib/telegram/reach'
import { DM_TEXT_LIMIT, sendDm, telegramSendAllowed, type DmFailureCode, type DmResult, type TelegramButton } from '@/app/lib/telegram/rsv-client'
import { discordComponents, telegramUrlKeyboard } from './buttons'
import { isDmClosed, sendDiscordDm } from './discord-dm'
import { deliverToContacts, MAX_CONTACTS, resolveContacts } from './notify'
import { capDecision, DAY_MS, isKnownTimezone, isQuiet, nextAllowedTime } from './quiet-hours'
import type { Channel } from './resolve'
import { linkSecret, linkUrl, signLink } from './links'
import { addEvent, guardedTransition, isOptedOut, loadOwnerContext, type OwnerContext } from './store'

export const UNCONFIRMED_TEXT = 'A send was started but never confirmed. Check the recipient before approving again.'
export const UNCONFIRMED_TWICE_TEXT = "rsv.pizza couldn't confirm this send either. Approving again will send a new message."
export const LEASE_MS = 5 * 60_000
export const MAX_PER_RUN = 20

export type EscalateReason = 'requested' | 'no-owner' | 'opted-out' | 'unreachable'

export type SendDecision =
  | { action: 'hold' }
  | { action: 'defer'; until: Date; why: 'quiet' | 'cap' }
  | { action: 'escalate'; reason: EscalateReason }
  | { action: 'send'; channels: Channel[]; /** Why Telegram was left out, when it was. */ telegramSkip?: TelegramSkip }

export interface DecideInput {
  row: Pick<FollowUp, 'escalateOnly' | 'ownerDiscordId' | 'channel'>
  cfg: Pick<FollowUpConfig, 'sendEnabled' | 'maxPerDay' | 'quietStartHour' | 'quietEndHour'> & Partial<Pick<FollowUpConfig, 'unknownTzStartHour' | 'unknownTzEndHour'>>
  now: Date
  optedOut: boolean
  timezone: string | null
  /** When this person was last messaged (any follow-up). */
  sentAt: readonly Date[]
  /** The person can be tried on Telegram now (reach.ts telegramEligibility). */
  telegramEligible: boolean
  telegramWhy?: TelegramSkip
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
  // Telegram only when the person can be reached there; the reviewer's channel choice is tried first.
  const preferred: Channel = i.row.channel ?? (i.telegramEligible ? 'TELEGRAM' : 'DISCORD')
  const order: Channel[] = preferred === 'TELEGRAM' ? ['TELEGRAM', 'DISCORD'] : ['DISCORD', 'TELEGRAM']
  const channels = order.filter((c) => c !== 'TELEGRAM' || i.telegramEligible)
  return { action: 'send', channels, ...(!i.telegramEligible && i.telegramWhy ? { telegramSkip: i.telegramWhy } : {}) }
}

/** Body, blank line, footer. The body is cut (with an ellipsis) so the footer always survives `limit`. */
export function composeText(message: string, footer: string, limit = Infinity): string {
  const f = footer.trim()
  const room = limit - f.length - 2
  let body = message.trim()
  if (body.length > room) body = `${body.slice(0, Math.max(0, room - 1)).trimEnd()}…`
  return `${body}\n\n${f}`
}

/** The footer for a channel (both point at buttons: replies to the Telegram bot are not read). */
export const footerFor = (cfg: Pick<FollowUpConfig, 'footerTelegram' | 'footerDiscord'>, channel: Channel) => (channel === 'TELEGRAM' ? cfg.footerTelegram : cfg.footerDiscord)

/** True once an approval is older than `maxDays`. */
export const isStale = (approvedAt: Date | null, now: Date, maxDays: number) => !!approvedAt && now.getTime() - approvedAt.getTime() > maxDays * DAY_MS

export interface Senders {
  telegram: (a: { telegramUserId: string; text: string; buttons?: TelegramButton[][]; idempotencyKey: string }) => Promise<DmResult>
  discord: typeof sendDiscordDm
  recordReach: (telegramId: string, code: DmFailureCode | 'ok', cfg: RecheckCfg) => Promise<void>
}

const realSenders: Senders = { telegram: (a) => sendDm(a), discord: sendDiscordDm, recordReach: (id, code, cfg) => recordResult(id, code, cfg) }

/** Why Telegram did not carry the message (stored on the row). */
export type FallbackReason = TelegramSkip | 'bad-request'

export type Delivered =
  | { ok: true; channel: Channel; discordChannelId?: string; discordMessageId?: string | null; telegramChatId?: string; telegramMessageId?: number; telegramSkip?: FallbackReason; keyDone?: boolean }
  | {
      ok: false
      errors: string[]
      telegramSkip?: FallbackReason
      /** Telegram definitely sent nothing and asked us to wait: put the row back and retry then. */
      retryAfterSec?: number
      /** The Telegram send may have been delivered: never retry on another channel; a human checks first. */
      uncertain?: boolean
      /** The uncertain answer was itself a replay of an earlier one: the proxy cannot confirm this send either. */
      replayUncertain?: boolean
      /** Telegram gave a definite "not sent" answer, so the stored idempotency key must be cleared (a replay would repeat that answer). */
      keyDone?: boolean
    }

/** How long to wait when the proxy is briefly unavailable and gave no retryAfter. */
const UNAVAILABLE_WAIT_SEC = 300

export async function deliverOverChannels(
  channels: readonly Channel[],
  m: {
    id: string
    message: string
    footers: { TELEGRAM: string; DISCORD: string }
    ownerDiscordId: string
    /** The Telegram user id to DM (a private chat id is the user id), or null. */
    telegramChatId: string | null
    /** URL buttons for the Telegram message; null when links cannot be signed. */
    telegramButtons: TelegramButton[][] | null
    /** Idempotency key for this delivery attempt (one per sendAttemptAt). */
    attemptKey: string
    recheck: RecheckCfg
    /** Signed link for the Discord "Open in app" button. */
    discordOpenUrl?: string | null
    locale: string | null
  },
  senders: Senders = realSenders,
): Promise<Delivered> {
  const errors: string[] = []
  let telegramSkip: FallbackReason | undefined
  let keyDone = false
  const extra = (): { telegramSkip?: FallbackReason; keyDone?: true } => ({ ...(telegramSkip ? { telegramSkip } : {}), ...(keyDone ? { keyDone: true as const } : {}) })
  for (const ch of channels) {
    if (ch === 'TELEGRAM') {
      if (!m.telegramChatId || !m.telegramButtons) {
        telegramSkip = telegramSkip ?? 'off'
        continue
      }
      const r = await senders.telegram({ telegramUserId: m.telegramChatId, text: composeText(m.message, m.footers.TELEGRAM, DM_TEXT_LIMIT), buttons: m.telegramButtons, idempotencyKey: m.attemptKey })
      if (r.ok) {
        // A replayed answer is old news: never let it overwrite fresher reach information.
        if (!r.replay) await senders.recordReach(m.telegramChatId, 'ok', m.recheck).catch(() => {})
        return { ok: true, channel: 'TELEGRAM', telegramChatId: m.telegramChatId, telegramMessageId: r.messageId, ...extra() }
      }
      if (r.code === 'not_started' || r.code === 'blocked') {
        keyDone = true
        if (!r.replay) await senders.recordReach(m.telegramChatId, r.code, m.recheck).catch(() => {})
        telegramSkip = r.code === 'blocked' ? 'blocked' : 'not-started'
        errors.push('telegram: cannot message this chat')
      } else if (r.code === 'rate_limited' || r.code === 'unavailable') {
        // Nothing was sent (the proxy guarantees it): try again later instead of falling back.
        keyDone = true
        errors.push(`telegram: ${r.code === 'rate_limited' ? 'rate limited' : 'temporarily unavailable'}`)
        return { ok: false, errors, retryAfterSec: Math.max(1, r.retryAfter ?? UNAVAILABLE_WAIT_SEC), ...extra() }
      } else if (r.code === 'not_configured') {
        keyDone = true
        telegramSkip = 'off'
        errors.push('telegram: not configured')
      } else if (r.code === 'bad_request') {
        console.warn('[followups] the Telegram proxy rejected a message as invalid')
        keyDone = true
        telegramSkip = 'bad-request'
        errors.push('telegram: rejected')
      } else {
        // uncertain: the message may have been delivered already, so never also send on Discord.
        errors.push('telegram: send failed')
        return { ok: false, errors, uncertain: true, ...(r.replay ? { replayUncertain: true } : {}), ...extra() }
      }
    } else {
      try {
        const r = await senders.discord(m.ownerDiscordId, composeText(m.message, m.footers.DISCORD), { components: discordComponents(m.id, m.locale, m.discordOpenUrl) })
        return { ok: true, channel: 'DISCORD', discordChannelId: r.channelId, discordMessageId: r.messageId, ...extra() }
      } catch (e) {
        if (isDmClosed(e)) errors.push('discord: DMs closed')
        else {
          // A 5xx or timeout may have posted: only a clear "cannot DM" falls back to Telegram.
          errors.push('discord: send failed')
          return { ok: false, errors, ...extra() }
        }
      }
    }
  }
  return { ok: false, errors, ...extra() }
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
  const eligibility = telegramEligibility({
    toggleOn: cfg.telegramDmEnabled,
    senderAllowed: telegramSendAllowed(),
    linkSecretSet: !!linkSecret(),
    telegramId: owner.telegram?.telegramId ?? null,
    reach: owner.telegram?.reach ?? null,
    now,
  })
  const decision = decideSend({
    row,
    cfg,
    now,
    optedOut: row.ownerDiscordId ? await isOptedOut(row.ownerDiscordId) : false,
    timezone: owner.timezone,
    sentAt: row.ownerDiscordId ? await recentSendTimes(prisma, row.ownerDiscordId, now, id) : [],
    telegramEligible: eligibility.eligible,
    ...(eligibility.eligible ? {} : { telegramWhy: eligibility.why }),
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
  // One idempotency key per row until a send is confirmed: a re-approve after an uncertain send replays the
  // same key, so the proxy can answer with the stored result instead of sending twice.
  if (marked.ok === false) {
    await prisma.followUp.updateMany({ where: { id, status: 'APPROVED' }, data: { sendAfter: marked.retryAt } })
    await addEvent(id, 'deferred', 'system', { why: 'cap', until: marked.retryAt.toISOString() })
    return 'deferred'
  }
  // Written only once the cap check passed, so a deferred row never holds a key.
  const attemptKey = row.telegramAttemptKey ?? `fu:${id}:${now.getTime()}`
  if (!row.telegramAttemptKey) await prisma.followUp.updateMany({ where: { id, telegramAttemptKey: null }, data: { telegramAttemptKey: attemptKey } })
  const recheck: RecheckCfg = { dmRecheckDays: cfg.dmRecheckDays, dmRecheckMaxDays: cfg.dmRecheckMaxDays }
  const openToken = signLink(id, 'reply', cfg.linkTtlDays, now)
  const result = await deliverOverChannels(
    decision.channels,
    {
      id,
      message: row.message,
      footers: { TELEGRAM: cfg.footerTelegram, DISCORD: cfg.footerDiscord },
      ownerDiscordId: row.ownerDiscordId as string,
      telegramChatId: eligibility.eligible ? (owner.telegram?.telegramId ?? null) : null,
      telegramButtons: eligibility.eligible ? telegramUrlKeyboard(id, owner.locale, cfg.linkTtlDays, now) : null,
      attemptKey,
      recheck,
      discordOpenUrl: openToken ? linkUrl(openToken) : null,
      locale: owner.locale,
    },
    ctx.senders,
  )
  const fallback = result.telegramSkip ?? decision.telegramSkip ?? null
  if (result.ok === false && result.retryAfterSec !== undefined) {
    // The proxy guarantees nothing was sent: clear the attempt marker and try again later.
    const retryAt = new Date(now.getTime() + result.retryAfterSec * 1000)
    await prisma.followUp.updateMany({ where: { id, status: 'APPROVED' }, data: { sendAfter: retryAt, sendAttemptAt: null, telegramAttemptKey: null } })
    await addEvent(id, 'deferred', 'system', { why: 'telegram-retry', until: retryAt.toISOString() })
    return 'deferred'
  }
  if (result.telegramSkip === 'not-started' || result.telegramSkip === 'blocked') {
    await addEvent(id, 'telegram-undeliverable', 'system', { reason: result.telegramSkip })
  }
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
        telegramFallback: fallback,
        ...(result.keyDone ? { telegramAttemptKey: null } : {}),
        ...(result.channel === 'DISCORD' ? { discordChannelId: result.discordChannelId, discordMessageId: result.discordMessageId ?? null } : { telegramChatId: result.telegramChatId, telegramMessageId: result.telegramMessageId }),
      },
      { type: 'sent', actorId: 'system', data: { channel: result.channel } },
    )
    return 'sent'
  }
  if (result.uncertain) {
    // It may have gone out: no Discord copy, no "every channel failed" escalation. A human checks, then re-approves.
    // Second uncertain answer in a row, this time a replay: re-sending the same key can never settle it, so drop the key.
    const twice = result.replayUncertain === true
    const flagged = await guardedTransition(id, 'APPROVED', 'FAILED', { sendAfter: null, error: twice ? UNCONFIRMED_TWICE_TEXT : UNCONFIRMED_TEXT, telegramFallback: fallback, ...(twice ? { telegramAttemptKey: null } : {}) }, { type: 'needs-check', actorId: 'system' })
    return flagged ? 'unreachable' : 'busy'
  }
  const failed = await guardedTransition(id, 'APPROVED', 'UNREACHABLE', { error: result.errors.join('; ').slice(0, 300), sendAfter: null, telegramFallback: fallback, ...(result.keyDone ? { telegramAttemptKey: null } : {}) }, { type: 'failed', actorId: 'system', data: { errors: result.errors.join('; ') } })
  if (!failed) return 'busy'
  return escalate({ ...row, status: 'UNREACHABLE' }, 'unreachable', cfg, now)
}

/** Tell the approvers this person could not be reached. Only when the row really moved to UNREACHABLE. */
export async function escalate(row: FollowUp, reason: EscalateReason, cfg: FollowUpConfig, now: Date): Promise<SendOutcome> {
  if (row.status === 'APPROVED') {
    const moved = await guardedTransition(row.id, 'APPROVED', 'UNREACHABLE', { sendAfter: null, error: REASON_TEXT[reason] }, { type: 'unreachable', actorId: 'system', data: { reason } })
    if (!moved) return 'busy'
  }
  const delivered = await deliverToContacts((await resolveContacts(cfg)).slice(0, MAX_CONTACTS), escalationText(row, reason), cfg)
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
    const ok = await guardedTransition(r.id, 'APPROVED', 'FAILED', { sendAfter: null, error: UNCONFIRMED_TEXT }, { type: 'needs-check', actorId: 'system' })
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
