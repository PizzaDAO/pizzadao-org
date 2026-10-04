/**
 * Mission review SLA (plans/mission-verification.md §5.3, decision D13): a
 * first decision within 48 hours at every level.
 *
 * GET /api/cron/mission-sla (daily, vercel.json) runs `runSlaDigest()`: when
 * any PENDING submission has waited more than 48 hours in the human queue it
 * posts ONE summary card in #work (MISSION_REVIEW_CHANNEL_ID, else "work"),
 * listing the overdue items oldest first with a link to each review card, and
 * pings the roles that may review them (the admin + reviewer roles; Dread
 * Pizza Roberts for L8). Never @everyone / @here: allowed_mentions lists only
 * those role ids.
 *
 * At most once per UTC day: the day is claimed by inserting a
 * MissionSlaDigest row (primary key = the date) before posting, so a retried
 * or doubled cron invocation cannot post twice. A failed post releases the
 * claim so a manual re-run can try again. Nothing overdue = no post.
 *
 * The SLA clock is `reviewQueuedAt` (when the row entered or re-entered the
 * queue: submit, resubmit, auto-hold, reopen), falling back to `submittedAt`
 * for rows from before Phase 3.
 *
 * Gated by MISSION_REVIEW_CARDS_ENABLED like the review cards (default off).
 * Tests inject SlaDeps.
 */
import type { MissionHold } from '@prisma/client'
import { prisma } from '../db'
import { resolveChannelId } from '../discord-channels'
import { postDiscordMessage, type DiscordMessageBody } from '../discord-rest'
import { makeEmbed } from '../discord-interactions/embeds'
import { missionReviewerRoleIds } from '../mission-review-access'
import { reviewCardsEnabled, missionLabel } from './review-cards'

export const SLA_HOURS = 48
const SLA_MS = SLA_HOURS * 3_600_000
/** Lines listed in the digest; the rest are counted. */
export const DIGEST_MAX_LINES = 15

export interface SlaCandidate {
  id: number
  discordId: string
  level: number
  index: number
  title: string
  holdReason: MissionHold | null
  submittedAt: Date
  reviewQueuedAt: Date | null
  reviewMsgId: string | null
  reviewChannelId: string | null
}

export interface OverdueItem extends SlaCandidate {
  queuedAt: Date
  waitingMs: number
}

/** PENDING candidates waiting longer than the SLA, oldest first. Pure. */
export function selectOverdue(rows: SlaCandidate[], now: Date, slaMs = SLA_MS): OverdueItem[] {
  return rows
    .map((r) => {
      const queuedAt = r.reviewQueuedAt ?? r.submittedAt
      return { ...r, queuedAt, waitingMs: now.getTime() - queuedAt.getTime() }
    })
    .filter((r) => r.waitingMs > slaMs)
    .sort((a, b) => b.waitingMs - a.waitingMs || a.id - b.id)
}

/** The UTC day key used for the once-a-day claim. */
export const dayKey = (now: Date) => now.toISOString().slice(0, 10)

export interface SlaDeps {
  enabled: () => boolean
  /** Every PENDING completion (the queue is small). */
  pending: () => Promise<SlaCandidate[]>
  /** Insert today's MissionSlaDigest row; false when it already exists. */
  claimDay: (day: string) => Promise<boolean>
  releaseDay: (day: string) => Promise<void>
  recordDay: (day: string, r: { channelId: string; messageId: string | null; overdue: number }) => Promise<void>
  markNotified: (ids: number[], now: Date) => Promise<void>
  resolveChannel: () => Promise<string | null>
  post: (channelId: string, body: DiscordMessageBody) => Promise<{ id: string | null }>
  guildId: () => string | null
  appUrl: () => string
}

export type SlaResult =
  | { status: 'disabled' }
  | { status: 'none'; pending: number }
  | { status: 'already_sent'; day: string; overdue: number }
  | { status: 'no_channel'; overdue: number }
  | { status: 'posted'; day: string; overdue: number; messageId: string | null; roles: string[] }

