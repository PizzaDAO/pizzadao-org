/**
 * The Discord review queue (plans/mission-verification.md §5.2, Phase 3).
 *
 * Every submission that needs a human gets one Pepperoni Bot card in #work
 * (MISSION_REVIEW_CHANNEL_ID, else the channel named "work"):
 *
 *   - a member's PENDING submission or resubmission,
 *   - an auto-verified completion held for a human approval (L6+, a new
 *     Discord account, a previously rejected mission).
 *
 * The card shows the member, level and mission, the evidence (a link, or the
 * image itself), the attempt count, any hold reason, what the verifier saw,
 * duplicate-account signals and the member's flagged completions, with
 * Approve and Reject buttons (a hold's Approve keeps the `mr:release` id and
 * is audited as RELEASED). The buttons are handled
 * by /api/discord/interactions (./review-decision.ts).
 *
 * `syncReviewCard(id)` is the one entry point: it renders the completion's
 * current state and either posts the card (PENDING, no card yet) or edits the
 * existing one (any change: a decision on the web or in Discord, a hold, an
 * automatic approval). Decided cards show the outcome, who acted and when,
 * with the buttons disabled. Posting is claimed with a conditional update
 * (`reviewCardAt`), so concurrent syncs post one card per review round; a
 * resubmission or a reopen clears the card fields and starts a new round.
 *
 * Everything here is best effort and meant to run in `after()`: it never
 * blocks a web request and never throws into one. Gated by
 * MISSION_REVIEW_CARDS_ENABLED (default off) plus a DISCORD_BOT_TOKEN. Cards
 * for human submissions do not depend on MISSION_VERIFIERS_ENABLED (holds
 * only exist while it is on). Tests inject ReviewCardDeps, so nothing reaches
 * Discord or the DB.
 */
import { after } from 'next/server'
import type { MissionHold, MissionStatus, Prisma } from '@prisma/client'
import { prisma } from '../db'
import { resolveChannelId } from '../discord-channels'
import { editDiscordMessage, postDiscordMessage } from '../discord-rest'
import { makeEmbed, type Embed, type EmbedField, type Tone } from '../discord-interactions/embeds'
import { attemptsSoFar, MAX_MISSION_ATTEMPTS } from '../missions'
import { CHECK_ID_KEYS, mentionFor } from './check-labels'
import { HOLD_LABEL } from './policy'
import { getSignalViews, type AccountSignalView } from './review-extras'
import { reviewButtonId, type CardRef } from './review-ids'

export type { CardRef } from './review-ids'

// ------------------------------------------------------------------ config ---

export function reviewCardsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'on', 'yes'].includes((env.MISSION_REVIEW_CARDS_ENABLED ?? '').trim().toLowerCase())
}

/** A claimed card that never got a message id (crash mid-post) may be re-posted after this. */
export const STALE_CLAIM_MS = 10 * 60 * 1000

// ------------------------------------------------------------------- view ---

export interface ReviewCardView {
  id: number
  discordId: string
  status: MissionStatus
  holdReason: MissionHold | null
  level: number
  index: number
  title: string
  evidence: string | null
  attempts: number
  submittedAt: Date
  queuedAt: Date
  reviewedBy: string | null
  reviewedAt: Date | null
  reviewNote: string | null
  /** The last human / automatic decision event (a hold's approval is audited as RELEASED). */
  decision: 'APPROVED' | 'RELEASED' | 'REJECTED' | 'AUTO_APPROVED' | null
  checkResult: Prisma.JsonValue | null
  reviewMsgId: string | null
  reviewChannelId: string | null
  reviewCardAt: Date | null
  signals: AccountSignalView[]
  flags: Array<{ level: number; index: number; title: string; reason: string | null }>
}

export interface CardMessage {
  content: string
  embeds: Embed[]
  components: unknown[]
  allowed_mentions: { parse: [] }
}

