/**
 * Action items straight onto the crew's tasks (calls.taskProposalsAutoApply, default off): right after a call's
 * action items are made (run.ts), each one is applied through applyProposal as Metalhead (AUTO_APPLY_ACTOR), with
 * the stage and fields from the call and the close confirmation given. No review step:
 *   - an unclear lead (several members match) is left out instead of guessed (a new task gets no lead),
 *   - updates are applied too; a close (done, or a stage change to a closed stage) only when the model was sure
 *     (confidence high) and its quote was found in the visible transcript; a retire never (it waits for review),
 *   - nothing is forced: one whose task changed since the call (conflict), or that failed, stays pending and is
 *     the only kind that gets a card in the capo review channel (cards.ts waits for this pass; see awaitingAutoApply),
 *   - the existing filters still hold (applyProposal: switch, allowlist, excluded crews, age); a call held for the
 *     owner is not touched until it is released (hold.ts queues a pass; the followups cron sweep backs it up), and a
 *     task routed to an owner-only crew stays pending,
 *   - only action items made after the switch was turned on (by env only: all of the call's pending ones).
 * After the pass, Metalhead posts ONE short summary per call in the capo review channel (the same channel and
 * privacy check as the cards; claimed through CallTaskAutoApply.summaryClaimedAt, so it is posted at most once):
 * what was added, updated and closed, and how many still need a look. No transcript quotes, no pings.
 * Leads can still edit or archive any task on the crew page, and undo an applied retire there.
 * Everything is best effort and never throws into its caller.
 */
import { after } from 'next/server'
import { createHash } from 'node:crypto'
import { prisma } from '@/app/lib/db'
import { switchedOnAt } from '@/app/lib/settings/switched-on'
import { getCrewMappings, isClosedStage } from '@/app/lib/crew-mappings'
import { NON_ROSTER_CREW_IDS, normalizeCrewId } from '@/app/lib/crew-id'
import { isCrewExcluded, loadPostFilter, type PostFilter } from '@/app/lib/calls/post-filters'
import { autoHoldReason, heldReason } from '@/app/lib/calls/hold-rules'
import { callDateTimeFormat } from '@/app/lib/calls/format-call-time'
import { DiscordPostError, postDiscordMessage } from '@/app/lib/discord-rest'
import { loadTaskProposalConfig, type TaskProposalConfig } from './config'
import { applyProposal, effectiveValues, type ApplyOutcome, type ProposalEdits } from './apply'
import { AUTO_APPLY_ACTOR, AUTO_APPLY_KEY, clean, defaultProposalCardDeps, proposalCardsEnabled, queueTaskProposalCardSync } from './cards'
import type { ProposalChanges } from './proposals'

export type AutoApplyResult = 'ok' | 'disabled' | 'not-found' | 'held' | 'failed'

export interface AutoApplyReport {
  result: AutoApplyResult
  applied: number
  /** Still pending after the pass (they get their own card). */
  left: number
  summary?: SummaryResult
}

const allow = async () => true

/**
 * Whether an action item may be applied without review. A retire never; a close (done, or a stage change to a
 * closed stage) only when the model was sure and quoted the call (stored quotes are already verified against the
 * visible transcript). Everything else may.
 */
export function autoApplicable(r: { kind: string; changes: unknown; edited: unknown; confidence: string; quote: string | null }): boolean {
  if (r.kind === 'RETIRE') return false
  const eff = effectiveValues((r.changes ?? {}) as ProposalChanges, {}, (r.edited ?? null) as ProposalEdits | null)
  const closes = r.kind === 'DONE' || (!!eff.stage && isClosedStage(eff.stage))
  return !closes || (r.confidence === 'high' && !!r.quote?.trim())
}

/** One action item: applied as proposed; an unclear lead is applied without a lead rather than skipped. */
export async function autoApplyOne(id: string, apply: typeof applyProposal = applyProposal): Promise<ApplyOutcome> {
  const opts = { confirmed: true, authorize: allow }
  const r = await apply(id, AUTO_APPLY_ACTOR, opts)
  if (r.result !== 'needs-lead') return r
  return apply(id, AUTO_APPLY_ACTOR, { ...opts, edits: { skipLead: true } satisfies ProposalEdits })
}

export interface AutoApplyDeps {
  config?: () => Promise<TaskProposalConfig>
  filter?: () => Promise<PostFilter>
  since?: () => Promise<Date | null>
  apply?: typeof applyProposal
  summary?: (recordingId: string) => Promise<SummaryResult>
  now?: () => Date
}

