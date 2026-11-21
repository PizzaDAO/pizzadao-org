/**
 * Proposing crew task updates for one recorded call (plans/post-call-agenda-updates.md, ask 2).
 * Runs once per summarized call of an allowlisted crew (ingest hook + the followups cron sweep) and
 * on demand from the call page. Idempotent: rows are keyed by sourceKey, so a re-run only adds
 * proposals it has not seen and never touches a decided row. Proposals only: nothing here changes a
 * task (with calls.taskProposalsAutoApply on, auto-apply.ts applies the new ones right after), and the
 * optional crew-channel nudge carries a count and a link, never the proposals.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { loadSettings } from '@/app/lib/settings'
import { getCrewMappings, isClosedStage, type CrewOption } from '@/app/lib/crew-mappings'
import { isNonCrewId, NON_ROSTER_CREW_IDS, normalizeCrewId, realCrews } from '@/app/lib/crew-id'
import type { Settings } from '@/app/lib/settings'
import type { PostFilter } from '@/app/lib/calls/post-filters'
import { sanitizeSummaryError, visibleSegments } from '@/app/lib/calls/recordings'
import { DISCORD_ONLY, isImportedSource } from '@/app/lib/calls/imported'
import { isCrewExcluded, loadPostFilter } from '@/app/lib/calls/post-filters'
import { mergeLiveActionItems } from '@/app/lib/calls/live-items'
import { buildSpeakerNames } from '@/app/lib/calls/summarize'
import { redactionsNewerThanSummary, resolveRecapChannel } from '@/app/lib/calls/recap'
import { DiscordPostError, postDiscordMessage } from '@/app/lib/discord-rest'
import { appUrl } from '@/app/lib/followups/config'
import { loadMembers } from '@/app/lib/followups/draft'
import { usesDb } from '@/app/lib/sheets-import/source'
import { crewInAllowlist, loadTaskProposalConfig } from './config'
import { proposeTaskUpdates } from './extract'
import type { ProposalDraft, TaskRef } from './proposals'
import { buildRouting, parseCrewHints, type Routing } from './routing'

export type ProposeResult = 'ok' | 'already' | 'disabled' | 'crew-excluded' | 'not-db-crew' | 'not-ready' | 'failed' | 'not-found'

export const MAX_PROPOSAL_ATTEMPTS = 3
const WINDOW_DAYS = 14
/** Tasks sent to the model: all open ones, plus tasks closed in the last few weeks (so "it is done" is not proposed twice). */
const RECENT_CLOSED_DAYS = 21
const MAX_TASKS_IN_PROMPT = 150

/** The crew's tasks as the model sees them: open first, then recently closed, capped. */
export async function loadTaskRefs(crewId: string, now: Date): Promise<TaskRef[]> {
  const rows = await prisma.crewTask.findMany({
    where: { crewId, archived: false },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, label: true, stage: true, priority: true, due: true, leadName: true, leadMemberId: true, updatedAt: true, doneAt: true },
  })
  const cutoff = now.getTime() - RECENT_CLOSED_DAYS * 86_400_000
  const open = rows.filter((r) => !isClosedStage(r.stage))
  const closed = rows.filter((r) => isClosedStage(r.stage) && (r.doneAt?.getTime() ?? 0) >= cutoff)
  return [...open, ...closed].slice(0, MAX_TASKS_IN_PROMPT).map((t) => ({ id: t.id, label: t.label, stage: t.stage, priority: t.priority, due: t.due, leadName: t.leadName, leadMemberId: t.leadMemberId, updatedAt: t.updatedAt }))
}

/**
 * For a call that is not a crew call (the Community Call): the crews its new tasks can go to — real
 * crews whose tasks are edited on the website and that the private filter does not exclude — plus
 * the routing hints and the default crew from settings. Undefined for a crew call (proposals stay on
 * the call's crew, as before) or when no crew qualifies.
 */
