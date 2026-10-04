import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { attemptsSoFar, getPendingSubmissions, reviewHistory } from '@/app/lib/missions'
import { HOLD_LABEL } from '@/app/lib/mission-verify/policy'
import { missionReviewScope } from '@/app/lib/mission-review-access'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ForbiddenError } from '@/app/lib/errors/api-errors'
import { loadReviewLabels } from '@/app/lib/mission-verify/review-labels'
import { getFlaggedCompletions, getSignalViews } from '@/app/lib/mission-verify/review-extras'
import { isAllGreen } from '@/app/lib/mission-verify/precheck'
import { approvalNeedsNote } from '@/app/lib/mission-verify/review-ids'

export const runtime = 'nodejs'

/** A person on the review panel: a display name instead of a bare Discord ID. */
export type ReviewPerson = { name: string; discordId: string; memberId?: string; handle?: string; avatarUrl?: string }

/** A Phase 4 pre-check (semi verifier / link preview), rendered by the panel itself. */
const isPreCheck = (r: unknown) => !!r && typeof r === 'object' && Array.isArray((r as { checks?: unknown }).checks)

// GET - List the pending mission submissions this reviewer may review
// (L1–L7 for admins / DPR / Pizza Capo / Pepperoni Mafia, L8 for DPR only),
// excluding their own.
const GET_HANDLER = async () => {
  const session = await getSession()

  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  const canReviewLevel = await missionReviewScope(session.discordId)
  if (!canReviewLevel) {
    throw new ForbiddenError('Only mission reviewers can view pending submissions')
  }

  const pending = (await getPendingSubmissions()).filter(
    p => canReviewLevel(p.mission.level) && p.discordId !== session.discordId,
  )

  const uniqueDiscordIds = [...new Set(pending.map(p => p.discordId))]

  // Reviewer information only (never blocks): duplicate-account signals for
  // these members, and approved missions flagged because the state was lost.
  const [flaggedAll, signals] = await Promise.all([getFlaggedCompletions(), getSignalViews(uniqueDiscordIds)])
  const flagged = flaggedAll.filter(f => canReviewLevel(f.mission.level) && f.discordId !== session.discordId)

  // Names instead of Discord IDs (sheet → Discord → raw ID), and role / channel
  // names for what the verifiers saw, in one parallel batch.
  const autoChecks = pending.map(p => (isPreCheck(p.checkResult) ? null : p.checkResult ?? null))
  const labels = await loadReviewLabels({
    people: [
      ...pending.map(p => ({ discordId: p.discordId, memberId: p.memberId })),
      ...[...signals.values()].flat().flatMap(s => s.others.map(discordId => ({ discordId }))),
      ...flagged.map(f => ({ discordId: f.discordId })),
    ],
    checks: autoChecks,
  })
  const personView = (discordId: string, memberId?: string | null): ReviewPerson => {
    const l = labels.person(discordId, memberId)
    return {
      name: l.name,
      discordId,
      ...(l.memberId ? { memberId: l.memberId } : {}),
      ...(l.handle ? { handle: l.handle } : {}),
      ...(l.avatarUrl ? { avatarUrl: l.avatarUrl } : {}),
    }
  }

  return NextResponse.json({
    submissions: pending.map((p, i) => {
      // Rejection history: RESUBMITTED / REOPENED events, plus legacy Phase 0 notes blocks.
      const { memberNotes, history } = reviewHistory(p.notes, p.events ?? [])
      return {
        id: p.id,
        missionId: p.missionId,
        discordId: p.discordId,
        memberId: p.memberId,
        submitter: personView(p.discordId, p.memberId),
        evidence: p.evidence,
        notes: memberNotes,
        // Earlier rejections of this same submission (it was resubmitted).
        reviewHistory: history,
        attempt: Math.max(attemptsSoFar(p), history.length + 1),
        // Auto-verified, held for a human release (D9): the reviewer "releases" it (approve).
        source: p.source ?? 'MANUAL',
        holdReason: p.holdReason ?? null,
        holdLabel: p.holdReason ? HOLD_LABEL[p.holdReason] : null,
        checkResult: p.checkResult ?? null,
        // What an automatic verifier saw, with role / channel / member names instead of IDs.
        checkItems: autoChecks[i] ? labels.describe(autoChecks[i]) : [],
        // Semi-automatic pre-checks all passed: offered for bulk approve.
        allGreen: isAllGreen(p.checkResult),
        // A manual "Invite a friend": approving needs a note (who they invited).
        noteRequired: approvalNeedsNote({ verifierKey: p.mission.verifierKey, holdReason: p.holdReason }),
        accountSignals: (signals.get(p.discordId) ?? []).map(sig => ({ ...sig, othersLabeled: sig.others.map(d => personView(d)) })),
        submittedAt: p.submittedAt.toISOString(),
        mission: {
          title: p.mission.title,
          level: p.mission.level,
          index: p.mission.index,
          description: p.mission.description,
          verifierKey: p.mission.verifierKey ?? null,
        },
      }
    }),
    flagged: flagged.map(f => ({ ...f, member: personView(f.discordId) })),
  })
}

export const GET = withErrorHandling(GET_HANDLER)