const ts = (d: Date, style = 'R') => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`
export const missionLabel = (v: { level: number; index: number; title: string }) => `L${v.level}.${v.index} · ${v.title}`

function escapeMd(s: string): string {
  return s.replace(/([*_`~|>\\[\]])/g, '\\$1').replace(/@/g, '@\u200b')
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function httpsUrl(raw: string | null): URL | null {
  if (!raw) return null
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

/** Evidence Discord can show inline: an https image link. */
export function evidenceImage(evidence: string | null): string | null {
  const u = httpsUrl(evidence)
  if (!u) return null
  if (/\.(png|jpe?g|gif|webp)$/i.test(u.pathname) || u.hostname.endsWith('.public.blob.vercel-storage.com')) return u.toString()
  return null
}

function evidenceField(evidence: string | null): string {
  if (!evidence?.trim()) return 'None'
  const u = httpsUrl(evidence)
  if (u && evidence.trim().length <= 900) return `[${escapeMd(clip(u.host + u.pathname, 80))}](<${u.toString()}>)`
  return clip(escapeMd(evidence.trim()), 1000)
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '🟢 every pre-check passed',
  medium: '🟡 some things need your eye',
  low: '🔴 a pre-check failed: look closely',
}

/**
 * What the verifier saw. A semi-automatic pre-check (Phase 4) is shown as its
 * summary, the checks as ✅ / ❌ / 👀 lines and a confidence hint; an automatic
 * verifier's snapshot as a few "key: value" lines.
 */
export function checkLines(check: Prisma.JsonValue | null): string | null {
  if (!check || typeof check !== 'object' || Array.isArray(check)) return null
  const semi = check as { summary?: unknown; checks?: unknown; confidence?: unknown }
  if (Array.isArray(semi.checks)) {
    const out: string[] = []
    if (typeof semi.summary === 'string' && semi.summary) out.push(`**${escapeMd(clip(semi.summary, 200))}**`)
    for (const c of semi.checks.slice(0, 8) as Array<{ label?: unknown; ok?: unknown }>) {
      if (typeof c?.label !== 'string') continue
      out.push(`${c.ok === true ? '✅' : c.ok === false ? '❌' : '👀'} ${escapeMd(clip(c.label, 160))}`)
    }
    if (typeof semi.confidence === 'string' && CONFIDENCE_LABEL[semi.confidence]) out.push(`Confidence: ${CONFIDENCE_LABEL[semi.confidence]}`)
    return out.length ? clip(out.join('\n'), 1000) : null
  }
  const lines: string[] = []
  for (const [k, v] of Object.entries(check)) {
    if (v === null || v === undefined) continue
    const kind = CHECK_ID_KEYS[k]
    const ids = kind && kind !== 'message' ? (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string' && /^\d{5,25}$/.test(x)) : []
    if (ids.length) {
      // Discord IDs as mentions, which Discord renders as role / channel / member names.
      lines.push(`${escapeMd(k)}: ${ids.slice(0, 10).map((id) => mentionFor(kind, id)).join(', ')}`)
    } else {
      const value = typeof v === 'object' ? JSON.stringify(v) : String(v)
      lines.push(`${escapeMd(k)}: ${escapeMd(clip(value, 120))}`)
    }
    if (lines.length >= 6) break
  }
  return lines.length ? clip(lines.join('\n'), 1000) : null
}

/** A proof preview image from the pre-check (link unfurl, YouTube / POAP / party image). https only. */
export function previewImage(check: Prisma.JsonValue | null): string | null {
  if (!check || typeof check !== 'object' || Array.isArray(check)) return null
  const c = check as { preview?: { image?: unknown; kind?: unknown; url?: unknown }; data?: { thumbnail?: unknown; image?: unknown } }
  const candidates = [c.data?.thumbnail, c.data?.image, c.preview?.image, c.preview?.kind === 'image' ? c.preview?.url : null]
  for (const x of candidates) if (typeof x === 'string' && httpsUrl(x)) return x
  return null
}

function decisionLine(v: ReviewCardView): string | null {
  if (v.status === 'PENDING') return null
  const when = v.reviewedAt ? ` · ${ts(v.reviewedAt, 'f')}` : ''
  const auto = !v.reviewedBy || v.reviewedBy.startsWith('auto:') || v.reviewedBy === 'auto'
  if (v.status === 'APPROVED') {
    if (auto) return `✅ Verified automatically${when}`
    return `✅ Approved by <@${v.reviewedBy}>${when}`
  }
  return `❌ Rejected by ${auto ? 'the verifier' : `<@${v.reviewedBy}>`}${when}`
}

/** The card: an embed in the Pepperoni Bot style plus the button row. Pure. */
export function renderReviewCard(v: ReviewCardView, opts: { appUrl: string }): CardMessage {
  const decided = v.status !== 'PENDING'
  const label = missionLabel(v)
  let tone: Tone = 'cooldown'
  let headline = v.holdReason ? `Auto-verified, needs approval: ${label}` : `Needs review: ${label}`
  if (v.status === 'APPROVED') {
    tone = 'success'
    headline = `Approved: ${label}`
  } else if (v.status === 'REJECTED') {
    tone = 'error'
    headline = `Rejected: ${label}`
  }

  const attempts = `attempt ${Math.min(v.attempts, MAX_MISSION_ATTEMPTS)} of ${MAX_MISSION_ATTEMPTS}`
  const body = [`<@${v.discordId}> · Level ${v.level} · ${attempts}`, `Waiting since ${ts(v.queuedAt)}`]
  const decision = decisionLine(v)
  if (decision) body.push('', decision)

  const fields: EmbedField[] = [{ name: 'Evidence', value: evidenceField(v.evidence) }]
  if (v.holdReason) fields.push({ name: 'Approval needed', value: HOLD_LABEL[v.holdReason] })
  const checks = checkLines(v.checkResult)
  if (checks) fields.push({ name: 'Verifier saw', value: checks })
  if (v.signals.length) {
    const lines = v.signals.map((s) => `⚠️ ${s.label}${s.others.length ? ` ${s.others.slice(0, 5).map((d) => `<@${d}>`).join(', ')}` : ''}`)
    fields.push({ name: 'Duplicate-account signals', value: clip(lines.join('\n'), 1000) })
  }
  if (v.flags.length) {
    const lines = v.flags.map((f) => `🚩 ${escapeMd(missionLabel(f))}${f.reason ? `: ${escapeMd(clip(f.reason, 120))}` : ''}`)
    fields.push({ name: 'Flagged completions', value: clip(lines.join('\n'), 1000) })
  }
  if (v.status === 'REJECTED' && v.reviewNote) fields.push({ name: 'Reason', value: clip(escapeMd(v.reviewNote), 1000) })

  const image = v.status === 'PENDING' ? evidenceImage(v.evidence) : null
  const thumb = !image && v.status === 'PENDING' ? previewImage(v.checkResult) : null
  const embed = makeEmbed(tone, headline, body.join('\n'), {
    fields,
    footer: { text: `Mission review · completion #${v.id}` },
    ...(image ? { image: { url: image } } : {}),
    ...(thumb ? { thumbnail: { url: thumb } } : {}),
  })

  const buttons = [
    v.holdReason && !decided
      ? { type: 2, style: 3, label: 'Approve', custom_id: reviewButtonId('release', v.id) }
      : { type: 2, style: 3, label: 'Approve', custom_id: reviewButtonId('approve', v.id) },
    { type: 2, style: 4, label: 'Reject', custom_id: reviewButtonId('reject', v.id) },
  ].map((b) => (decided ? { ...b, disabled: true } : b))
  const components = [{ type: 1, components: [...buttons, { type: 2, style: 5, label: 'Open in app', url: `${opts.appUrl}/missions` }] }]

  return { content: '', embeds: [embed], components, allowed_mentions: { parse: [] } }
}

// ------------------------------------------------------------------- sync ---

export interface ReviewCardDeps {
  /** MISSION_REVIEW_CARDS_ENABLED and a bot token. */
  enabled: () => boolean
  load: (completionId: number) => Promise<ReviewCardView | null>
  /** Conditional claim of the right to post this round's card. */
  claim: (completionId: number, now: Date) => Promise<boolean>
  /** Undo a claim whose post failed (so a later sync can retry). */
  unclaim: (completionId: number) => Promise<void>
  store: (completionId: number, card: CardRef) => Promise<void>
  /** Completion ids for these missions of one member. */
  idsFor: (discordId: string, missionIds: number[]) => Promise<number[]>
  resolveChannel: () => Promise<string | null>
  post: (channelId: string, msg: CardMessage) => Promise<{ id: string | null }>
  edit: (card: CardRef, msg: CardMessage) => Promise<void>
  appUrl: () => string
  now?: () => Date
}

export type SyncOutcome = 'disabled' | 'missing' | 'edited' | 'posted' | 'no_card_needed' | 'claimed_elsewhere' | 'no_channel' | 'failed'

/**
 * Bring the completion's Discord card up to date (see the module comment).
 * `hint` is the card message an interaction came from, used when its id was
 * never stored. Never throws.
 */
export async function syncReviewCard(completionId: number, deps: ReviewCardDeps = defaultReviewCardDeps, hint?: CardRef): Promise<SyncOutcome> {
  try {
    if (!deps.enabled()) return 'disabled'
    const v = await deps.load(completionId)
    if (!v) return 'missing'
    const appUrl = deps.appUrl()

    let card: CardRef | null = v.reviewMsgId && v.reviewChannelId ? { channelId: v.reviewChannelId, messageId: v.reviewMsgId } : null
    if (!card && hint) {
      await deps.store(completionId, hint)
      card = hint
    }
    if (card) {
      await deps.edit(card, renderReviewCard(v, { appUrl }))
      return 'edited'
    }

    if (v.status !== 'PENDING') return 'no_card_needed'
    const now = deps.now?.() ?? new Date()
    if (!(await deps.claim(completionId, now))) return 'claimed_elsewhere'

    const channelId = await deps.resolveChannel()
    if (!channelId) {
      console.warn('[mission review] no #work channel (set MISSION_REVIEW_CHANNEL_ID); card not posted')
      await deps.unclaim(completionId)
      return 'no_channel'
    }
    let posted: { id: string | null }
    try {
      posted = await deps.post(channelId, renderReviewCard(v, { appUrl }))
    } catch (err) {
      await deps.unclaim(completionId)
      throw err
    }
    if (!posted.id) return 'posted'
    const ref = { channelId, messageId: posted.id }
    await deps.store(completionId, ref)

    // Decided (or held) while the card was being posted: show the current state.
    const fresh = await deps.load(completionId)
    if (fresh && (fresh.status !== v.status || fresh.holdReason !== v.holdReason)) {
      await deps.edit(ref, renderReviewCard(fresh, { appUrl }))
    }
    return 'posted'
  } catch (err) {
    console.error(`[mission review] card sync for completion ${completionId} failed:`, err)
    return 'failed'
  }
}

/** Sync the cards of one member's completions for these missions (submit, verifier runs). */
export async function syncReviewCardsFor(discordId: string, missionIds: number[], deps: ReviewCardDeps = defaultReviewCardDeps): Promise<SyncOutcome[]> {
  if (!deps.enabled() || missionIds.length === 0) return []
  try {
    const ids = await deps.idsFor(discordId, [...new Set(missionIds)])
    const out: SyncOutcome[] = []
    for (const id of ids) out.push(await syncReviewCard(id, deps))
    return out
  } catch (err) {
    console.error('[mission review] card sync failed:', err)
    return ['failed']
  }
}

/**
 * Run a card sync after the response (next/server `after()`), or right away
 * (fire and forget) outside a request scope, e.g. a script. Never throws.
 */
export function queueReviewCardSync(job: () => Promise<unknown>): void {
  const run = () =>
    job().then(
      () => undefined,
      (err) => console.error('[mission review] queued card sync failed:', err),
    )
  try {
    after(run)
  } catch {
    void run()
  }
}

// --------------------------------------------------------------- defaults ---

const botToken = () => process.env.DISCORD_BOT_TOKEN?.trim() ?? ''

export async function loadReviewCardView(completionId: number): Promise<ReviewCardView | null> {
  const row = await prisma.missionCompletion.findUnique({
    where: { id: completionId },
    select: {
      id: true,
      discordId: true,
      status: true,
      holdReason: true,
      evidence: true,
      attempts: true,
      notes: true,
      submittedAt: true,
      reviewQueuedAt: true,
      reviewedBy: true,
      reviewedAt: true,
      reviewNote: true,
      checkResult: true,
      reviewMsgId: true,
      reviewChannelId: true,
      reviewCardAt: true,
      mission: { select: { level: true, index: true, title: true } },
      events: {
        where: { action: { in: ['APPROVED', 'RELEASED', 'REJECTED', 'AUTO_APPROVED'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { action: true },
      },
    },
  })
  if (!row) return null
  const [signals, flagged] = await Promise.all([
    getSignalViews([row.discordId]),
    prisma.missionCompletion
      .findMany({
        where: { discordId: row.discordId, flaggedAt: { not: null } },
        select: { flagReason: true, mission: { select: { level: true, index: true, title: true } } },
        take: 5,
      })
      .catch(() => []),
  ])
  return {
    id: row.id,
    discordId: row.discordId,
    status: row.status,
    holdReason: row.holdReason,
    level: row.mission.level,
    index: row.mission.index,
    title: row.mission.title,
    evidence: row.evidence,
    attempts: attemptsSoFar(row),
    submittedAt: row.submittedAt,
    queuedAt: row.reviewQueuedAt ?? row.submittedAt,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    reviewNote: row.reviewNote,
    decision: (row.events[0]?.action as ReviewCardView['decision']) ?? null,
    checkResult: row.checkResult,
    reviewMsgId: row.reviewMsgId,
    reviewChannelId: row.reviewChannelId,
    reviewCardAt: row.reviewCardAt,
    signals: signals.get(row.discordId) ?? [],
    flags: flagged.map((f) => ({ ...f.mission, reason: f.flagReason })),
  }
}

export const defaultReviewCardDeps: ReviewCardDeps = {
  enabled: () => reviewCardsEnabled() && !!botToken(),
  load: loadReviewCardView,
  async claim(completionId, now) {
    const r = await prisma.missionCompletion.updateMany({
      where: {
        id: completionId,
        status: 'PENDING',
        reviewMsgId: null,
        OR: [{ reviewCardAt: null }, { reviewCardAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }],
      },
      data: { reviewCardAt: now },
    })
    return r.count === 1
  },
  async unclaim(completionId) {
    await prisma.missionCompletion.updateMany({ where: { id: completionId, reviewMsgId: null }, data: { reviewCardAt: null } })
  },
  async store(completionId, card) {
    await prisma.missionCompletion.update({
      where: { id: completionId },
      data: { reviewMsgId: card.messageId, reviewChannelId: card.channelId },
    })
  },
  async idsFor(discordId, missionIds) {
    const rows = await prisma.missionCompletion.findMany({ where: { discordId, missionId: { in: missionIds } }, select: { id: true } })
    return rows.map((r) => r.id)
  },
  resolveChannel: () => resolveChannelId('work', 'MISSION_REVIEW_CHANNEL_ID'),
  post: (channelId, msg) => postDiscordMessage({ kind: 'bot', channelId, botToken: botToken() }, msg),
  edit: (card, msg) => editDiscordMessage({ ...card, botToken: botToken() }, msg),
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://app.pizzadao.org').replace(/\/$/, ''),
}