export async function loadRouting(
  callCrewId: string,
  settings: Pick<Settings, 'get'>,
  filter: PostFilter,
  deps: { crews?: () => Promise<CrewOption[]>; usesDb?: (crewId: string) => Promise<boolean> } = {},
): Promise<Routing | undefined> {
  const all = await (deps.crews ?? (async () => (await getCrewMappings()).crews))()
  if (!isNonCrewId(callCrewId, all)) return undefined
  const dbCrew = deps.usesDb ?? ((id: string) => usesDb('crewTasks', id))
  const targets: CrewOption[] = []
  for (const c of realCrews(all)) {
    if (isCrewExcluded({ id: c.id, label: c.label }, filter)) continue
    if (await dbCrew(c.id)) targets.push(c)
  }
  if (targets.length === 0) return undefined
  return buildRouting(targets, parseCrewHints(settings.get('calls.taskProposalsCrewHints')), String(settings.get('calls.taskProposalsDefaultCrew') ?? ''))
}

/** Store the new drafts (existing sourceKeys are left alone). Returns the number created. */
export async function storeProposals(recordingId: string, crewId: string, drafts: ProposalDraft[], startedAt?: Date | null): Promise<number> {
  if (drafts.length === 0) return 0
  // Only proposals from OLDER calls of the crew go stale (a re-run for an earlier call must not touch a newer call's).
  const olderIds = startedAt ? (await prisma.callRecording.findMany({ where: { crewId, startedAt: { lt: startedAt }, id: { not: recordingId } }, select: { id: true } })).map((r) => r.id) : []
  const existing = new Set((await prisma.crewTaskProposal.findMany({ where: { sourceKey: { in: drafts.map((d) => d.sourceKey) } }, select: { sourceKey: true } })).map((r) => r.sourceKey))
  let created = 0
  for (const d of drafts) {
    if (existing.has(d.sourceKey)) continue
    // A routed CREATE (from a call that is not a crew call) belongs to its target crew.
    const ownCrew = d.crewId || crewId
    try {
      await prisma.crewTaskProposal.create({
        data: {
          recordingId,
          crewId: ownCrew,
          sourceKey: d.sourceKey,
          kind: d.kind,
          taskId: d.taskId,
          baseUpdatedAt: d.baseUpdatedAt,
          changes: d.changes as unknown as Prisma.InputJsonValue,
          leadName: d.leadName,
          leadMemberId: d.leadMemberId,
          candidates: d.candidates.length > 0 ? (d.candidates as unknown as Prisma.InputJsonValue) : undefined,
          reason: d.reason,
          quote: d.quote,
          startMs: d.startMs,
          confidence: d.confidence,
          actionItemIdx: d.actionItemIdx,
        },
      })
      created++
      // A newer call proposes a change to the same task: older undecided proposals for it are out of date.
      if (d.taskId && olderIds.length > 0) {
        await prisma.crewTaskProposal.updateMany({ where: { crewId: ownCrew, taskId: d.taskId, status: 'PENDING', recordingId: { in: olderIds } }, data: { status: 'STALE' } })
      }
    } catch (e) {
      // A parallel run created the same sourceKey first: that is the idempotency guard working.
      if ((e as { code?: string })?.code !== 'P2002') throw e
    }
  }
  return created
}

