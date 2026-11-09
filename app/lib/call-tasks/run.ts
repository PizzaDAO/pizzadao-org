/**
 * Proposing crew task updates for one recorded call (plans/post-call-agenda-updates.md, ask 2).
 * Runs once per summarized call of an allowlisted crew (ingest hook + the followups cron sweep) and
 * on demand from the call page. Idempotent: rows are keyed by sourceKey, so a re-run only adds
 * proposals it has not seen and never touches a decided row. Proposals only: nothing here changes a
 * task, and the optional crew-channel nudge carries a count and a link, never the proposals.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { loadSettings } from '@/app/lib/settings'
import { isClosedStage } from '@/app/lib/crew-mappings'
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

/** Store the new drafts (existing sourceKeys are left alone). Returns the number created. */
export async function storeProposals(recordingId: string, crewId: string, drafts: ProposalDraft[], startedAt?: Date | null): Promise<number> {
  if (drafts.length === 0) return 0
  // Only proposals from OLDER calls of the crew go stale (a re-run for an earlier call must not touch a newer call's).
  const olderIds = startedAt ? (await prisma.callRecording.findMany({ where: { crewId, startedAt: { lt: startedAt }, id: { not: recordingId } }, select: { id: true } })).map((r) => r.id) : []
  const existing = new Set((await prisma.crewTaskProposal.findMany({ where: { sourceKey: { in: drafts.map((d) => d.sourceKey) } }, select: { sourceKey: true } })).map((r) => r.sourceKey))
  let created = 0
  for (const d of drafts) {
    if (existing.has(d.sourceKey)) continue
    try {
      await prisma.crewTaskProposal.create({
        data: {
          recordingId,
          crewId,
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
        await prisma.crewTaskProposal.updateMany({ where: { crewId, taskId: d.taskId, status: 'PENDING', recordingId: { in: olderIds } }, data: { status: 'STALE' } })
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
      },
      settings,
      { model: cfg.model, budgetMs: opts.budgetMs },
    )
    const created = await storeProposals(id, crewId, drafts, rec.startedAt)
    await prisma.callRecording.update({ where: { id }, data: { taskProposalsAt: now, taskProposalsError: null } })
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
  const res = await prisma.crewTaskProposal.updateMany({ where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - maxDays * 86_400_000) } }, data: { status: 'STALE' } })
  return res.count
}

export function nudgeText(count: number, crewId: string, base: string = appUrl()): string {
  return `📋 ${count === 1 ? '1 task update from today\'s call is' : `${count} task updates from today's call are`} waiting for a crew lead to review: ${base}/crew/${encodeURIComponent(crewId)}#call-updates`
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
  const count = await prisma.crewTaskProposal.count({ where: { recordingId: id, status: 'PENDING' } })
  if (count === 0) return 'none'
  const channel = await resolveRecapChannel(rec.crewId, { env })
  if (!channel) return 'no-channel'
  const claim = await prisma.callRecording.updateMany({ where: { id, taskProposalsNudgedAt: null }, data: { taskProposalsNudgedAt: new Date() } })
  if (claim.count !== 1) return 'already'
  try {
    await (deps.post ?? postDiscordMessage)({ kind: 'bot', channelId: channel.channelId, botToken }, { content: nudgeText(count, rec.crewId), allowed_mentions: { parse: [] }, flags: 4 })
    return 'posted'
  } catch (err) {
    console.error('[call-tasks] nudge post failed:', err instanceof Error ? err.message : err)
    if (err instanceof DiscordPostError && err.status >= 400 && err.status < 500) await prisma.callRecording.updateMany({ where: { id }, data: { taskProposalsNudgedAt: null } })
    return 'failed'
  }
}
