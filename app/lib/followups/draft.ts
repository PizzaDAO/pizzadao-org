/**
 * Drafting follow-ups for one recorded call. Runs automatically once per summarized call (the
 * followups cron and the ingest hook), and again on demand from the call page ("re-draft", e.g.
 * after a reviewer edits the summary). Idempotent: rows are keyed by sourceKey, so a re-run only
 * adds items it has not seen and never touches a row a reviewer already edited or decided on.
 * Drafts only: nothing is sent from here.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { sanitizeSummaryError, visibleSegments } from '@/app/lib/calls/recordings'
import { fetchAllMembers } from '@/app/lib/sheets/members-list'
import { loadFollowUpConfig } from './config'
import { extractFollowUps, type FollowUpDraft } from './extract'
import { resolveOwner, type MemberRef } from './resolve'

export type DraftResult = 'ok' | 'already' | 'disabled' | 'crew-excluded' | 'not-ready' | 'failed' | 'not-found'

export const MAX_DRAFT_ATTEMPTS = 3
const WINDOW_DAYS = 14

async function loadMembers(): Promise<MemberRef[]> {
  try {
    const all = await fetchAllMembers({ includeDiscordId: true, includeUnonboarded: true })
    return all.map((m) => ({ id: m.id, name: m.name, discordId: m.discordId ?? '' }))
  } catch (e) {
    console.warn('[followups] member list unavailable:', e instanceof Error ? e.message.slice(0, 120) : 'error')
    return []
  }
}

/** Resolve each draft to a person and store the new ones. Returns how many rows were created. */
export async function storeDrafts(recordingId: string, drafts: FollowUpDraft[], members: MemberRef[], actorId: string): Promise<number> {
  if (drafts.length === 0) return 0
  const existing = new Set((await prisma.followUp.findMany({ where: { sourceKey: { in: drafts.map((d) => d.sourceKey) } }, select: { sourceKey: true } })).map((r) => r.sourceKey))
  let created = 0
  for (const d of drafts) {
    if (existing.has(d.sourceKey)) continue
    const r = resolveOwner({ ownerName: d.ownerName, speakerDiscordId: d.speakerDiscordId }, members)
    try {
      await prisma.followUp.create({
        data: {
          recordingId,
          sourceKey: d.sourceKey,
          ownerName: d.ownerName,
          ownerDiscordId: r.discordId,
          ownerMemberId: r.memberId,
          candidates: r.candidates.length > 0 ? (r.candidates as unknown as Prisma.InputJsonValue) : undefined,
          kind: d.kind,
          ask: d.ask,
          message: d.message,
          quote: d.quote,
          startMs: d.startMs,
          dueAt: d.dueAt,
          dueText: d.dueText,
          events: { create: [{ type: 'drafted', actorId, data: { resolution: r.status, matchedBy: r.matchedBy } }] },
        },
      })
      created++
    } catch (e) {
      // A parallel run created the same sourceKey first: that is the idempotency guard working.
      if ((e as { code?: string })?.code !== 'P2002') throw e
    }
  }
  return created
}

export async function draftFollowUpsForRecording(
  id: string,
  opts: { force?: boolean; actorId?: string; budgetMs?: number; now?: Date } = {},
): Promise<{ result: DraftResult; created: number }> {
  const now = opts.now ?? new Date()
  const actorId = opts.actorId ?? 'system'
  const rec = await prisma.callRecording.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      crewId: true,
      summary: true,
      actionItems: true,
      transcript: true,
      redactedSpeakerIds: true,
      redactedSegmentIds: true,
      followupsDraftedAt: true,
      followupsAttempts: true,
      speakers: { select: { discordId: true, displayName: true } },
    },
  })
  if (!rec) return { result: 'not-found', created: 0 }
  // Rejected calls and calls still being processed produce nothing.
  if (!['IN_REVIEW', 'PUBLISHED'].includes(rec.status) || !rec.summary?.trim()) return { result: 'not-ready', created: 0 }

  if (!opts.force) {
    if (rec.followupsDraftedAt) return { result: 'already', created: 0 }
    if (rec.followupsAttempts >= MAX_DRAFT_ATTEMPTS) return { result: 'failed', created: 0 }
    const cfg = await loadFollowUpConfig()
    if (!cfg.draftEnabled) return { result: 'disabled', created: 0 }
    if (cfg.draftCrews.length > 0 && !(rec.crewId && cfg.draftCrews.includes(rec.crewId))) {
      // Mark it handled so the sweep does not keep picking this call; a reviewer can still draft it by hand.
      await prisma.callRecording.updateMany({ where: { id, followupsDraftedAt: null }, data: { followupsDraftedAt: now } })
      return { result: 'crew-excluded', created: 0 }
    }
    // Claim an attempt before the model call so a killed run cannot loop forever.
    const claim = await prisma.callRecording.updateMany({ where: { id, followupsDraftedAt: null }, data: { followupsAttempts: { increment: 1 } } })
    if (claim.count !== 1) return { result: 'already', created: 0 }
  }

  const segments = visibleSegments(rec.transcript, rec.redactedSpeakerIds, rec.redactedSegmentIds)
  try {
    const drafts = await extractFollowUps(
      {
        segments,
        speakers: rec.speakers.filter((s) => !rec.redactedSpeakerIds.includes(s.discordId)),
        actionItems: Array.isArray(rec.actionItems) ? (rec.actionItems as Array<{ text?: string; owner?: string | null }>) : [],
        today: now,
        recordingId: id,
      },
      { budgetMs: opts.budgetMs },
    )
    const created = await storeDrafts(id, drafts, await loadMembers(), actorId)
    await prisma.callRecording.update({ where: { id }, data: { followupsDraftedAt: now, followupsError: null } })
    return { result: 'ok', created }
  } catch (e) {
    const message = sanitizeSummaryError(e instanceof Error ? e.message : String(e))
    console.error('[followups] drafting failed:', message)
    await prisma.callRecording.update({ where: { id }, data: { followupsError: message } }).catch(() => {})
    return { result: 'failed', created: 0 }
  }
}

/** Summarized calls from the last two weeks that still need their one drafting pass. */
export async function listNeedingFollowups(limit = 3, now = new Date()): Promise<Array<{ id: string }>> {
  return prisma.callRecording.findMany({
    where: {
      status: { in: ['IN_REVIEW', 'PUBLISHED'] },
      summary: { not: null },
      followupsDraftedAt: null,
      followupsAttempts: { lt: MAX_DRAFT_ATTEMPTS },
      startedAt: { gte: new Date(now.getTime() - WINDOW_DAYS * 86_400_000) },
    },
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: { id: true },
  })
}
