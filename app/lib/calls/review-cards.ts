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
import { CALL_CAPO_ROLE_IDS, DREAD_PIZZA_ROBERTS_ROLE_ID } from '@/app/ui/constants'
import { callApproveId, callHoldId } from '@/app/lib/discord-interactions/call-review'
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

export type CardState = 'open' | 'stale' | 'published' | 'removed' | 'held'

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
  /** Discord buttons are live (calls.capoReviewEnabled is on too): without it the card only links to the website. */
  interactive: boolean
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

/**
 * The card version: base36 of the newest of summaryGeneratedAt, summaryEditedAt and redactionsUpdatedAt,
 * plus a short hash of the title (a title-only edit changes neither stamp, but the card and the recap show
 * it). Lower-case letters and digits only, so it fits a custom id.
 */
export function cardVersion(r: { summaryGeneratedAt?: Date | null; summaryEditedAt?: Date | null; redactionsUpdatedAt?: Date | null; title?: string | null }): string {
  const ms = Math.max(r.summaryGeneratedAt?.getTime() ?? 0, r.summaryEditedAt?.getTime() ?? 0, r.redactionsUpdatedAt?.getTime() ?? 0)
  const h = createHash('sha256').update(r.title ?? '').digest().readUInt32BE(0) % 1679616 // 36^4
  return ms.toString(36) + h.toString(36).padStart(4, '0')
}

