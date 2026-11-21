/**
 * Task proposal cards: each proposed crew task update (CrewTaskProposal) gets ONE bot card in the private
 * capo review channel (discord.callReviewChannelId, the same channel as the call review cards), built the
 * same way as those (app/lib/calls/review-cards.ts):
 *   - the bot refuses to post unless the channel denies View Channel to @everyone (channelIsPrivateFor),
 *     and an existing card collapses when its channel is no longer the configured, private one,
 *   - the transcript quote is never shown (on the website only transcript viewers see it); the card links
 *     to the crew's review page instead,
 *   - a proposal of a crew excluded by the private post filter, or from a call held for the owner (capos
 *     cannot see it), or with an unreadable filter, shows no details and is never posted,
 *   - a proposal that could not be applied (task proposals off, or the call's crew not in their allowlist)
 *     gets no new card,
 *   - nothing here pings anyone (allowed_mentions parse: []).
 *
 * `syncTaskProposalCard(id)` is the one entry point: it renders the proposal's current state and posts the
 * card (claimed through CrewTaskProposalCard.claimedAt, so concurrent syncs post one) or edits it in place,
 * only when the render changed (renderedHash). Decided proposals (applied, dismissed, stale, undone) lose
 * their buttons and say who decided. Buttons: discord-interactions/task-proposal-review.ts.
 *
 * Gated by calls.taskProposalCardsEnabled (default off) plus a bot token. Only proposals made after the
 * switch was last turned on are posted by the sweep. With calls.taskProposalsAutoApply on, a call's action
 * items get no new card until its auto-apply pass ran (auto-apply.ts): only the ones still pending after it
 * (the task changed since the call, a failed write, a held call once released) get a card. Everything is best effort and never throws into its
 * caller. Tests inject ProposalCardDeps, so nothing reaches Discord or the database.
 */
import { after } from 'next/server'
import { prisma } from '@/app/lib/db'
import { savedChannelId } from '@/app/lib/settings/channels'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { switchedOnAt } from '@/app/lib/settings/switched-on'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { NON_ROSTER_CREW_IDS, normalizeCrewId } from '@/app/lib/crew-id'
import { fetchChannel } from '@/app/lib/discord-channels'
import { DiscordPostError, editDiscordMessage, postDiscordMessage } from '@/app/lib/discord-rest'
import { makeEmbed, type Tone } from '@/app/lib/discord-interactions/embeds'
import { isCrewExcluded, loadPostFilter, type PostFilter } from '@/app/lib/calls/post-filters'
import { autoHoldReason, heldReason } from '@/app/lib/calls/hold-rules'
import { neutralizeMentions } from '@/app/lib/calls/recap'
import { callDateTimeFormat } from '@/app/lib/calls/format-call-time'
import { channelIsPrivateFor, renderHash, STALE_CLAIM_MS, POSTED_UNSTORED, RESOLVED_RECHECK_MS, SWEEP_FULL_RECHECK_MS, type CardMessage } from '@/app/lib/calls/review-cards'
import { CALL_CAPO_ROLE_IDS, DREAD_PIZZA_ROBERTS_ROLE_ID } from '@/app/ui/constants'
import { proposalApplyId, proposalDismissId } from '@/app/lib/discord-interactions/task-proposal-review'
import { SITE_URL } from '@/app/lib/site-url'
import { createHash } from 'node:crypto'
import { crewInAllowlist, loadTaskProposalConfig, type TaskProposalConfig } from './config'
import { effectiveValues, needsLeadPick, type ProposalEdits } from './apply'
import type { ProposalChanges } from './proposals'

export const TOGGLE_KEY = 'calls.taskProposalCardsEnabled'
export const AUTO_APPLY_KEY = 'calls.taskProposalsAutoApply'
/** Who an action item applied straight from the call was decided by (CrewTaskProposal.decidedBy, the task history actor). */
export const AUTO_APPLY_ACTOR = 'system:call-action-items'
/** Auto-apply on by env only (no switch-on time): action items younger than this wait for the pass before getting a card. */
export const AUTO_APPLY_GRACE_MS = 15 * 60 * 1000

export const isAutoApplied = (decidedBy: string | null | undefined) => decidedBy === AUTO_APPLY_ACTOR

export function proposalCardsEnabled(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  return toggleEnabled(TOGGLE_KEY, env)
}

// ------------------------------------------------------------------- view ---

export type ProposalCardState = 'open' | 'needs-website' | 'changed' | 'hidden' | 'applied' | 'dismissed' | 'stale' | 'undone'