/** The pass for one call (see the module comment). Never throws. */
export async function autoApplyForRecording(recordingId: string, deps: AutoApplyDeps = {}): Promise<AutoApplyReport> {
  const none = (result: AutoApplyResult): AutoApplyReport => ({ result, applied: 0, left: 0 })
  try {
    const cfg = await (deps.config ?? loadTaskProposalConfig)()
    if (!cfg.autoApply) return none('disabled')
    const rec = await prisma.callRecording.findUnique({
      where: { id: recordingId },
      select: { id: true, source: true, status: true, crewId: true, crewLabel: true, eventName: true, title: true, summary: true, actionItems: true, chapters: true, transcript: true, redactedSpeakerIds: true, redactedSegmentIds: true, reviewHoldAt: true },
    })
    if (!rec) return none('not-found')
    // Fail closed: an unreadable filter applies nothing (the sweep retries).
    const filter = await (deps.filter ?? loadPostFilter)()
    if (heldReason(rec, filter) !== null) return none('held')
    const since = await (deps.since ?? (() => switchedOnAt(AUTO_APPLY_KEY)))()
    const rows = await prisma.crewTaskProposal.findMany({
      where: { recordingId, status: 'PENDING', ...(since ? { createdAt: { gte: since } } : {}) },
      orderBy: { createdAt: 'asc' },
      take: 60,
      select: { id: true, crewId: true, kind: true, changes: true, edited: true, confidence: true, quote: true },
    })
    let applied = 0
    let left = 0
    for (const row of rows) {
      // A task routed to a crew held for the owner is never applied here (capos cannot see it either).
      if (row.crewId !== rec.crewId && autoHoldReason({ crewId: row.crewId }, filter) === 'crew') {
        left++
        continue
      }
      // A retire, or a close the model was not sure of: left for review (it gets a card).
      if (!autoApplicable(row)) {
        left++
        continue
      }
      const r = await autoApplyOne(row.id, deps.apply).catch((e) => {
        console.error('[call-tasks/auto-apply] apply failed:', e instanceof Error ? e.message : e)
        return { result: 'failed' } as ApplyOutcome
      })
      if (r.result === 'applied') applied++
      else if (r.result !== 'not-pending' && r.result !== 'missing-task' && r.result !== 'expired') left++
    }
    // The pass covers every action item of the call made so far: never stamped earlier than the newest one (clock skew).
    const newest = await prisma.crewTaskProposal.findFirst({ where: { recordingId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
    const now0 = deps.now?.() ?? new Date()
    const now = newest?.createdAt && newest.createdAt > now0 ? newest.createdAt : now0
    await prisma.callTaskAutoApply.upsert({ where: { recordingId }, create: { recordingId, appliedAt: now }, update: { appliedAt: now } })
    // A card posted before (none should be) follows the decision.
    if (rows.length) queueTaskProposalCardSync(rows.map((r) => r.id))
    const summary = applied + left > 0 ? await (deps.summary ?? ((id: string) => postActionItemSummary(id, { since: async () => since })))(recordingId) : undefined
    return { result: 'ok', applied, left, ...(summary ? { summary } : {}) }
  } catch (e) {
    console.error('[call-tasks/auto-apply] pass failed:', e instanceof Error ? e.message : e)
    return none('failed')
  }
}

/** A held call was released: run its pass after the response (or right away outside a request). Never throws. */
export function queueAutoApply(recordingId: string): void {
  const run = async () => {
    await autoApplyForRecording(recordingId).catch(() => {})
  }
  try {
    after(run)
  } catch {
    void run()
  }
}

/** Auto-hold results (owner-only terms in the transcript) per call version and filter: the transcript is read once, not every run. */
const holdMemo = new Map<string, string>()
const filterHash = (f: PostFilter) => createHash('sha1').update(JSON.stringify(f)).digest('hex')

/**
 * The followups cron sweep: calls with action items made since auto-apply was switched on that its last pass did
 * not cover (the pass failed, the call was held and is now released, or a re-run made newer ones), newest first.
 * Held calls are skipped cheaply (manual hold and owner-only crews first; the transcript check is cached per call
 * version and filter) and never count toward `limit`.
 */
export async function autoApplyDue(limit = 5, deps: AutoApplyDeps & { memo?: Map<string, string> } = {}): Promise<{ ran: Array<{ id: string; result: AutoApplyResult; applied: number }>; held: number } | { skipped: string }> {
  try {
    const cfg = await (deps.config ?? loadTaskProposalConfig)()
    if (!cfg.autoApply) return { skipped: 'disabled' }
    const since = await (deps.since ?? (() => switchedOnAt(AUTO_APPLY_KEY)))()
    if (!since) return { skipped: 'no switch-on time' }
    const now = deps.now?.() ?? new Date()
    const floor = new Date(Math.max(since.getTime(), now.getTime() - cfg.maxDays * 86_400_000))
    // A call is done when its pass ran at or after its newest action item: only newer pending ones bring it back.
    const passes = await prisma.callTaskAutoApply.findMany({ where: { appliedAt: { not: null } }, orderBy: { appliedAt: 'desc' }, take: 1000, select: { recordingId: true, appliedAt: true } })
    const recs = await prisma.crewTaskProposal.findMany({
      where: {
        status: 'PENDING',
        createdAt: { gte: floor },
        OR: [{ recordingId: { notIn: passes.map((p) => p.recordingId) } }, ...passes.map((p) => ({ recordingId: p.recordingId, createdAt: { gt: p.appliedAt as Date } }))],
      },
      distinct: ['recordingId'],
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { recordingId: true },
    })
    if (!recs.length) return { ran: [], held: 0 }
    // Fail closed: an unreadable filter runs nothing (retried next run).
    const filter = await (deps.filter ?? loadPostFilter)()
    const fh = filterHash(filter)
    const memo = deps.memo ?? holdMemo
    const ran: Array<{ id: string; result: AutoApplyResult; applied: number }> = []
    let held = 0
    for (const { recordingId: id } of recs) {
      if (ran.length >= limit) break
      const rec = await prisma.callRecording.findUnique({ where: { id }, select: { id: true, updatedAt: true, crewId: true, reviewHoldAt: true } })
      if (!rec) continue
      const key = `${rec.updatedAt.getTime()}|${fh}`
      if (rec.reviewHoldAt || autoHoldReason({ crewId: rec.crewId }, filter) === 'crew' || memo.get(id) === key) {
        held++
        continue
      }
      const r = await autoApplyForRecording(id, { ...deps, since: async () => since, filter: async () => filter })
      if (r.result === 'held') {
        held++
        if (memo.size > 2000) memo.clear()
        memo.set(id, key)
        continue
      }
      memo.delete(id)
      ran.push({ id, result: r.result, applied: r.applied })
    }
    return { ran, held }
  } catch (e) {
    console.error('[call-tasks/auto-apply] sweep failed:', e instanceof Error ? e.message : e)
    return { skipped: 'error' }
  }
}

// ---------------------------------------------------------------- summary ---

export interface SummaryItem {
  label: string
  stage: string | null
  lead: string | null
  crewId: string
  crewLabel: string | null
}

export interface SummaryView {
  callTitle: string | null
  callStartedAt: Date | null
  added: SummaryItem[]
  updated: SummaryItem[]
  closed: SummaryItem[]
  /** Still pending: each has its own card. */
  needsLook: number
  /** Where the rest is, when the list is cut. */
  moreUrl: string
  /** The capo review cards are on: the ones that need a look have their own card. */
  cardsEnabled?: boolean
}

/** Discord allows 2000 characters per message; this leaves room. */
export const SUMMARY_MAX = 1900

export const crewPageUrl = (crewId: string, appUrl: string) => `${appUrl}/crew/${encodeURIComponent(crewId)}`

/** The summary message. Pure. Never includes a transcript quote or a reason; cut with "and N more" to fit. */
export function renderActionItemSummary(v: SummaryView, appUrl: string): string {
  const title = v.callTitle?.trim() ? clean(v.callTitle, 120) : 'the call'
  const when = v.callStartedAt ? ` (${callDateTimeFormat('en-US').format(v.callStartedAt)})` : ''
  const n = (k: number) => `${k} ${k === 1 ? 'task' : 'tasks'}`
  const line = (it: SummaryItem) => {
    const crew = it.crewLabel?.trim() ? clean(it.crewLabel, 60) : clean(it.crewId, 60)
    return `• **${clean(it.label, 120)}** · ${it.stage?.trim() ? clean(it.stage, 40) : 'no stage'} · ${it.lead?.trim() ? clean(it.lead, 60) : 'no lead'} · [${crew}](<${crewPageUrl(it.crewId, appUrl)}>)`
  }
  const look = `${n(v.needsLook)}${v.cardsEnabled ? ' (each has its own card)' : ''}`
  // Lead with the first section that has something in it (never "Added: 0 tasks").
  const filled = [
    { name: 'Added', items: v.added },
    { name: 'Updated', items: v.updated },
    { name: 'Closed', items: v.closed },
  ].filter((x) => x.items.length > 0)
  const from = (name: string, count: string) => `📋 ${name} from **${title}**${when}: ${count}`
  const head = [filled.length ? from(filled[0].name, n(filled[0].items.length)) : from('Needs a look', look)]
  const tail = v.needsLook > 0 && filled.length ? [`Needs a look: ${look}`] : []
  const sections = filled.map((x, i) => ({ heading: i === 0 ? null : `${x.name}: ${n(x.items.length)}`, items: x.items }))
  const total = v.added.length + v.updated.length + v.closed.length
  const more = (k: number) => `…and ${k} more: <${v.moreUrl}>`
  // Room for the tail and the "and N more" line, whatever is cut.
  const budget = SUMMARY_MAX - [...head, ...tail, more(total)].reduce((a, s) => a + s.length + 1, 0)
  const body: string[] = []
  let used = 0
  let shown = 0
  let cut = false
  for (const s of sections) {
    for (const [i, it] of s.items.entries()) {
      const text = (i === 0 && s.heading ? `${s.heading}\n` : '') + line(it)
      if (cut || used + text.length + 1 > budget) {
        cut = true
        continue
      }
      body.push(text)
      used += text.length + 1
      shown++
    }
  }
  return [...head, ...body, ...(cut ? [more(total - shown)] : []), ...tail].join('\n')
}

export type SummaryResult = 'posted' | 'disabled' | 'no-token' | 'no-channel' | 'channel-not-private' | 'already' | 'none' | 'hidden' | 'failed'

export interface SummaryDeps {
  config?: () => Promise<TaskProposalConfig>
  filter?: () => Promise<PostFilter>
  channelId?: () => Promise<string>
  channelIsPrivate?: (channelId: string) => Promise<boolean>
  post?: (channelId: string, msg: { content: string; allowed_mentions: { parse: never[] }; flags: number }) => Promise<{ id: string | null }>
  appUrl?: () => string
  /** The pass's switch-on time: only the action items it considered are counted. */
  since?: () => Promise<Date | null>
  cardsEnabled?: () => Promise<boolean>
  env?: Record<string, string | undefined>
  now?: () => Date
}

const str = (x: unknown) => (typeof x === 'string' ? x : null)

/** The one summary message for a call (see the module comment). Never throws. */
export async function postActionItemSummary(recordingId: string, deps: SummaryDeps = {}): Promise<SummaryResult> {
  try {
    const env = deps.env ?? process.env
    const cfg = await (deps.config ?? loadTaskProposalConfig)()
    if (!cfg.autoApply) return 'disabled'
    const botToken = env.DISCORD_BOT_TOKEN?.trim()
    if (!botToken) return 'no-token'
    const claimRow = await prisma.callTaskAutoApply.findUnique({ where: { recordingId }, select: { summaryClaimedAt: true } })
    if (claimRow?.summaryClaimedAt) return 'already'
    const channelId = await (deps.channelId ?? defaultProposalCardDeps.channelId)()
    if (!channelId) return 'no-channel'
    const rec = await prisma.callRecording.findUnique({
      where: { id: recordingId },
      select: { id: true, title: true, eventName: true, startedAt: true, source: true, status: true, crewId: true, crewLabel: true, summary: true, actionItems: true, chapters: true, transcript: true, redactedSpeakerIds: true, redactedSegmentIds: true, reviewHoldAt: true },
    })
    if (!rec) return 'none'
    // Fail closed: an unreadable filter, an excluded crew or a held call posts nothing.
    const filter = await (deps.filter ?? loadPostFilter)()
    if (heldReason(rec, filter) !== null || (rec.crewId && isCrewExcluded({ id: rec.crewId, label: rec.crewLabel }, filter))) return 'hidden'
    const since = await (deps.since ?? (() => switchedOnAt(AUTO_APPLY_KEY)))()
    const rows = await prisma.crewTaskProposal.findMany({
      where: { recordingId, OR: [{ status: 'APPLIED', decidedBy: AUTO_APPLY_ACTOR }, { status: 'PENDING', ...(since ? { createdAt: { gte: since } } : {}) }] },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true, crewId: true, kind: true, taskId: true, changes: true, edited: true, status: true },
    })
    // A routed task of an excluded or owner-only crew is left out entirely.
    const visible = rows.filter((r) => r.crewId === rec.crewId || (!isCrewExcluded({ id: r.crewId }, filter) && autoHoldReason({ crewId: r.crewId }, filter) !== 'crew'))
    if (!visible.length) return 'none'
    const taskIds = [...new Set(visible.map((r) => r.taskId).filter((x): x is string => !!x))]
    const tasks = taskIds.length ? await prisma.crewTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, label: true, stage: true, leadName: true } }) : []
    const byTask = new Map(tasks.map((t) => [t.id, t]))
    const crews = await getCrewMappings(false, { staleWhileRevalidate: true }).then((m) => m.crews, () => [])
    const crewLabel = (id: string) => crews.find((c) => c.id === id)?.label ?? (id === rec.crewId ? rec.crewLabel : null)
    const appUrl = (deps.appUrl ?? defaultProposalCardDeps.appUrl)()
    const view: SummaryView = {
      callTitle: rec.title || rec.eventName || null,
      callStartedAt: rec.startedAt,
      added: [],
      updated: [],
      closed: [],
      needsLook: 0,
      cardsEnabled: await (deps.cardsEnabled ?? (() => proposalCardsEnabled(env as NodeJS.ProcessEnv)))().catch(() => false),
      // The call's crew page; a call that is not a crew call: its admin page (where its action items are listed).
      moreUrl: rec.crewId && !NON_ROSTER_CREW_IDS.has(normalizeCrewId(rec.crewId)) ? crewPageUrl(rec.crewId, appUrl) : `${appUrl}/admin/calls/${encodeURIComponent(recordingId)}#call-updates`,
    }
    for (const r of visible) {
      if (r.status === 'PENDING') {
        view.needsLook++
        continue
      }
      const eff = effectiveValues((r.changes ?? {}) as ProposalChanges, {}, (r.edited ?? null) as ProposalEdits | null)
      const t = r.taskId ? byTask.get(r.taskId) : undefined
      if (r.kind === 'CREATE') {
        view.added.push({ label: eff.label ?? '', stage: eff.stage ?? null, lead: eff.leadName ?? null, crewId: r.crewId, crewLabel: crewLabel(r.crewId) })
        continue
      }
      const item: SummaryItem = { label: t?.label ?? str(eff.label) ?? 'a task', stage: r.kind === 'RETIRE' ? 'retired' : t?.stage ?? eff.stage ?? null, lead: t?.leadName ?? eff.leadName ?? null, crewId: r.crewId, crewLabel: crewLabel(r.crewId) }
      if (r.kind === 'DONE' || r.kind === 'RETIRE' || (eff.stage && isClosedStage(eff.stage))) view.closed.push(item)
      else view.updated.push(item)
    }
    if (!(await (deps.channelIsPrivate ?? defaultProposalCardDeps.channelIsPrivate)(channelId))) {
      console.warn('[call-tasks/auto-apply] the review channel is not private (it must deny View Channel to @everyone); no summary posted')
      return 'channel-not-private'
    }
    // Claim first: two passes never post two summaries.
    const now = deps.now?.() ?? new Date()
    await prisma.callTaskAutoApply.createMany({ data: [{ recordingId }], skipDuplicates: true })
    const claim = await prisma.callTaskAutoApply.updateMany({ where: { recordingId, summaryClaimedAt: null }, data: { summaryClaimedAt: now } })
    if (claim.count !== 1) return 'already'
    const msg = { content: renderActionItemSummary(view, appUrl), allowed_mentions: { parse: [] as never[] }, flags: 4 }
    try {
      const posted = await (deps.post ?? ((c, m) => postDiscordMessage({ kind: 'bot', channelId: c, botToken }, m)))(channelId, msg)
      await prisma.callTaskAutoApply.updateMany({ where: { recordingId }, data: { summaryMessageId: posted.id, summaryError: null } }).catch(() => {})
      return 'posted'
    } catch (err) {
      const text = (err instanceof Error ? err.message : String(err)).replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim().slice(0, 300)
      console.error('[call-tasks/auto-apply] summary post failed:', text)
      // Released only when Discord definitely refused (it may hold the message otherwise).
      const refused = err instanceof DiscordPostError && err.status >= 400 && err.status < 500
      await prisma.callTaskAutoApply.updateMany({ where: { recordingId }, data: { summaryError: text, ...(refused ? { summaryClaimedAt: null } : {}) } }).catch(() => {})
      return 'failed'
    }
  } catch (e) {
    console.error('[call-tasks/auto-apply] summary failed:', e instanceof Error ? e.message : e)
    return 'failed'
  }
}