const fmtWait = (ms: number) => {
  const h = Math.floor(ms / 3_600_000)
  return h >= 48 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`
}

/** Roles that may review at least one overdue item. */
export function rolesToPing(items: Array<{ level: number }>): string[] {
  const ids = new Set<string>()
  for (const level of new Set(items.map((i) => i.level))) for (const id of missionReviewerRoleIds(level)) ids.add(id)
  return [...ids]
}

/** The digest message. Pure. */
export function renderSlaDigest(items: OverdueItem[], opts: { guildId: string | null; appUrl: string }): DiscordMessageBody {
  const roles = rolesToPing(items)
  const lines = items.slice(0, DIGEST_MAX_LINES).map((it) => {
    const link =
      it.reviewMsgId && it.reviewChannelId && opts.guildId
        ? `https://discord.com/channels/${opts.guildId}/${it.reviewChannelId}/${it.reviewMsgId}`
        : `${opts.appUrl}/missions`
    const hold = it.holdReason ? ' · needs approval' : ''
    return `**${missionLabel(it)}** · <@${it.discordId}> · waiting ${fmtWait(it.waitingMs)}${hold} · [review](<${link}>)`
  })
  const more = items.length > DIGEST_MAX_LINES ? `\n…and ${items.length - DIGEST_MAX_LINES} more in [the app](<${opts.appUrl}/missions>).` : ''
  const n = items.length
  const embed = makeEmbed(
    'cooldown',
    `${n} mission review${n === 1 ? ' is' : 's are'} past the ${SLA_HOURS}h target`,
    `${lines.map((l, i) => `${i + 1} - ${l}`).join('\n')}${more}`,
    { footer: { text: `Daily review digest · decisions within ${SLA_HOURS} hours` } },
  )
  return {
    content: roles.map((r) => `<@&${r}>`).join(' '),
    embeds: [embed],
    allowed_mentions: { parse: [], roles },
  }
}

export async function runSlaDigest(deps: SlaDeps = defaultSlaDeps, now = new Date()): Promise<SlaResult> {
  if (!deps.enabled()) return { status: 'disabled' }
  const pending = await deps.pending()
  const overdue = selectOverdue(pending, now)
  if (overdue.length === 0) return { status: 'none', pending: pending.length }

  const day = dayKey(now)
  if (!(await deps.claimDay(day))) return { status: 'already_sent', day, overdue: overdue.length }

  const channelId = await deps.resolveChannel()
  if (!channelId) {
    await deps.releaseDay(day)
    console.warn('[mission-sla] no #work channel (set MISSION_REVIEW_CHANNEL_ID); digest not posted')
    return { status: 'no_channel', overdue: overdue.length }
  }
  const body = renderSlaDigest(overdue, { guildId: deps.guildId(), appUrl: deps.appUrl() })
  let posted: { id: string | null }
  try {
    posted = await deps.post(channelId, body)
  } catch (err) {
    await deps.releaseDay(day).catch(() => {})
    throw err
  }
  await deps.recordDay(day, { channelId, messageId: posted.id, overdue: overdue.length })
  await deps.markNotified(
    overdue.map((o) => o.id),
    now,
  )
  return { status: 'posted', day, overdue: overdue.length, messageId: posted.id, roles: body.allowed_mentions?.roles ?? [] }
}

export const defaultSlaDeps: SlaDeps = {
  enabled: () => reviewCardsEnabled() && !!process.env.DISCORD_BOT_TOKEN?.trim(),
  async pending() {
    const rows = await prisma.missionCompletion.findMany({
      where: { status: 'PENDING' },
      select: {
        id: true,
        discordId: true,
        holdReason: true,
        submittedAt: true,
        reviewQueuedAt: true,
        reviewMsgId: true,
        reviewChannelId: true,
        mission: { select: { level: true, index: true, title: true } },
      },
    })
    return rows.map(({ mission, ...r }) => ({ ...r, ...mission }))
  },
  async claimDay(day) {
    try {
      await prisma.missionSlaDigest.create({ data: { day } })
      return true
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') return false
      throw e
    }
  },
  async releaseDay(day) {
    await prisma.missionSlaDigest.deleteMany({ where: { day, messageId: null } })
  },
  async recordDay(day, r) {
    await prisma.missionSlaDigest.update({ where: { day }, data: { channelId: r.channelId, messageId: r.messageId, overdue: r.overdue } })
  },
  async markNotified(ids, now) {
    if (ids.length) await prisma.missionCompletion.updateMany({ where: { id: { in: ids } }, data: { slaNotifiedAt: now } })
  },
  resolveChannel: () => resolveChannelId('work', 'MISSION_REVIEW_CHANNEL_ID'),
  async post(channelId, body) {
    return postDiscordMessage({ kind: 'bot', channelId, botToken: process.env.DISCORD_BOT_TOKEN?.trim() ?? '' }, body)
  },
  guildId: () => process.env.DISCORD_GUILD_ID?.trim() || null,
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://app.pizzadao.org').replace(/\/$/, ''),
}
