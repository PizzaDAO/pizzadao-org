/**
 * Call review cards (plans/capo-recap-approval, Phase 2).
 *
 * A recorded Discord call that is IN_REVIEW with a summary gets ONE bot card in the private capo review
 * channel (setting discord.callReviewChannelId, no env or name fallback). The card shows the unreviewed
 * summary, so:
 *   - the bot refuses to post unless the channel denies View Channel to @everyone (checked through the
 *     channel's permission overwrites; anything unreadable counts as not private),
 *   - a held call (manual hold, or the private owner-only filter) shows no summary and no action items,
 *   - nothing here pings anyone (allowed_mentions parse: []).
 *
 * `syncCallReviewCard(id)` is the one entry point. It renders the call's current state and posts the card
 * (claimed through CallReviewCard.claimedAt, so concurrent syncs post one) or edits it in place, only when
 * the render changed (renderedHash). Resolved cards (published, removed, held) lose their buttons. Card
 * bookkeeping lives in its own table so it never bumps CallRecording.updatedAt, which publishRecording
 * guards on.
 *
 * Everything is best effort and never throws into its caller. Gated by calls.reviewCardsEnabled (default
 * off) plus a bot token. Tests inject CallCardDeps, so nothing reaches Discord or the database.
 */
import { after } from 'next/server'
import { prisma } from '@/app/lib/db'
import { getSetting } from '@/app/lib/settings'
import { savedChannelId } from '@/app/lib/settings/channels'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { fetchChannel } from '@/app/lib/discord-channels'
import { DiscordPostError, editDiscordMessage, postDiscordMessage } from '@/app/lib/discord-rest'
import { makeEmbed, type Embed, type EmbedField, type Tone } from '@/app/lib/discord-interactions/embeds'
import { loadPostFilter, type PostFilter } from '@/app/lib/calls/post-filters'
import { heldReason, type HeldReason } from '@/app/lib/calls/hold-rules'
import { neutralizeMentions } from '@/app/lib/calls/recap'
import { callDateTimeFormat } from '@/app/lib/calls/format-call-time'
import { SITE_URL } from '@/app/lib/site-url'
import { createHash } from 'node:crypto'

/** A claimed card that never got a message id (crash mid-post) may be re-posted after this. */
export const STALE_CLAIM_MS = 10 * 60 * 1000
/** Resolved cards are re-checked by the sweep for this long (a published call can come back to review). */
export const RESOLVED_RECHECK_MS = 2 * 86_400_000
export const VIEW_CHANNEL_BIT = BigInt(1) << BigInt(10)

export function reviewCardsEnabled(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  return toggleEnabled('calls.reviewCardsEnabled', env)
}

// ------------------------------------------------------------------- view ---

export type CardState = 'open' | 'published' | 'removed' | 'held'

export interface CallCardView {
  id: string
  source: string
  status: string
  crewLabel: string | null
  title: string | null
  startedAt: Date
  summary: string | null
  actionItems: unknown
  /** Why the owner holds this call (null: not held). Never echoed: a held call shows no summary. */
  held: HeldReason | null
  /** Lines were hidden after the summary was written. */
  staleRedactions: boolean
  /** Card version (cardVersion): changes whenever the summary text or the hidden lines change. */
  version: string
  reviewedBy: string | null
  reviewedAt: Date | null
  /** Where the last publish came from (CallReviewEvent.via). */
  publishedVia: string | null
  card: {
    channelId: string | null
    messageId: string | null
    renderedHash: string | null
    resolvedAt: Date | null
    claimedAt: Date | null
  } | null
}

export interface CardMessage {
  content: string
  embeds: Embed[]
  components: unknown[]
  allowed_mentions: { parse: [] }
}

/** base36 of the newest of summaryGeneratedAt, summaryEditedAt and redactionsUpdatedAt ('0' when none). */
export function cardVersion(r: { summaryGeneratedAt?: Date | null; summaryEditedAt?: Date | null; redactionsUpdatedAt?: Date | null }): string {
  const ms = Math.max(r.summaryGeneratedAt?.getTime() ?? 0, r.summaryEditedAt?.getTime() ?? 0, r.redactionsUpdatedAt?.getTime() ?? 0)
  return ms.toString(36)
}