export interface ProposalCardView {
  id: string
  recordingId: string
  crewId: string
  crewLabel: string | null
  callTitle: string | null
  callStartedAt: Date | null
  kind: string
  status: string
  /** The task's label now (a new task: the proposed label). */
  taskLabel: string
  /** The proposed changes (lead apart), as shown: the approver's saved edits on top of the proposal. */
  changes: Array<{ field: string; from: string | null; to: string | null }>
  /** The proposed lead change, or null when the lead is not part of it. */
  lead: { from: string | null; to: string | null } | null
  /** Ambiguous lead: the names to pick from (on the website). */
  leadCandidates: string[]
  reason: string
  /** Something has to be picked or typed on the website before it can be applied. */
  needsInput: 'lead' | 'label' | null
  /** The task changed (or is gone) since this was proposed: the stale check the website does. */
  taskChanged: boolean
  taskGone: boolean
  /** Excluded crew, a call held for the owner, unreadable filter, or a channel that is no longer the configured private one: no details. */
  hidden: boolean
  /** Why it is hidden: a rule (filter, hold, channel) or a read that failed (retried next run, never remembered). */
  hiddenBy: 'rule' | 'error' | null
  /** Task proposals are on and the call's crew is in their allowlist (applyProposal refuses otherwise): only then a new card. */
  applicable: boolean
  /** Discord buttons are live (calls.capoReviewEnabled): without it the card only links to the website. */
  interactive: boolean
  decidedBy: string | null
  decidedAt: Date | null
  error: string | null
  createdAt: Date
  /** Auto-apply is on and has not run for this call yet: no new card (it may be applied in a moment). */
  awaitingAutoApply?: boolean
  card: {
    channelId: string | null
    messageId: string | null
    renderedHash: string | null
    resolvedAt: Date | null
    claimedAt: Date | null
  } | null
}

export function proposalCardState(v: Pick<ProposalCardView, 'status' | 'hidden' | 'needsInput' | 'taskChanged' | 'taskGone'>): ProposalCardState {
  // Hidden wins: a decided card of a held call or a crew excluded later shows no details either.
  if (v.hidden) return 'hidden'
  if (v.status === 'APPLIED') return 'applied'
  if (v.status === 'DISMISSED') return 'dismissed'
  if (v.status === 'UNDONE') return 'undone'
  if (v.status !== 'PENDING') return 'stale'
  if (v.taskChanged || v.taskGone) return 'changed'
  return v.needsInput ? 'needs-website' : 'open'
}

/** Still waiting for a decision (no resolved time). */
const isLive = (s: ProposalCardState) => s === 'open' || s === 'needs-website' || s === 'changed'

const KIND_LABEL: Record<string, string> = { CREATE: 'New task', UPDATE: 'Task update', DONE: 'Mark done', RETIRE: 'Retire task' }
const FIELD_LABEL: Record<string, string> = { label: 'Name', stage: 'Stage', priority: 'Priority', due: 'Due' }

