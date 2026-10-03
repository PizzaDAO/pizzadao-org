/**
 * The deferred half of a review-card button (Approve / Release) or of the
 * Reject modal. The interaction handler has already checked the reviewer
 * (canReviewMission with the interaction's member.roles, not their own
 * submission, still PENDING) and answered Discord within 3 s with a deferred
 * update (type 6); this runs afterwards (route: after()):
 *
 *   1. the same server functions as the web panel: approveMission (which also
 *      releases holds, settles levels in order and pays exactly once) or
 *      rejectMission, both writing the MissionReviewEvent with via "discord";
 *   2. the card is edited to show the outcome (./review-cards.ts);
 *   3. a level-up is announced and the member's progress cache invalidated.
 *
 * Both functions move PENDING -> decided with a conditional update, so when
 * two reviewers click at once exactly one wins. The loser gets an ephemeral
 * follow-up "Already handled by X" (POST /webhooks/{app}/{token}, flags 64).
 * Dependencies are injected so tests never reach Discord or the DB.
 */
import { ConflictError } from '../errors/api-errors'
import { makeEmbed, type Embed } from '../discord-interactions/embeds'
import type { ReviewDecisionJob } from '../discord-interactions/mission-review'
import { handledText, type CardRef, type HandledState } from './review-ids'

export type { ReviewDecisionJob } from '../discord-interactions/mission-review'

const API = 'https://discord.com/api/v10'

export interface ReviewDecisionDeps {
  approve: (reviewerId: string, completionId: number, note?: string) => Promise<{ discordId: string; levelsPaid?: number[] }>
  reject: (reviewerId: string, completionId: number, reason: string) => Promise<{ discordId: string }>
  handledBy: (completionId: number) => Promise<HandledState | null>
  syncCard: (completionId: number, card?: CardRef) => Promise<unknown>
  announce?: (discordId: string, levelsPaid: number[]) => Promise<unknown>
  invalidate?: (discordId: string) => void
  /** Ephemeral follow-up to the reviewer. */
  followup: (applicationId: string, token: string, embed: Embed) => Promise<void>
}

export type DecisionOutcome = 'approved' | 'rejected' | 'already_handled' | 'error'

export async function runReviewDecision(job: ReviewDecisionJob, deps: ReviewDecisionDeps): Promise<DecisionOutcome> {
  const tell = (embed: Embed) =>
    deps.followup(job.applicationId, job.token, embed).catch((err) => console.error('[mission review] follow-up failed:', err))
  try {
    let discordId: string
    let levelsPaid: number[] = []
    if (job.action === 'reject') {
      const reason = (job.reason ?? '').trim()
      ;({ discordId } = await deps.reject(job.reviewerId, job.completionId, reason))
    } else {
      const note = job.reason?.trim()
      const r = note ? await deps.approve(job.reviewerId, job.completionId, note) : await deps.approve(job.reviewerId, job.completionId)
      discordId = r.discordId
      levelsPaid = r.levelsPaid ?? []
    }
    deps.invalidate?.(discordId)
    await deps.syncCard(job.completionId, job.card)
    if (levelsPaid.length && deps.announce) {
      await deps.announce(discordId, levelsPaid).catch((err) => console.error('[mission review] announce failed:', err))
    }
    return job.action === 'reject' ? 'rejected' : 'approved'
  } catch (err) {
    if (err instanceof ConflictError) {
      // Another reviewer (web or Discord) or the verifier got there first.
      const h = await deps.handledBy(job.completionId).catch(() => null)
      await tell(makeEmbed('error', 'Already handled.', handledText(h)))
      await deps.syncCard(job.completionId, job.card)
      return 'already_handled'
    }
    console.error(`[mission review] ${job.action} of completion ${job.completionId} failed:`, err)
    await tell(makeEmbed('error', 'Something went wrong.', 'Nothing was changed. Please try again, or review in the app.'))
    return 'error'
  }
}

/** POST an ephemeral follow-up message through the interaction webhook. */
export async function postEphemeralFollowup(applicationId: string, token: string, embed: Embed, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${API}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed], flags: 64, allowed_mentions: { parse: [] } }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Discord ${res.status} sending a follow-up: ${(await res.text()).slice(0, 200)}`)
}