export async function proposeTasksForRecording(
  id: string,
  opts: { force?: boolean; actorId?: string; budgetMs?: number; now?: Date } = {},
): Promise<{ result: ProposeResult; created: number }> {
  const now = opts.now ?? new Date()
  const rec = await prisma.callRecording.findUnique({
    where: { id },
    select: {
      id: true,
      sessionId: true,
      startedAt: true,
      status: true,
      source: true,
      crewId: true,
      crewLabel: true,
      summary: true,
      actionItems: true,
      transcript: true,
      redactedSpeakerIds: true,
      redactedSegmentIds: true,
      redactionsUpdatedAt: true,
      summaryGeneratedAt: true,
      summaryEditedAt: true,
      taskProposalsAt: true,
      taskProposalsAttempts: true,
      speakers: { select: { discordId: true, displayName: true } },
    },
  })
  if (!rec) return { result: 'not-found', created: 0 }
  // Imported (old X broadcast) calls never get task proposals.
  if (isImportedSource(rec.source)) return { result: 'disabled', created: 0 }
  if (!['IN_REVIEW', 'PUBLISHED'].includes(rec.status) || !rec.summary?.trim()) return { result: 'not-ready', created: 0 }
  if (!rec.crewId) return { result: 'disabled', created: 0 }
  const crewId = rec.crewId

  const cfg = await loadTaskProposalConfig()
  // Switched off, or the crew is not in the pilot list: nothing happens and nothing is marked, so turning it on later picks recent calls up.
  if (!cfg.enabled || !crewInAllowlist(cfg, crewId)) return { result: 'disabled', created: 0 }

  if (!opts.force) {
    if (rec.taskProposalsAt) return { result: 'already', created: 0 }
    if (rec.taskProposalsAttempts >= MAX_PROPOSAL_ATTEMPTS) return { result: 'failed', created: 0 }
  }

  // Fail safe: if the private filter cannot be read, propose nothing (the sweep retries).
  let filter
  try {
    filter = await loadPostFilter()
  } catch (e) {
    console.error('[call-tasks] post filter unavailable:', e instanceof Error ? e.message : e)
    return { result: 'failed', created: 0 }
  }
  if (isCrewExcluded({ id: crewId, label: rec.crewLabel }, filter)) {
    if (!opts.force) await prisma.callRecording.updateMany({ where: { id, taskProposalsAt: null }, data: { taskProposalsAt: now } })
    return { result: 'crew-excluded', created: 0 }
  }
  if (!(await usesDb('crewTasks', crewId))) {
    if (!opts.force) await prisma.callRecording.updateMany({ where: { id, taskProposalsAt: null }, data: { taskProposalsAt: now } })
    return { result: 'not-db-crew', created: 0 }
  }

  if (!opts.force) {
    // Claim an attempt before the model call so a killed run cannot loop forever.
    const claim = await prisma.callRecording.updateMany({ where: { id, taskProposalsAt: null }, data: { taskProposalsAttempts: { increment: 1 } } })
    if (claim.count !== 1) return { result: 'already', created: 0 }
  }

  const segments = visibleSegments(rec.transcript, rec.redactedSpeakerIds, rec.redactedSegmentIds)
  try {
    const settings = await loadSettings()
    const routing = await loadRouting(crewId, settings, filter)
    // The action items: the summary's own (not when a hidden speaker/line may be in them) plus the live ones, merged with redactions applied.
    const base = Array.isArray(rec.actionItems) ? (rec.actionItems as Array<{ text?: string; owner?: string | null; suggestedBy?: string | null }>).filter((a): a is { text: string; owner: string | null; suggestedBy?: string | null } => typeof a?.text === 'string').map((a) => ({ text: a.text, owner: a.owner ?? null, ...(a.suggestedBy ? { suggestedBy: a.suggestedBy } : {}) })) : []
    const live = await prisma.callLiveItem
      .findMany({
        where: { sessionId: rec.sessionId },
        orderBy: { createdAt: 'asc' },
        select: { text: true, owner: true, source: true, speakerIds: true, messageId: true, startMs: true, endMs: true },
      })
      .catch(() => [])
    const actionItems = mergeLiveActionItems(redactionsNewerThanSummary(rec) ? [] : base, live, segments, rec.redactedSpeakerIds, undefined, buildSpeakerNames(rec.speakers, segments))
    const drafts = await proposeTaskUpdates(
      {
        recordingId: id,
        segments,
        speakers: rec.speakers.filter((s) => !rec.redactedSpeakerIds.includes(s.discordId)),
        actionItems,
        tasks: await loadTaskRefs(crewId, now),
        members: await loadMembers(),
        filter,
        today: now,
        max: cfg.maxPerCall,
        ...(routing ? { routing } : {}),
      },
      settings,
      { model: cfg.model, budgetMs: opts.budgetMs },
    )
    const created = await storeProposals(id, crewId, drafts, rec.startedAt)
    await prisma.callRecording.update({ where: { id }, data: { taskProposalsAt: now, taskProposalsError: null } })
    // Action items straight onto the crew's tasks (off unless calls.taskProposalsAutoApply), before the nudge so it counts only what is left.
    // Lazy: auto-apply.ts imports this module (through apply.ts).
    if (created > 0 && cfg.autoApply) await (await import('./auto-apply')).autoApplyForRecording(id).catch((e) => console.warn('[call-tasks] auto-apply failed:', e instanceof Error ? e.message : e))
    if (created > 0 && cfg.nudge) await nudgeCrew(id).catch((e) => console.warn('[call-tasks] nudge failed:', e instanceof Error ? e.message : e))
    return { result: 'ok', created }
  } catch (e) {
    const message = sanitizeSummaryError(e instanceof Error ? e.message : String(e))
    console.error('[call-tasks] proposing failed:', message)
    await prisma.callRecording.update({ where: { id }, data: { taskProposalsError: message } }).catch(() => {})
    return { result: 'failed', created: 0 }
  }
}