export function cardState(v: Pick<CallCardView, 'status' | 'held'>): CardState {
  if (v.status === 'REJECTED') return 'removed'
  if (v.status === 'PUBLISHED') return 'published'
  return v.held ? 'held' : 'open'
}

const ts = (d: Date, style = 'f') => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s)
const escapeMd = (s: string) => s.replace(/([*_`~|>\\[\]])/g, '\\$1').replace(/@/g, '@\u200b')
const clean = (s: string, max: number) => clip(escapeMd(neutralizeMentions(s).replace(/\s+/g, ' ').trim()), max)

export const SUMMARY_MAX = 900
export const ACTION_ITEMS_MAX = 8

function actionLines(items: unknown): string[] {
  const out: string[] = []
  for (const raw of Array.isArray(items) ? items : []) {
    if (!raw || typeof raw !== 'object') continue
    const a = raw as { text?: unknown; owner?: unknown }
    const text = typeof a.text === 'string' ? a.text.trim() : ''
    if (!text) continue
    const owner = typeof a.owner === 'string' && a.owner.trim() ? ` (${clean(a.owner, 60)})` : ''
    out.push(`• ${clean(text, 180)}${owner}`)
    if (out.length >= ACTION_ITEMS_MAX) break
  }
  return out
}

/**
 * The card: an embed plus a button row. Pure. A held call shows only crew and date; only an open card
 * shows the summary and action items. Phase 2 carries a link button only.
 */
export function renderCallReviewCard(v: CallCardView, opts: { appUrl: string }): CardMessage {
  const state = cardState(v)
  const when = callDateTimeFormat('en-US').format(v.startedAt)
  const crew = v.crewLabel?.trim() ? clean(v.crewLabel, 80) : 'Call'
  const link = `${opts.appUrl}/admin/calls/${v.id}`
  let tone: Tone = 'cooldown'
  let headline: string
  const body: string[] = []
  const fields: EmbedField[] = []

  if (state === 'open') {
    headline = `Needs review: ${crew}${v.title?.trim() ? ` · ${clean(v.title, 120)}` : ''}`
    body.push(when)
    if (v.summary?.trim()) body.push('', clean(v.summary, SUMMARY_MAX))
    const items = actionLines(v.actionItems)
    if (items.length) fields.push({ name: 'Action items', value: clip(items.join('\n'), 1000) })
    if (v.staleRedactions) fields.push({ name: 'Note', value: 'Lines were hidden after the summary was written. Regenerate or edit the summary on the website before publishing.' })
  } else if (state === 'held') {
    headline = `Held for owner review: ${crew}`
    body.push(when)
  } else if (state === 'published') {
    tone = 'success'
    headline = `Published: ${crew}`
    body.push(when, '')
    const who = v.reviewedBy ? `<@${v.reviewedBy}>` : 'a reviewer'
    const via = v.publishedVia === 'discord' ? ' via Discord' : v.publishedVia === 'web' || v.publishedVia === 'bulk' ? ' via the website' : ''
    body.push(`Published by ${who}${via}${v.reviewedAt ? ` · ${ts(v.reviewedAt)}` : ''}`)
  } else {
    tone = 'error'
    headline = `Removed: ${crew}`
    body.push(when)
  }

  const embed = makeEmbed(tone, headline, body.join('\n'), { fields, footer: { text: `Call review · ${v.id}` } })
  const components = [{ type: 1, components: [{ type: 2, style: 5, label: 'Open on website', url: link }] }]
  return { content: '', embeds: [embed], components, allowed_mentions: { parse: [] } }
}

export function renderHash(msg: CardMessage): string {
  return createHash('sha256').update(JSON.stringify(msg)).digest('hex')
}

// ------------------------------------------------------------------- sync ---

export interface CallCardDeps {
  /** calls.reviewCardsEnabled and a bot token. */
  enabled: () => boolean | Promise<boolean>
  load: (id: string) => Promise<CallCardView | null>
  maxAgeDays: () => Promise<number>
  /** The saved channel id, or '' when none (no env or name fallback). */
  channelId: () => Promise<string>
  /** True only when the channel can be read and denies View Channel to @everyone. */
  channelIsPrivate: (channelId: string) => Promise<boolean>
  claim: (id: string, now: Date) => Promise<boolean>
  unclaim: (id: string) => Promise<void>
  store: (id: string, card: { channelId: string; messageId: string; renderedHash: string }) => Promise<void>
  /** Save the render hash, the resolved time and the last error (null clears it) without touching the message. */
  saveState: (id: string, s: { renderedHash?: string; resolvedAt: Date | null; error: string | null }) => Promise<void>
  /** The Discord message is gone: forget it. */
  clearMessage: (id: string) => Promise<void>
  post: (channelId: string, msg: CardMessage) => Promise<{ id: string | null }>
  edit: (card: { channelId: string; messageId: string }, msg: CardMessage) => Promise<void>
  appUrl: () => string
  now?: () => Date
}

export type CallCardOutcome = 'disabled' | 'missing' | 'edited' | 'unchanged' | 'posted' | 'no_card_needed' | 'claimed_elsewhere' | 'no_channel' | 'channel_not_private' | 'failed'

const isGone = (err: unknown) => err instanceof DiscordPostError && err.status === 404
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim().slice(0, 300)

/** Does this call warrant a NEW card? DISCORD source, IN_REVIEW with a summary, not held, recent enough. */
export function needsNewCard(v: CallCardView, now: Date, maxAgeDays: number): boolean {
  return v.source === 'DISCORD' && v.status === 'IN_REVIEW' && !!v.summary?.trim() && !v.held && v.startedAt.getTime() >= now.getTime() - maxAgeDays * 86_400_000
}

/** Bring the call's card up to date (see the module comment). Never throws. */
export async function syncCallReviewCard(id: string, deps: CallCardDeps = defaultCallCardDeps): Promise<CallCardOutcome> {
  try {
    if (!(await deps.enabled())) return 'disabled'
    const v = await deps.load(id)
    // Imported calls are the owner's backlog: never a card.
    if (!v || v.source !== 'DISCORD') return v ? 'no_card_needed' : 'missing'
    const appUrl = deps.appUrl()
    const now = deps.now?.() ?? new Date()
    const state = cardState(v)
    const resolvedAt = state === 'open' ? null : v.card?.resolvedAt ?? now

    if (v.card?.messageId && v.card.channelId) {
      const msg = renderCallReviewCard(v, { appUrl })
      const hash = renderHash(msg)
      if (hash === v.card.renderedHash) {
        if ((v.card.resolvedAt?.getTime() ?? null) !== (resolvedAt?.getTime() ?? null)) await deps.saveState(id, { resolvedAt, error: null })
        return 'unchanged'
      }
      try {
        await deps.edit({ channelId: v.card.channelId, messageId: v.card.messageId }, msg)
        await deps.saveState(id, { renderedHash: hash, resolvedAt, error: null })
        return 'edited'
      } catch (err) {
        if (!isGone(err)) throw err
        // The message was deleted: forget it, and post a fresh one only while the call is still open.
        await deps.clearMessage(id)
        if (state !== 'open') return 'no_card_needed'
        v.card = { ...v.card, messageId: null, channelId: null, renderedHash: null, claimedAt: null }
      }
    }

    if (!needsNewCard(v, now, await deps.maxAgeDays())) return 'no_card_needed'
    const channelId = await deps.channelId()
    if (!channelId) return 'no_channel'
    if (!(await deps.claim(id, now))) return 'claimed_elsewhere'
    if (!(await deps.channelIsPrivate(channelId))) {
      await deps.unclaim(id)
      await deps.saveState(id, { resolvedAt: null, error: 'channel not private' })
      console.warn('[calls/review-cards] the review channel is not private (it must deny View Channel to @everyone); no card posted')
      return 'channel_not_private'
    }
    const msg = renderCallReviewCard(v, { appUrl })
    let posted: { id: string | null }
    try {
      posted = await deps.post(channelId, msg)
    } catch (err) {
      await deps.unclaim(id)
      await deps.saveState(id, { resolvedAt: null, error: errText(err) }).catch(() => {})
      throw err
    }
    if (!posted.id) return 'posted'
    const hash = renderHash(msg)
    await deps.store(id, { channelId, messageId: posted.id, renderedHash: hash })
    // Changed (published, edited, held) while the card was being posted: show the current state.
    const fresh = await deps.load(id)
    if (fresh) {
      const m2 = renderCallReviewCard(fresh, { appUrl })
      const h2 = renderHash(m2)
      if (h2 !== hash) {
        await deps.edit({ channelId, messageId: posted.id }, m2)
        await deps.saveState(id, { renderedHash: h2, resolvedAt: cardState(fresh) === 'open' ? null : now, error: null })
      }
    }
    return 'posted'
  } catch (err) {
    console.error(`[calls/review-cards] card sync for ${id} failed:`, errText(err))
    return 'failed'
  }
}

/**
 * Run a card sync after the response (next/server `after()`), or right away (fire and forget) outside a
 * request scope. Never throws. Cheap when the feature is off: the toggle is the first thing checked.
 */
export function queueCallReviewCardSync(id: string): void {
  const run = () =>
    syncCallReviewCard(id).then(
      () => undefined,
      (err) => console.error('[calls/review-cards] queued sync failed:', errText(err)),
    )
  try {
    after(run)
  } catch {
    void run()
  }
}

// ------------------------------------------------------------------ sweep ---

export interface SweepDeps extends CallCardDeps {
  /** Ids of calls that need a NEW card (DISCORD, IN_REVIEW, summarized, recent, no posted card). */
  listNew: (since: Date, limit: number) => Promise<string[]>
  /** Ids of calls with a posted card that is open or was resolved recently. */
  listExisting: (resolvedSince: Date, limit: number) => Promise<string[]>
}

export const SWEEP_EXISTING_LIMIT = 50

/**
 * The reconcile sweep (followups cron, every 10 min): posts cards for calls that are due one (at most
 * `limit` per run) and re-renders the existing open or recently resolved cards. Re-rendering costs a
 * database read; Discord is only called when the render changed.
 */
export async function syncDueCallReviewCards(limit = 5, deps: SweepDeps = defaultSweepDeps): Promise<{ posted: number; edited: number; checked: number } | { skipped: string }> {
  try {
    if (!(await deps.enabled())) return { skipped: 'disabled' }
    if (!(await deps.channelId())) return { skipped: 'no channel' }
    const now = deps.now?.() ?? new Date()
    const maxAge = await deps.maxAgeDays()
    // A few spare candidates: some (auto-held, channel problems) end up with no card and must not starve the rest.
    const fresh = await deps.listNew(new Date(now.getTime() - maxAge * 86_400_000), limit * 4)
    const existing = await deps.listExisting(new Date(now.getTime() - RESOLVED_RECHECK_MS), SWEEP_EXISTING_LIMIT)
    let posted = 0
    let edited = 0
    for (const id of fresh) {
      if (posted >= limit) break
      if ((await syncCallReviewCard(id, deps)) === 'posted') posted++
    }
    for (const id of existing) if ((await syncCallReviewCard(id, deps)) === 'edited') edited++
    return { posted, edited, checked: fresh.length + existing.length }
  } catch (err) {
    console.error('[calls/review-cards] sweep failed:', errText(err))
    return { skipped: 'error' }
  }
}

// --------------------------------------------------------------- defaults ---

const botToken = () => process.env.DISCORD_BOT_TOKEN?.trim() ?? ''

/** The @everyone role id is the guild id; an overwrite on it that denies VIEW_CHANNEL makes the channel private. Pure. */
export function everyoneDeniedView(channel: { guildId: string | null; permissionOverwrites?: Array<{ id: string; type: number; allow: string; deny: string }> } | null | undefined): boolean {
  if (!channel?.guildId || !Array.isArray(channel.permissionOverwrites)) return false
  const ow = channel.permissionOverwrites.find((o) => o.id === channel.guildId && Number(o.type) === 0)
  if (!ow) return false
  try {
    return (BigInt(ow.deny) & VIEW_CHANNEL_BIT) !== BigInt(0) && (BigInt(ow.allow) & VIEW_CHANNEL_BIT) === BigInt(0)
  } catch {
    return false
  }
}

const SELECT = {
  id: true,
  source: true,
  status: true,
  crewId: true,
  crewLabel: true,
  eventName: true,
  title: true,
  startedAt: true,
  summary: true,
  actionItems: true,
  chapters: true,
  transcript: true,
  redactedSpeakerIds: true,
  redactedSegmentIds: true,
  reviewHoldAt: true,
  redactionsUpdatedAt: true,
  summaryGeneratedAt: true,
  summaryEditedAt: true,
  reviewedBy: true,
  reviewedAt: true,
  reviewCard: { select: { channelId: true, messageId: true, renderedHash: true, resolvedAt: true, claimedAt: true } },
} as const

export async function loadCallCardView(id: string): Promise<CallCardView | null> {
  const row = await prisma.callRecording.findUnique({ where: { id }, select: SELECT })
  if (!row) return null
  // A filter that can't be read holds the call (fail closed): no summary is shown.
  const filter: PostFilter | null = await loadPostFilter().catch(() => null)
  const lastPublish =
    row.status === 'PUBLISHED'
      ? await prisma.callReviewEvent.findFirst({ where: { recordingId: id, action: 'publish' }, orderBy: { createdAt: 'desc' }, select: { via: true } }).catch(() => null)
      : null
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    crewLabel: row.crewLabel,
    title: row.title,
    startedAt: row.startedAt,
    summary: row.summary,
    actionItems: row.actionItems,
    held: heldReason(row, filter),
    staleRedactions: !!row.redactionsUpdatedAt && row.redactionsUpdatedAt.getTime() > Math.max(row.summaryGeneratedAt?.getTime() ?? 0, row.summaryEditedAt?.getTime() ?? 0),
    version: cardVersion(row),
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    publishedVia: lastPublish?.via ?? null,
    card: row.reviewCard,
  }
}

export const defaultCallCardDeps: CallCardDeps = {
  enabled: async () => (await reviewCardsEnabled()) && !!botToken(),
  load: loadCallCardView,
  maxAgeDays: async () => getSetting('calls.reviewCardMaxAgeDays').catch(() => 14),
  channelId: () => savedChannelId('discord.callReviewChannelId'),
  async channelIsPrivate(channelId) {
    const r = await fetchChannel(channelId, { botToken: botToken() })
    return r.ok && everyoneDeniedView(r.channel)
  },
  async claim(id, now) {
    const created = await prisma.callReviewCard.createMany({ data: [{ recordingId: id, claimedAt: now }], skipDuplicates: true })
    if (created.count === 1) return true
    const r = await prisma.callReviewCard.updateMany({
      where: { recordingId: id, messageId: null, OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }] },
      data: { claimedAt: now },
    })
    return r.count === 1
  },
  async unclaim(id) {
    await prisma.callReviewCard.updateMany({ where: { recordingId: id, messageId: null }, data: { claimedAt: null } })
  },
  async store(id, card) {
    await prisma.callReviewCard.upsert({
      where: { recordingId: id },
      create: { recordingId: id, ...card, claimedAt: new Date() },
      update: { ...card, error: null },
    })
  },
  async saveState(id, s) {
    await prisma.callReviewCard.upsert({
      where: { recordingId: id },
      create: { recordingId: id, ...(s.renderedHash ? { renderedHash: s.renderedHash } : {}), resolvedAt: s.resolvedAt, error: s.error },
      update: { ...(s.renderedHash ? { renderedHash: s.renderedHash } : {}), resolvedAt: s.resolvedAt, error: s.error },
    })
  },
  async clearMessage(id) {
    await prisma.callReviewCard.updateMany({ where: { recordingId: id }, data: { channelId: null, messageId: null, renderedHash: null, claimedAt: null } })
  },
  post: (channelId, msg) => postDiscordMessage({ kind: 'bot', channelId, botToken: botToken() }, msg),
  edit: (card, msg) => editDiscordMessage({ ...card, botToken: botToken() }, msg),
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL?.trim() || SITE_URL).replace(/\/$/, ''),
}

export const defaultSweepDeps: SweepDeps = {
  ...defaultCallCardDeps,
  async listNew(since, limit) {
    const rows = await prisma.callRecording.findMany({
      where: {
        source: 'DISCORD',
        status: 'IN_REVIEW',
        summary: { not: null },
        startedAt: { gte: since },
        reviewHoldAt: null,
        OR: [{ reviewCard: null }, { reviewCard: { messageId: null } }],
      },
      orderBy: { startedAt: 'asc' },
      take: limit,
      select: { id: true },
    })
    return rows.map((r) => r.id)
  },
  async listExisting(resolvedSince, limit) {
    const rows = await prisma.callReviewCard.findMany({
      where: { messageId: { not: null }, recording: { source: 'DISCORD' }, OR: [{ resolvedAt: null }, { resolvedAt: { gte: resolvedSince } }] },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { recordingId: true },
    })
    return rows.map((r) => r.recordingId)
  },
}