export function cardState(v: Pick<CallCardView, 'status' | 'held'> & { staleRedactions?: boolean }): CardState {
  if (v.status === 'REJECTED') return 'removed'
  if (v.status === 'PUBLISHED') return 'published'
  if (v.held) return 'held'
  // Lines were hidden after the summary was written: the summary on the card may show what was hidden.
  return v.staleRedactions ? 'stale' : 'open'
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
 * shows the summary and action items. An open card has Approve / Needs owner buttons (handled in discord-interactions/call-review.ts).
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
  } else if (state === 'stale') {
    headline = `Needs the website: ${crew}`
    body.push(when, '', 'Lines were hidden after the summary was written. Regenerate or edit the summary on the website, then approve.')
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
  const open = { type: 2, style: 5, label: 'Open on website', url: link }
  // An open card carries the Discord buttons (the version binds Approve to the text on the card); a resolved one only the link.
  const components = [{ type: 1, components: state === 'open' && v.interactive ? [{ type: 2, style: 3, label: 'Approve & publish', custom_id: callApproveId(v.id, v.version) }, { type: 2, style: 2, label: 'Needs owner', custom_id: callHoldId(v.id) }, open] : [open] }]
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
  /** Save the render hash, the resolved time and the last error (null clears it, undefined leaves it) without touching the message. */
  saveState: (id: string, s: { renderedHash?: string; resolvedAt: Date | null; error?: string | null }) => Promise<void>
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

/** Is it safe to show the unreviewed summary in this channel? It must still be the configured channel, and private. */
async function openAllowed(deps: CallCardDeps, channelId: string): Promise<boolean> {
  const current = await deps.channelId()
  return !!current && current === channelId && (await deps.channelIsPrivate(channelId))
}

/** Error marker: Discord may hold a card we have no record of. The claim stays blocked (no automatic repost) until an owner clears it. */
export const POSTED_UNSTORED = 'posted-unstored'

/** Bring the call's card up to date (see the module comment). Never throws. */
export async function syncCallReviewCard(id: string, deps: CallCardDeps = defaultCallCardDeps): Promise<CallCardOutcome> {
  try {
    if (!(await deps.enabled())) return 'disabled'
    const v = await deps.load(id)
    // Imported calls are the owner's backlog: never a card.
    if (!v || v.source !== 'DISCORD') return v ? 'no_card_needed' : 'missing'
    // An existing card is only shown with its summary while its channel is still the configured, private one;
    // otherwise it is collapsed like a held call (checked on every sync, so a changed or opened-up channel closes it).
    if (v.card?.messageId && v.card.channelId && cardState(v) === 'open' && !(await openAllowed(deps, v.card.channelId))) v.held = 'unreadable'
    const appUrl = deps.appUrl()
    const now = deps.now?.() ?? new Date()
    const state = cardState(v)
    const resolvedAt = state === 'open' || state === 'stale' ? null : v.card?.resolvedAt ?? now

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

    if (!needsNewCard(v, now, await deps.maxAgeDays())) {
      // A held call is remembered (resolved, no message) so the sweep's candidate list is not clogged by it; releasing the hold syncs again.
      if (v.held && v.status === 'IN_REVIEW' && !v.card?.messageId) await deps.saveState(id, { resolvedAt: v.card?.resolvedAt ?? now })
      return 'no_card_needed'
    }
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
    if (!posted.id) {
      // Discord may have the card: never repost automatically.
      console.error(`[calls/review-cards] post for ${id} returned no message id; automatic reposting is blocked until the card row's error is cleared`)
      await deps.saveState(id, { resolvedAt: null, error: `${POSTED_UNSTORED}: no message id` }).catch(() => {})
      return 'failed'
    }
    const hash = renderHash(msg)
    try {
      await deps.store(id, { channelId, messageId: posted.id, renderedHash: hash })
    } catch {
      try {
        await deps.store(id, { channelId, messageId: posted.id, renderedHash: hash })
      } catch (err) {
        console.error(`[calls/review-cards] card for ${id} was posted (message ${posted.id}) but could not be stored; reposting is blocked:`, errText(err))
        await deps.saveState(id, { resolvedAt: null, error: `${POSTED_UNSTORED}: ${posted.id}` }).catch(() => {})
        return 'failed'
      }
    }
    // Changed (published, edited, held) while the card was being posted: show the current state.
    const fresh = await deps.load(id)
    if (fresh) {
      const m2 = renderCallReviewCard(fresh, { appUrl })
      const h2 = renderHash(m2)
      if (h2 !== hash) {
        await deps.edit({ channelId, messageId: posted.id }, m2)
        const st = cardState(fresh)
        await deps.saveState(id, { renderedHash: h2, resolvedAt: st === 'open' || st === 'stale' ? null : now, error: null })
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
  /** `cursor` rotates through open cards so more than `limit` of them all get checked over successive runs. */
  listExisting: (resolvedSince: Date, limit: number, cursor: number) => Promise<string[]>
}

export const SWEEP_EXISTING_LIMIT = 50
const SWEEP_EVERY_MS = 10 * 60 * 1000

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
    const existing = await deps.listExisting(new Date(now.getTime() - RESOLVED_RECHECK_MS), SWEEP_EXISTING_LIMIT, Math.floor(now.getTime() / SWEEP_EVERY_MS))
    // One privacy lookup per channel per run, however many cards are checked.
    const privacy = new Map<string, Promise<boolean>>()
    const run: SweepDeps = { ...deps, channelIsPrivate: (c) => privacy.get(c) ?? (privacy.set(c, deps.channelIsPrivate(c)), privacy.get(c)!) }
    let posted = 0
    let edited = 0
    for (const id of fresh) {
      if (posted >= limit) break
      if ((await syncCallReviewCard(id, run)) === 'posted') posted++
    }
    for (const id of existing) if ((await syncCallReviewCard(id, run)) === 'edited') edited++
    return { posted, edited, checked: fresh.length + existing.length }
  } catch (err) {
    console.error('[calls/review-cards] sweep failed:', errText(err))
    return { skipped: 'error' }
  }
}

// --------------------------------------------------------------- defaults ---

const botToken = () => process.env.DISCORD_BOT_TOKEN?.trim() ?? ''

type Overwrite = { id: string; type: number; allow: string; deny: string }

/**
 * Pure. A channel is private enough for unreviewed summaries when:
 *   - it belongs to our guild,
 *   - an overwrite on @everyone (the role whose id is the guild id) denies VIEW_CHANNEL without allowing it,
 *   - no other role or member overwrite allows VIEW_CHANNEL, except the allow-list (the capo and DPR
 *     roles, the bot's own user), so a role re-grant (e.g. Verified) is refused.
 * Anything unreadable fails closed.
 */
export function channelIsPrivateFor(
  channel: { guildId: string | null; permissionOverwrites?: Overwrite[] } | null | undefined,
  opts: { guildId: string; allowedIds: readonly string[] },
): boolean {
  if (!opts.guildId || !channel?.guildId || channel.guildId !== opts.guildId || !Array.isArray(channel.permissionOverwrites)) return false
  try {
    const everyone = channel.permissionOverwrites.find((o) => o.id === channel.guildId && Number(o.type) === 0)
    if (!everyone) return false
    if ((BigInt(everyone.deny) & VIEW_CHANNEL_BIT) === BigInt(0) || (BigInt(everyone.allow) & VIEW_CHANNEL_BIT) !== BigInt(0)) return false
    const allowed = new Set(opts.allowedIds)
    for (const o of channel.permissionOverwrites) {
      if (o === everyone) continue
      if ((BigInt(o.allow) & VIEW_CHANNEL_BIT) !== BigInt(0) && !allowed.has(o.id)) return false
    }
    return true
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
    interactive: await toggleEnabled('calls.capoReviewEnabled').catch(() => false),
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
    // Who may see it besides: the capo and DPR roles and the bot itself (its application id is its user id).
    const allowedIds = [...CALL_CAPO_ROLE_IDS, DREAD_PIZZA_ROBERTS_ROLE_ID, process.env.DISCORD_CLIENT_ID?.trim() ?? '']
    return r.ok && channelIsPrivateFor(r.channel, { guildId: process.env.DISCORD_GUILD_ID?.trim() ?? '', allowedIds })
  },
  async claim(id, now) {
    const created = await prisma.callReviewCard.createMany({ data: [{ recordingId: id, claimedAt: now }], skipDuplicates: true })
    if (created.count === 1) return true
    const r = await prisma.callReviewCard.updateMany({
      where: {
        recordingId: id,
        messageId: null,
        OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }],
        // A card Discord may already hold (posted, not stored) is never re-posted automatically.
        AND: [{ OR: [{ error: null }, { NOT: { error: { startsWith: POSTED_UNSTORED } } }] }],
      },
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
      update: { ...card, error: null, resolvedAt: null },
    })
  },
  async saveState(id, s) {
    await prisma.callReviewCard.upsert({
      where: { recordingId: id },
      create: { recordingId: id, ...(s.renderedHash ? { renderedHash: s.renderedHash } : {}), resolvedAt: s.resolvedAt, ...(s.error !== undefined ? { error: s.error } : {}) },
      update: { ...(s.renderedHash ? { renderedHash: s.renderedHash } : {}), resolvedAt: s.resolvedAt, ...(s.error !== undefined ? { error: s.error } : {}) },
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
        // No card yet, or a card row with no message that is not a remembered hold (resolvedAt set).
        OR: [{ reviewCard: null }, { reviewCard: { messageId: null, resolvedAt: null } }],
      },
      orderBy: { startedAt: 'asc' },
      take: limit,
      select: { id: true },
    })
    return rows.map((r) => r.id)
  },
  async listExisting(resolvedSince, limit, cursor) {
    // Open cards first, rotating through them so more than `limit` all get checked over successive runs.
    const open = (
      await prisma.callReviewCard.findMany({ where: { messageId: { not: null }, resolvedAt: null, recording: { source: 'DISCORD' } }, orderBy: { recordingId: 'asc' }, take: 500, select: { recordingId: true } })
    ).map((r) => r.recordingId)
    const start = open.length ? (cursor * limit) % open.length : 0
    const ids = [...open.slice(start), ...open.slice(0, start)].slice(0, limit)
    if (ids.length < limit) {
      const recent = await prisma.callReviewCard.findMany({
        where: { messageId: { not: null }, resolvedAt: { gte: resolvedSince }, recording: { source: 'DISCORD' } },
        orderBy: { updatedAt: 'desc' },
        take: limit - ids.length,
        select: { recordingId: true },
      })
      ids.push(...recent.map((r) => r.recordingId))
    }
    return ids
  },
}