/** Calls (last two weeks) of allowlisted crews that still need their one proposal pass. */
export async function listNeedingProposals(limit = 1, now = new Date()): Promise<Array<{ id: string }>> {
  const cfg = await loadTaskProposalConfig()
  if (!cfg.enabled) return []
  return prisma.callRecording.findMany({
    where: {
      ...DISCORD_ONLY,
      status: { in: ['IN_REVIEW', 'PUBLISHED'] },
      summary: { not: null },
      crewId: { in: cfg.crews },
      taskProposalsAt: null,
      taskProposalsAttempts: { lt: MAX_PROPOSAL_ATTEMPTS },
      startedAt: { gte: new Date(now.getTime() - WINDOW_DAYS * 86_400_000) },
    },
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: { id: true },
  })
}

/** Undecided proposals older than `calls.taskProposalMaxDays` can no longer be applied. Returns how many expired. */
export async function expireOldProposals(maxDays: number, now = new Date()): Promise<number> {
  const where = { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - maxDays * 86_400_000) } }
  // The ones with a posted Discord card, so the card can say it is stale (looked up first: they stop being PENDING).
  let carded: Array<{ proposalId: string }> = []
  try {
    carded = (await prisma.crewTaskProposalCard.findMany({ where: { messageId: { not: null }, proposal: where }, select: { proposalId: true }, take: 200 })) ?? []
  } catch {
    // best effort: the sweep re-renders live cards anyway
  }
  const res = await prisma.crewTaskProposal.updateMany({ where, data: { status: 'STALE' } })
  if (carded.length) {
    // Lazy: the cards module imports this one (through apply.ts).
    const { queueTaskProposalCardSync } = await import('./cards')
    queueTaskProposalCardSync(carded.map((c) => c.proposalId))
  }
  return res.count
}

/** Where a crew's waiting proposals are reviewed: its crew page. */
export function crewReviewUrl(crewId: string, base: string = appUrl()): string {
  return `${base}/crew/${encodeURIComponent(crewId)}#call-updates`
}

/** Proposals left on a call that is not a crew call (no crew fitted, no default crew): only admins review them, on the admin call page. */
export function adminCallReviewUrl(recordingId: string, base: string = appUrl()): string {
  return `${base}/admin/calls/${encodeURIComponent(recordingId)}#call-updates`
}

export function nudgeText(count: number, crewId: string, base: string = appUrl(), url: string = crewReviewUrl(crewId, base)): string {
  return `📋 ${count === 1 ? '1 task update from today\'s call is' : `${count} task updates from today's call are`} waiting for a crew lead to review: ${url}`
}

export function movedNudgeText(crewId: string, base: string = appUrl()): string {
  return `📋 A task update from a call was moved to this crew and is waiting for a crew lead to review: ${crewReviewUrl(crewId, base)}`
}

/**
 * A decider moved a proposal to another crew they do not lead: one short line in that crew's
 * channel (a link, never the proposal). Same switch, token, exclusion and channel as the nudge.
 */
export async function nudgeMoved(proposalId: string, crewId: string, deps: { post?: typeof postDiscordMessage; env?: Record<string, string | undefined> } = {}): Promise<NudgeResult> {
  const env = deps.env ?? process.env
  const cfg = await loadTaskProposalConfig(env)
  if (!cfg.nudge) return 'disabled'
  const botToken = env.DISCORD_BOT_TOKEN?.trim()
  if (!botToken) return 'no-token'
  const row = await prisma.crewTaskProposal.findUnique({ where: { id: proposalId }, select: { crewId: true, status: true } })
  if (!row || row.crewId !== crewId || row.status !== 'PENDING') return 'none'
  if (isCrewExcluded({ id: crewId }, await loadPostFilter())) return 'excluded'
  const channel = await resolveRecapChannel(crewId, { env })
  if (!channel) return 'no-channel'
  try {
    await (deps.post ?? postDiscordMessage)({ kind: 'bot', channelId: channel.channelId, botToken }, { content: movedNudgeText(crewId), allowed_mentions: { parse: [] }, flags: 4 })
    return 'posted'
  } catch (err) {
    console.error('[call-tasks] move nudge failed:', err instanceof Error ? err.message : err)
    return 'failed'
  }
}