const ts = (d: Date, style = 'f') => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s)
const escapeMd = (s: string) => s.replace(/([*_`~|>\\[\]])/g, '\\$1').replace(/@/g, '@\u200b')
export const clean = (s: string, max: number) => clip(escapeMd(neutralizeMentions(s).replace(/\s+/g, ' ').trim()), max)
const shown = (s: string | null) => (s?.trim() ? clean(s, 120) : '—')

/** Where a proposal is reviewed on the website: the crew page, or the admin call page for one left on a non-crew call. */
export function proposalReviewUrl(v: Pick<ProposalCardView, 'crewId' | 'recordingId'>, appUrl: string): string {
  return NON_ROSTER_CREW_IDS.has(normalizeCrewId(v.crewId))
    ? `${appUrl}/admin/calls/${encodeURIComponent(v.recordingId)}#call-updates`
    : `${appUrl}/crew/${encodeURIComponent(v.crewId)}#call-updates`
}

/**
 * The card: an embed plus a button row. Pure. Never includes the transcript quote. An open card has
 * Apply / Dismiss / Edit on website; one that needs input or whose task changed has Dismiss and the website
 * link; a decided or hidden one only the link.
 */
export function renderProposalCard(v: ProposalCardView, opts: { appUrl: string }): CardMessage {
  const state = proposalCardState(v)
  const crew = v.crewLabel?.trim() ? clean(v.crewLabel, 80) : clean(v.crewId, 80)
  const link = proposalReviewUrl(v, opts.appUrl)
  const kind = KIND_LABEL[v.kind] ?? 'Task update'
  let tone: Tone = 'cooldown'
  const body: string[] = []

  if (state === 'hidden') {
    const embed = makeEmbed('cooldown', `${kind}: review on the website`, 'This action item is reviewed on the website only.', { footer: { text: `Action item · ${v.id}` } })
    return { content: '', embeds: [embed], components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Open on website', url: link }] }], allowed_mentions: { parse: [] } }
  }

  const headline = `${kind}: ${crew}`
  if (v.taskLabel.trim()) body.push(`**${clean(v.taskLabel, 200)}**`)
  const call = [v.callTitle?.trim() ? clean(v.callTitle, 120) : null, v.callStartedAt ? callDateTimeFormat('en-US').format(v.callStartedAt) : null].filter(Boolean).join(' · ')
  if (call) body.push(`From the call: ${call}`)
  body.push('')
  for (const c of v.changes) body.push(`${FIELD_LABEL[c.field] ?? c.field}: ${shown(c.from)} → ${shown(c.to)}`)
  if (v.leadCandidates.length && state !== 'applied') body.push(`Lead: unclear: ${v.leadCandidates.map((n) => clean(n, 60)).join(' / ')}`)
  else if (v.lead) body.push(`Lead: ${v.lead.from?.trim() ? `${shown(v.lead.from)} → ` : ''}${shown(v.lead.to)}`)
  if (v.reason.trim()) body.push(`Why: ${clean(v.reason, 400)}`)

  const who = isAutoApplied(v.decidedBy) ? 'Metalhead (added from the call)' : v.decidedBy ? `<@${v.decidedBy}>` : 'a crew lead'
  const when = v.decidedAt ? ` · ${ts(v.decidedAt)}` : ''
  if (state === 'needs-website') {
    body.push('', v.needsInput === 'lead' ? 'Choose who leads it on the website before applying.' : 'Give it a name on the website before applying.')
  } else if (state === 'changed') {
    body.push('', v.taskGone ? 'Stale: the task no longer exists.' : 'Stale: the task changed since this was proposed. Check it on the website.')
  } else if (state === 'applied') {
    tone = 'success'
    body.push('', `Applied by ${who}${when}`)
  } else if (state === 'dismissed') {
    tone = 'error'
    body.push('', `Dismissed by ${who}${when}`)
  } else if (state === 'undone') {
    tone = 'error'
    body.push('', `Applied, then undone by ${who}${when}`)
  } else if (state === 'stale') {
    tone = 'error'
    body.push('', `Stale: ${v.error?.trim() ? clean(v.error, 200) : 'too old to apply'}`)
  }

  const embed = makeEmbed(tone, headline, body.join('\n').trim())
  embed.footer = { text: `Action item · ${v.id}` }
  const buttons: unknown[] = []
  if (state === 'open' && v.interactive) buttons.push({ type: 2, style: 3, label: 'Apply', custom_id: proposalApplyId(v.id) })
  if ((state === 'open' || state === 'needs-website' || state === 'changed') && v.interactive) buttons.push({ type: 2, style: 2, label: 'Dismiss', custom_id: proposalDismissId(v.id) })
  const linkLabel = state === 'open' ? 'Edit on website' : state === 'needs-website' ? 'Choose on website' : state === 'changed' ? 'Review on website' : 'Open on website'
  buttons.push({ type: 2, style: 5, label: linkLabel, url: link })
  return { content: '', embeds: [embed], components: [{ type: 1, components: buttons }], allowed_mentions: { parse: [] } }
}

// ------------------------------------------------------------------- sync ---

export interface ProposalCardDeps {
  /** calls.taskProposalCardsEnabled and a bot token. */
  enabled: () => boolean | Promise<boolean>
  load: (id: string) => Promise<ProposalCardView | null>
  /** Proposals older than this (calls.taskProposalMaxDays) never get a new card. */
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

export type ProposalCardOutcome = 'disabled' | 'missing' | 'edited' | 'unchanged' | 'posted' | 'no_card_needed' | 'claimed_elsewhere' | 'no_channel' | 'channel_not_private' | 'failed'

const isGone = (err: unknown) => err instanceof DiscordPostError && err.status === 404
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim().slice(0, 300)

/** Does this proposal warrant a NEW card? Pending, not hidden, applicable, recent enough. (The sweep also applies the switch-on cutoff.) */
export function needsNewProposalCard(v: ProposalCardView, now: Date, maxAgeDays: number): boolean {
  return v.status === 'PENDING' && !v.hidden && v.applicable && !v.awaitingAutoApply && v.createdAt.getTime() >= now.getTime() - maxAgeDays * 86_400_000
}

/** Remembered rows with no message (hidden by a rule, or not applicable) are re-checked by the sweep after this (a released hold, a crew switched back on). */
export const SKIPPED_RECHECK_MS = 3_600_000

async function openAllowed(deps: ProposalCardDeps, channelId: string): Promise<boolean> {
  const current = await deps.channelId()
  return !!current && current === channelId && (await deps.channelIsPrivate(channelId))
}

/**
 * Bring the proposal's card up to date (see the module comment). `editOnly` never posts a new card (the
 * website and the buttons refresh with it; only the sweep posts). Never throws.
 */
export async function syncTaskProposalCard(id: string, deps: ProposalCardDeps = defaultProposalCardDeps, opts: { editOnly?: boolean } = {}): Promise<ProposalCardOutcome> {
  try {
    if (!(await deps.enabled())) return 'disabled'
    const v = await deps.load(id)
    if (!v) return 'missing'
    // An existing card shows the proposal only while its channel is still the configured, private one.
    if (v.card?.messageId && v.card.channelId && proposalCardState(v) !== 'hidden' && !(await openAllowed(deps, v.card.channelId))) {
      v.hidden = true
      v.hiddenBy = 'rule'
    }
    const appUrl = deps.appUrl()
    const now = deps.now?.() ?? new Date()
    const state = proposalCardState(v)
    const resolvedAt = isLive(state) ? null : v.card?.resolvedAt ?? now

    if (v.card?.messageId && v.card.channelId) {
      const msg = renderProposalCard(v, { appUrl })
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
        // The message was deleted: forget it, and post a fresh one only while the proposal is still live.
        await deps.clearMessage(id)
        if (!isLive(state) || opts.editOnly) return 'no_card_needed'
        v.card = { ...v.card, messageId: null, channelId: null, renderedHash: null, claimedAt: null }
      }
    }

    if (opts.editOnly || !needsNewProposalCard(v, now, await deps.maxAgeDays())) {
      // A proposal hidden by a rule, or not applicable, is remembered (resolved, no message) so the sweep's candidate list is
      // not clogged by it; the sweep re-checks it after SKIPPED_RECHECK_MS. A failed read is not remembered: it is retried next run.
      const skipped = v.hidden ? v.hiddenBy !== 'error' : !v.applicable
      if (!opts.editOnly && skipped && v.status === 'PENDING' && !v.card?.messageId) await deps.saveState(id, { resolvedAt: now })
      return 'no_card_needed'
    }
    const channelId = await deps.channelId()
    if (!channelId) return 'no_channel'
    if (!(await deps.claim(id, now))) return 'claimed_elsewhere'
    if (!(await deps.channelIsPrivate(channelId))) {
      await deps.unclaim(id)
      await deps.saveState(id, { resolvedAt: null, error: 'channel not private' })
      console.warn('[call-tasks/cards] the review channel is not private (it must deny View Channel to @everyone); no card posted')
      return 'channel_not_private'
    }
    const msg = renderProposalCard(v, { appUrl })
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
      console.error(`[call-tasks/cards] post for ${id} returned no message id; automatic reposting is blocked until the card row's error is cleared`)
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
        console.error(`[call-tasks/cards] card for ${id} was posted (message ${posted.id}) but could not be stored; reposting is blocked:`, errText(err))
        await deps.saveState(id, { resolvedAt: null, error: `${POSTED_UNSTORED}: ${posted.id}` }).catch(() => {})
        return 'failed'
      }
    }
    // Decided (or changed) while the card was being posted: show the current state.
    const fresh = await deps.load(id)
    if (fresh) {
      const m2 = renderProposalCard(fresh, { appUrl })
      const h2 = renderHash(m2)
      if (h2 !== hash) {
        await deps.edit({ channelId, messageId: posted.id }, m2)
        await deps.saveState(id, { renderedHash: h2, resolvedAt: isLive(proposalCardState(fresh)) ? null : now, error: null })
      }
    }
    return 'posted'
  } catch (err) {
    console.error(`[call-tasks/cards] card sync for ${id} failed:`, errText(err))
    return 'failed'
  }
}

/**
 * Refresh an existing card after a decision (website or Discord): after the response (next/server
 * `after()`), or right away outside a request scope. Never posts a new card and never throws. Cheap when
 * the feature is off: the toggle is the first thing checked.
 */
export function queueTaskProposalCardSync(ids: string | string[]): void {
  const list = [...new Set(Array.isArray(ids) ? ids : [ids])]
  if (!list.length) return
  const run = async () => {
    for (const id of list) {
      await syncTaskProposalCard(id, defaultProposalCardDeps, { editOnly: true }).catch((err) => console.error('[call-tasks/cards] queued sync failed:', errText(err)))
    }
  }
  try {
    after(run)
  } catch {
    void run()
  }
}

// ------------------------------------------------------------------ sweep ---

export interface ProposalSweepDeps extends ProposalCardDeps {
  /** When the switch was last turned on: only proposals made since get a new card. Null: none are posted. */
  since: () => Promise<Date | null>
  /** Ids of pending proposals that need a NEW card (made since `since`, no posted card). */
  listNew: (since: Date, limit: number) => Promise<string[]>
  /** Ids of proposals with a posted card that is live or was resolved recently; `cursor` rotates through live ones. */
  listExisting: (resolvedSince: Date, limit: number, cursor: number) => Promise<string[]>
  /** Cheap change markers (proposal, its task and its card) per id. When absent every candidate is re-checked every run. */
  markers?: (ids: string[]) => Promise<Map<string, string>>
  /** A key for the settings that feed the render (the private post filter). */
  filterKey?: () => Promise<string>
  /** The capo-review toggle (changes the card's buttons), part of the memo key. */
  interactive?: () => Promise<boolean>
  memo?: Map<string, { key: string; at: number }>
}

const sweepMemo = new Map<string, { key: string; at: number }>()
export const PROPOSAL_SWEEP_EXISTING_LIMIT = 50
const SWEEP_EVERY_MS = 10 * 60 * 1000

/**
 * The reconcile sweep (followups cron, every 10 min, next to the call review cards): posts cards for
 * proposals made since the switch was turned on (at most `limit` per run) and re-renders live or recently
 * resolved cards. Cards whose cheap marker (and the channel, its privacy, the filter and the toggle) did not
 * change since their last check are skipped; Discord is only called when the render changed.
 */
export async function syncDueTaskProposalCards(limit = 10, deps: ProposalSweepDeps = defaultProposalSweepDeps): Promise<{ posted: number; edited: number; checked: number } | { skipped: string }> {
  try {
    if (!(await deps.enabled())) return { skipped: 'disabled' }
    const channel = await deps.channelId()
    if (!channel) return { skipped: 'no channel' }
    const now = deps.now?.() ?? new Date()
    const maxAge = await deps.maxAgeDays()
    const since = await deps.since()
    const floor = now.getTime() - maxAge * 86_400_000
    const fresh = since ? await deps.listNew(new Date(Math.max(since.getTime(), floor)), limit * 3) : []
    const existing = await deps.listExisting(new Date(now.getTime() - RESOLVED_RECHECK_MS), PROPOSAL_SWEEP_EXISTING_LIMIT, Math.floor(now.getTime() / SWEEP_EVERY_MS))
    // One privacy lookup per channel per run, however many cards are checked.
    const privacy = new Map<string, Promise<boolean>>()
    const run: ProposalSweepDeps = { ...deps, channelIsPrivate: (c) => privacy.get(c) ?? (privacy.set(c, deps.channelIsPrivate(c)), privacy.get(c)!) }
    let posted = 0
    let edited = 0
    for (const id of fresh) {
      if (posted >= limit) break
      if ((await syncTaskProposalCard(id, run)) === 'posted') posted++
    }
    const memo = deps.memo ?? sweepMemo
    const keys = new Map<string, string>()
    if (deps.markers && existing.length) {
      const [markers, fk] = await Promise.all([deps.markers(existing), deps.filterKey ? deps.filterKey() : Promise.resolve('')])
      // Channel, its privacy this run and the interactive toggle also change what a card must be, so a flip re-checks all.
      const priv = await run.channelIsPrivate(channel)
      const inter = deps.interactive ? await deps.interactive() : false
      for (const [id, m] of markers) keys.set(id, `${m}|${fk}|${channel}|${priv}|${inter}`)
    }
    for (const id of existing) {
      const key = keys.get(id)
      const prev = memo.get(id)
      if (key !== undefined && prev && prev.key === key && now.getTime() - prev.at < SWEEP_FULL_RECHECK_MS) continue
      const outcome = await syncTaskProposalCard(id, run)
      if (outcome === 'edited') edited++
      if (key !== undefined && (outcome === 'unchanged' || outcome === 'edited' || outcome === 'no_card_needed')) memo.set(id, { key, at: now.getTime() })
      else memo.delete(id)
    }
    if (memo.size > 2000) memo.clear()
    return { posted, edited, checked: fresh.length + existing.length }
  } catch (err) {
    console.error('[call-tasks/cards] sweep failed:', errText(err))
    return { skipped: 'error' }
  }
}

// --------------------------------------------------------------- defaults ---

const botToken = () => process.env.DISCORD_BOT_TOKEN?.trim() ?? ''

const asEdits = (v: unknown): ProposalEdits => (v && typeof v === 'object' && !Array.isArray(v) ? (v as ProposalEdits) : {})

/**
 * The race guard: with auto-apply on, a call's action items wait for its pass (CallTaskAutoApply.appliedAt) before
 * any of them gets a card. Only those made after auto-apply was switched on wait (by env only: the young ones).
 * Fails closed (no card yet, retried next run).
 */
export async function awaitingAutoApply(cfg: Pick<TaskProposalConfig, 'autoApply'>, recordingId: string, createdAt: Date, now: Date = new Date()): Promise<boolean> {
  if (!cfg.autoApply) return false
  try {
    const row = await prisma.callTaskAutoApply.findUnique({ where: { recordingId }, select: { appliedAt: true } })
    if (row?.appliedAt) return false
    const since = await switchedOnAt(AUTO_APPLY_KEY)
    return since ? createdAt.getTime() >= since.getTime() : now.getTime() - createdAt.getTime() < AUTO_APPLY_GRACE_MS
  } catch {
    return true
  }
}

/** Whether a call is held, per call version and filter: the transcript is read once, not once per proposal. */
const holdMemo = new Map<string, { key: string; held: boolean }>()

async function callHeld(rec: { id: string; updatedAt: Date; crewId: string | null; reviewHoldAt: Date | null }, filter: PostFilter, lean: boolean): Promise<boolean> {
  const key = `${rec.updatedAt.getTime()}|${createHash('sha1').update(JSON.stringify(filter)).digest('hex')}`
  const hit = holdMemo.get(rec.id)
  if (hit?.key === key) return hit.held
  // Lean (a button click, 3 s budget): no transcript read; the manual hold and the owner-only crews only.
  // The card was only posted after a full check, and the sweep re-renders it after every change of the call.
  if (lean) return !!rec.reviewHoldAt || autoHoldReason({ crewId: rec.crewId }, filter) === 'crew'
  const full = await prisma.callRecording.findUnique({
    where: { id: rec.id },
    select: { source: true, status: true, crewId: true, crewLabel: true, eventName: true, title: true, summary: true, actionItems: true, chapters: true, transcript: true, redactedSpeakerIds: true, redactedSegmentIds: true, reviewHoldAt: true },
  })
  const held = !full || heldReason(full, filter) !== null
  if (holdMemo.size > 500) holdMemo.clear()
  holdMemo.set(rec.id, { key, held })
  return held
}

/**
 * The card view. `lean` (the button handler, inside Discord's 3 s window) never reads the transcript for
 * the hold check (a cached result, else the cheap rules only).
 */
export async function loadProposalCardView(id: string, opts: { lean?: boolean } = {}): Promise<ProposalCardView | null> {
  const row = await prisma.crewTaskProposal.findUnique({
    where: { id },
    // Never the quote or its time: the card does not show them.
    select: {
      id: true, recordingId: true, crewId: true, kind: true, taskId: true, baseUpdatedAt: true, changes: true, edited: true,
      leadName: true, leadMemberId: true, candidates: true, reason: true, status: true, decidedBy: true, decidedAt: true, error: true, createdAt: true,
      card: { select: { channelId: true, messageId: true, renderedHash: true, resolvedAt: true, claimedAt: true } },
    },
  })
  if (!row) return null
  let recFailed = false
  const [rec, task, filter, crews, interactive, cfg] = await Promise.all([
    prisma.callRecording
      .findUnique({ where: { id: row.recordingId }, select: { id: true, updatedAt: true, crewId: true, crewLabel: true, title: true, eventName: true, startedAt: true, reviewHoldAt: true } })
      .catch(() => ((recFailed = true), null)),
    row.taskId ? prisma.crewTask.findUnique({ where: { id: row.taskId }, select: { label: true, updatedAt: true, archived: true } }) : Promise.resolve(null),
    // A filter that can't be read hides the proposal (fail closed).
    loadPostFilter().catch(() => null),
    // Never waits on a full registry reload: a stale list is fine for a label.
    getCrewMappings(false, { staleWhileRevalidate: true }).then((m) => m.crews, () => []),
    toggleEnabled('calls.capoReviewEnabled').catch(() => false),
    loadTaskProposalConfig(),
  ])
  const changes = (row.changes ?? {}) as ProposalChanges
  const edited = asEdits(row.edited)
  const eff = effectiveValues(changes, {}, edited)
  const candidates = (Array.isArray(row.candidates) ? (row.candidates as Array<{ name?: unknown }>) : []).map((c) => (typeof c?.name === 'string' ? c.name : '')).filter(Boolean)
  const pick = needsLeadPick({ candidates: row.candidates, leadMemberId: row.leadMemberId }, eff, edited)
  const str = (x: unknown) => (typeof x === 'string' ? x : null)
  const shownChanges: ProposalCardView['changes'] = []
  for (const f of ['label', 'stage', 'priority', 'due'] as const) {
    if (f === 'label' && row.kind === 'CREATE') continue
    const c = changes[f]
    if (!c && eff[f] === undefined) continue
    const to = eff[f] !== undefined ? eff[f] ?? null : str(c?.to)
    shownChanges.push({ field: f, from: row.kind === 'CREATE' ? null : str(c?.from), to })
  }
  const leadInvolved = !edited.skipLead && (!!changes.leadName || !!changes.leadMemberId || eff.leadName !== undefined)
  const callCrew = rec?.crewId ?? row.crewId
  const crewLabel = crews.find((c) => c.id === row.crewId)?.label ?? (row.crewId === rec?.crewId ? rec?.crewLabel ?? null : null)
  // Fail closed: an unreadable filter or call, an excluded crew, or a call (or crew) held for the owner.
  let hiddenBy: ProposalCardView['hiddenBy'] = null
  if (!filter || recFailed) hiddenBy = 'error'
  else if (!rec) hiddenBy = 'rule' // the call is gone
  else if (isCrewExcluded({ id: callCrew, label: rec.crewLabel }, filter) || (row.crewId !== callCrew && isCrewExcluded({ id: row.crewId }, filter)) || autoHoldReason({ crewId: row.crewId }, filter) === 'crew') hiddenBy = 'rule'
  else {
    const held = await callHeld(rec, filter, !!opts.lean).catch(() => null)
    hiddenBy = held === null ? 'error' : held ? 'rule' : null
  }
  const taskGone = row.kind !== 'CREATE' && (!task || task.archived)
  const awaiting = row.status === 'PENDING' && !row.card?.messageId ? await awaitingAutoApply(cfg, row.recordingId, row.createdAt) : false
  return {
    id: row.id,
    recordingId: row.recordingId,
    crewId: row.crewId,
    crewLabel,
    callTitle: rec ? rec.title || rec.eventName || null : null,
    callStartedAt: rec?.startedAt ?? null,
    kind: row.kind,
    status: row.status,
    taskLabel: task?.label ?? (eff.label ?? str(changes.label?.to) ?? ''),
    changes: shownChanges,
    lead: leadInvolved ? { from: str(changes.leadName?.from), to: eff.leadName ?? str(changes.leadName?.to) ?? row.leadName } : null,
    leadCandidates: pick ? candidates : [],
    reason: row.reason,
    needsInput: pick ? 'lead' : row.kind === 'CREATE' && !eff.label ? 'label' : null,
    taskChanged: row.kind !== 'CREATE' && !taskGone && !!task && (!row.baseUpdatedAt || task.updatedAt.getTime() !== row.baseUpdatedAt.getTime()),
    taskGone,
    hidden: hiddenBy !== null,
    hiddenBy,
    // The same switch and allowlist applyProposal checks (the allowlist is about the call's crew).
    applicable: cfg.enabled && crewInAllowlist(cfg, callCrew),
    interactive,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    error: row.error,
    createdAt: row.createdAt,
    awaitingAutoApply: awaiting,
    card: row.card,
  }
}

export const defaultProposalCardDeps: ProposalCardDeps = {
  enabled: async () => (await proposalCardsEnabled()) && !!botToken(),
  load: loadProposalCardView,
  maxAgeDays: async () => (await loadTaskProposalConfig()).maxDays,
  channelId: () => savedChannelId('discord.callReviewChannelId'),
  async channelIsPrivate(channelId) {
    const r = await fetchChannel(channelId, { botToken: botToken() })
    const allowedIds = [...CALL_CAPO_ROLE_IDS, DREAD_PIZZA_ROBERTS_ROLE_ID, process.env.DISCORD_CLIENT_ID?.trim() ?? '']
    return r.ok && channelIsPrivateFor(r.channel, { guildId: process.env.DISCORD_GUILD_ID?.trim() ?? '', allowedIds })
  },
  async claim(id, now) {
    const created = await prisma.crewTaskProposalCard.createMany({ data: [{ proposalId: id, claimedAt: now }], skipDuplicates: true })
    if (created.count === 1) return true
    const r = await prisma.crewTaskProposalCard.updateMany({
      where: {
        proposalId: id,
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
    await prisma.crewTaskProposalCard.updateMany({ where: { proposalId: id, messageId: null }, data: { claimedAt: null } })
  },
  async store(id, card) {
    await prisma.crewTaskProposalCard.upsert({
      where: { proposalId: id },
      create: { proposalId: id, ...card, claimedAt: new Date() },
      update: { ...card, error: null, resolvedAt: null },
    })
  },
  async saveState(id, s) {
    const data = { ...(s.renderedHash ? { renderedHash: s.renderedHash } : {}), resolvedAt: s.resolvedAt, ...(s.error !== undefined ? { error: s.error } : {}) }
    await prisma.crewTaskProposalCard.upsert({ where: { proposalId: id }, create: { proposalId: id, ...data }, update: data })
  },
  async clearMessage(id) {
    await prisma.crewTaskProposalCard.updateMany({ where: { proposalId: id }, data: { channelId: null, messageId: null, renderedHash: null, claimedAt: null } })
  },
  post: (channelId, msg) => postDiscordMessage({ kind: 'bot', channelId, botToken: botToken() }, msg),
  edit: (card, msg) => editDiscordMessage({ ...card, botToken: botToken() }, msg),
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL?.trim() || SITE_URL).replace(/\/$/, ''),
}

export const defaultProposalSweepDeps: ProposalSweepDeps = {
  ...defaultProposalCardDeps,
  // When the saved switch last went from off to on, while it is saved as on. Switched on by env only: nothing new is posted.
  since: () => switchedOnAt(TOGGLE_KEY),
  async listNew(since, limit) {
    // A card Discord may already hold (posted, not stored) is never a candidate, so it cannot starve the rest.
    const notUnstored = [{ error: null }, { NOT: { error: { startsWith: POSTED_UNSTORED } } }]
    // First: no card yet, or a card row with no message that is not remembered (resolvedAt unset).
    const rows = await prisma.crewTaskProposal.findMany({
      where: { status: 'PENDING', createdAt: { gte: since }, OR: [{ card: null }, { card: { messageId: null, resolvedAt: null, OR: notUnstored } }] },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    })
    const ids = rows.map((r) => r.id)
    // Then remembered ones (hidden by a rule, not applicable) last checked over an hour ago: a hold may be released.
    if (ids.length < limit) {
      const again = await prisma.crewTaskProposal.findMany({
        where: { status: 'PENDING', createdAt: { gte: since }, card: { messageId: null, resolvedAt: { lt: new Date(Date.now() - SKIPPED_RECHECK_MS) }, OR: notUnstored } },
        orderBy: { createdAt: 'asc' },
        take: limit - ids.length,
        select: { id: true },
      })
      ids.push(...again.map((r) => r.id))
    }
    return ids
  },
  async markers(ids) {
    // Everything that feeds the render apart from settings: the proposal's own stamp, its task's and its card's message.
    const rows = await prisma.crewTaskProposal.findMany({
      where: { id: { in: ids } },
      select: { id: true, updatedAt: true, status: true, crewId: true, taskId: true, recordingId: true, card: { select: { messageId: true } } },
    })
    const taskIds = [...new Set(rows.map((r) => r.taskId).filter((x): x is string => !!x))]
    const tasks = taskIds.length ? await prisma.crewTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, updatedAt: true, archived: true } }) : []
    const byTask = new Map(tasks.map((t) => [t.id, `${t.updatedAt.getTime()}~${t.archived}`]))
    // The call's own stamp: a hold (or a held term in an edited summary) hides its proposals.
    const recIds = [...new Set(rows.map((r) => r.recordingId))]
    const recs = recIds.length ? await prisma.callRecording.findMany({ where: { id: { in: recIds } }, select: { id: true, updatedAt: true } }) : []
    const byRec = new Map(recs.map((r) => [r.id, r.updatedAt.getTime()]))
    return new Map(
      rows.map((r) => [r.id, [r.updatedAt.getTime(), r.status, r.crewId, r.taskId ? byTask.get(r.taskId) ?? 'gone' : '', byRec.get(r.recordingId) ?? 'gone', r.card?.messageId ?? ''].join('~')]),
    )
  },
  interactive: () => toggleEnabled('calls.capoReviewEnabled').catch(() => false),
  async filterKey() {
    const [filter, crews, cfg] = await Promise.all([
      loadPostFilter().catch(() => null),
      getCrewMappings(false, { staleWhileRevalidate: true }).then((m) => m.crews.map((c) => `${c.id}=${c.label}`), () => []),
      loadTaskProposalConfig(),
    ])
    return createHash('sha1').update(JSON.stringify([filter, crews, cfg.enabled, cfg.crews])).digest('hex')
  },
  async listExisting(resolvedSince, limit, cursor) {
    const live = (
      await prisma.crewTaskProposalCard.findMany({ where: { messageId: { not: null }, resolvedAt: null }, orderBy: { proposalId: 'asc' }, take: 500, select: { proposalId: true } })
    ).map((r) => r.proposalId)
    const start = live.length ? (cursor * limit) % live.length : 0
    const ids = [...live.slice(start), ...live.slice(0, start)].slice(0, limit)
    if (ids.length < limit) {
      const recent = await prisma.crewTaskProposalCard.findMany({
        where: { messageId: { not: null }, resolvedAt: { gte: resolvedSince } },
        orderBy: { updatedAt: 'desc' },
        take: limit - ids.length,
        select: { proposalId: true },
      })
      ids.push(...recent.map((r) => r.proposalId))
    }
    return ids
  },
}