export type NudgeResult = 'posted' | 'disabled' | 'already' | 'none' | 'no-channel' | 'no-token' | 'excluded' | 'failed'

/**
 * One short line in the crew's channel that proposals are waiting (a count and a link). Off by
 * default (calls.taskProposalsNudgeEnabled), production only, at most once per call (claimed before
 * the post), never for an excluded crew. The claim is released only when Discord definitely refused.
 */
export async function nudgeCrew(id: string, deps: { post?: typeof postDiscordMessage; env?: Record<string, string | undefined> } = {}): Promise<NudgeResult> {
  const env = deps.env ?? process.env
  const cfg = await loadTaskProposalConfig(env)
  if (!cfg.nudge) return 'disabled'
  const botToken = env.DISCORD_BOT_TOKEN?.trim()
  if (!botToken) return 'no-token'
  const rec = await prisma.callRecording.findUnique({ where: { id }, select: { id: true, crewId: true, crewLabel: true, taskProposalsNudgedAt: true } })
  if (!rec?.crewId) return 'none'
  if (rec.taskProposalsNudgedAt) return 'already'
  const filter = await loadPostFilter()
  if (isCrewExcluded({ id: rec.crewId, label: rec.crewLabel }, filter)) return 'excluded'
  // Proposals routed from a call that is not a crew call belong to other crews: each crew with
  // waiting proposals gets its own line in its own channel, linking to its own page.
  const rows = await prisma.crewTaskProposal.findMany({ where: { recordingId: id, status: 'PENDING' }, select: { crewId: true } })
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.crewId, (counts.get(r.crewId) ?? 0) + 1)
  // Proposals still on a call that is not a crew call have no crew leads: link admins to the call page.
  let callIsCrew = !NON_ROSTER_CREW_IDS.has(normalizeCrewId(rec.crewId))
  if (callIsCrew && counts.has(rec.crewId)) {
    try {
      callIsCrew = !isNonCrewId(rec.crewId, (await getCrewMappings()).crews)
    } catch {
      // registry unreadable: keep the crew link
    }
  }
  const targets: Array<{ crewId: string; count: number; channelId: string }> = []
  for (const [crewId, count] of counts) {
    if (crewId !== rec.crewId && isCrewExcluded({ id: crewId }, filter)) continue
    const channel = await resolveRecapChannel(crewId, { env })
    if (channel) targets.push({ crewId, count, channelId: channel.channelId })
  }
  if (counts.size === 0) return 'none'
  if (targets.length === 0) return 'no-channel'
  const claim = await prisma.callRecording.updateMany({ where: { id, taskProposalsNudgedAt: null }, data: { taskProposalsNudgedAt: new Date() } })
  if (claim.count !== 1) return 'already'
  let posted = 0
  let refused = 0
  for (const tg of targets) {
    try {
      await (deps.post ?? postDiscordMessage)({ kind: 'bot', channelId: tg.channelId, botToken }, { content: nudgeText(tg.count, tg.crewId, appUrl(), tg.crewId === rec.crewId && !callIsCrew ? adminCallReviewUrl(id) : undefined), allowed_mentions: { parse: [] }, flags: 4 })
      posted++
    } catch (err) {
      console.error('[call-tasks] nudge post failed:', err instanceof Error ? err.message : err)
      if (err instanceof DiscordPostError && err.status >= 400 && err.status < 500) refused++
    }
  }
  if (posted > 0) return 'posted'
  // Released only when Discord definitely refused every post.
  if (refused === targets.length) await prisma.callRecording.updateMany({ where: { id }, data: { taskProposalsNudgedAt: null } })
  return 'failed'
}
