/**
 * Review-card buttons and the Reject modal (plans/mission-verification.md
 * §5.2). Pure apart from the injected deps, like the rest of handle.ts.
 *
 *   mr:approve:<id> / mr:release:<id>   check, then a deferred update (type 6);
 *                                       the decision runs in after() (deps.decide)
 *   mr:reject:<id>                      check, then open a modal asking for a reason
 *   mr:reject-modal:<id> (modal submit) check again, then a deferred update and
 *                                       the rejection in after()
 *
 * Every path checks, in order: the feature flag (MISSION_REVIEW_CARDS_ENABLED),
 * that the completion exists, canReviewMission(member.roles, level) (L1–L7:
 * Leonardo, Dread Pizza Roberts, Pizza Capo, Pepperoni Mafia; L8: Dread Pizza
 * Roberts only), not your own submission, and still PENDING. Refusals are
 * ephemeral. The final race (two reviewers at once) is settled by the
 * conditional update in approveMission / rejectMission (./mission-verify/review-decision.ts).
 */
import type { MissionHold } from '@prisma/client'
import { InteractionType, ResponseType } from './commands'
import type { Interaction, InteractionResponse } from './handle'
import {
  APPROVE_MODAL_ID,
  APPROVE_NOTE_INPUT,
  approveModalId,
  handledText,
  REJECT_MODAL_ID,
  REJECT_REASON_INPUT,
  REVIEW_BUTTON_ID,
  rejectModalId,
  type CardRef,
  type ReviewButton,
} from '../mission-verify/review-ids'

/** What the deferred decision (../mission-verify/review-decision.ts) needs. */
export interface ReviewDecisionJob {
  action: ReviewButton
  completionId: number
  reviewerId: string
  /** Reject: the modal's reason. Approve (a note-required mission): the reviewer's note. */
  reason?: string
  applicationId: string
  token: string
  /** The card message the interaction came from. */
  card?: CardRef
}

export interface ReviewTarget {
  discordId: string
  level: number
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  holdReason: MissionHold | null
  reviewedBy: string | null
  reviewedAt: Date | null
  /** Approving needs a note (a manual L3.1 referral): Approve opens a modal. */
  noteRequired?: boolean
}

export interface MissionReviewDeps {
  /** MISSION_REVIEW_CARDS_ENABLED. */
  enabled: () => boolean
  target: (completionId: number) => Promise<ReviewTarget | null>
  /** canReviewMission(roles, level). */
  canReview: (roles: string[], level: number) => Promise<boolean>
  /** Schedule the decision after the response (route: after()). Must not block. */
  decide: (job: ReviewDecisionJob) => void
  /** Schedule a card refresh (a stale card was clicked). Must not block. */
  refresh?: (completionId: number, card?: CardRef) => void
  appUrl?: string
}

type Refuse = (headline: string, body?: string) => InteractionResponse

export const REJECT_REASON_MIN = 3
export const REJECT_REASON_MAX = 500

function cardOf(i: Interaction): CardRef | undefined {
  const messageId = i.message?.id
  const channelId = i.message?.channel_id ?? i.channel_id
  return messageId && channelId ? { channelId, messageId } : undefined
}

/** The shared checks. Returns the target, or the refusal to send. */
async function check(
  i: Interaction,
  userId: string,
  completionId: number,
  deps: MissionReviewDeps,
  refuse: Refuse,
): Promise<{ ok: true; target: ReviewTarget } | { ok: false; res: InteractionResponse }> {
  if (!deps.enabled()) {
    const where = deps.appUrl ? ` Review at [${deps.appUrl.replace(/^https?:\/\//, '')}/missions](<${deps.appUrl}/missions>).` : ''
    return { ok: false, res: refuse('Discord mission review is turned off.', where.trim() || undefined) }
  }
  const target = await deps.target(completionId)
  if (!target) return { ok: false, res: refuse('That submission no longer exists.') }
  if (!(await deps.canReview(i.member?.roles ?? [], target.level))) {
    const who = target.level >= 8 ? 'Only Dread Pizza Roberts reviews Level 8 missions.' : 'Mission reviewers are Leonardo, Dread Pizza Roberts, Pizza Capo and Pepperoni Mafia.'
    return { ok: false, res: refuse(`You can't review Level ${target.level} missions.`, who) }
  }
  if (target.discordId === userId) return { ok: false, res: refuse("You can't review your own submission.") }
  if (target.status !== 'PENDING') {
    deps.refresh?.(completionId, cardOf(i))
    return { ok: false, res: refuse('Already handled.', handledText(target)) }
  }
  return { ok: true, target }
}

function job(i: Interaction, userId: string, completionId: number, action: ReviewDecisionJob['action'], reason?: string): ReviewDecisionJob | null {
  if (!i.application_id || !i.token) return null
  return { action, completionId, reviewerId: userId, reason, applicationId: i.application_id, token: i.token, card: cardOf(i) }
}

/** A click on a review card button. */
export async function handleReviewButton(i: Interaction, userId: string, deps: MissionReviewDeps, refuse: Refuse): Promise<InteractionResponse> {
  const m = REVIEW_BUTTON_ID.exec(i.data?.custom_id ?? '')
  if (!m) return refuse('Unknown button.')
  const action = m[1] as ReviewDecisionJob['action']
  const completionId = Number(m[2])
  const c = await check(i, userId, completionId, deps, refuse)
  if (!c.ok) return c.res

  if (action === 'reject') {
    return {
      type: ResponseType.MODAL,
      data: {
        custom_id: rejectModalId(completionId),
        title: 'Reject this submission',
        components: [
          {
            type: 1,
            components: [
              {
                type: 4, // text input
                custom_id: REJECT_REASON_INPUT,
                style: 2, // paragraph
                label: 'Reason (the member sees this)',
                min_length: REJECT_REASON_MIN,
                max_length: REJECT_REASON_MAX,
                required: true,
                placeholder: 'e.g. The link is not your post.',
              },
            ],
          },
        ],
      },
    }
  }

  if (action === 'approve' && c.target.noteRequired) {
    return {
      type: ResponseType.MODAL,
      data: {
        custom_id: approveModalId(completionId),
        title: 'Approve: who did they invite?',
        components: [
          {
            type: 1,
            components: [
              {
                type: 4,
                custom_id: APPROVE_NOTE_INPUT,
                style: 2,
                label: 'Note (who they invited, how you checked)',
                min_length: REJECT_REASON_MIN,
                max_length: REJECT_REASON_MAX,
                required: true,
                placeholder: 'e.g. Invited @friend in March; confirmed on the community call.',
              },
            ],
          },
        ],
      },
    }
  }

  const j = job(i, userId, completionId, action)
  if (!j) return refuse('Could not record that. Please try again.')
  deps.decide(j)
  return { type: ResponseType.DEFERRED_UPDATE_MESSAGE }
}

/** The submitted Reject modal, or the Approve-with-a-note modal. */
export async function handleReviewModal(i: Interaction, userId: string, deps: MissionReviewDeps, refuse: Refuse): Promise<InteractionResponse> {
  if (i.type !== InteractionType.MODAL_SUBMIT) return refuse('Unsupported interaction.')
  const a = APPROVE_MODAL_ID.exec(i.data?.custom_id ?? '')
  if (a) {
    const completionId = Number(a[1])
    const note = modalValue(i, APPROVE_NOTE_INPUT).trim()
    if (note.length < REJECT_REASON_MIN) return refuse(`Write a note of at least ${REJECT_REASON_MIN} characters.`)
    const c = await check(i, userId, completionId, deps, refuse)
    if (!c.ok) return c.res
    const j = job(i, userId, completionId, 'approve', note.slice(0, REJECT_REASON_MAX))
    if (!j) return refuse('Could not record that. Please try again.')
    deps.decide(j)
    return { type: ResponseType.DEFERRED_UPDATE_MESSAGE }
  }
  const m = REJECT_MODAL_ID.exec(i.data?.custom_id ?? '')
  if (!m) return refuse('Unknown form.')
  const completionId = Number(m[1])
  const reason = modalValue(i, REJECT_REASON_INPUT).trim()
  if (reason.length < REJECT_REASON_MIN) return refuse(`Give a reason of at least ${REJECT_REASON_MIN} characters.`)
  const c = await check(i, userId, completionId, deps, refuse)
  if (!c.ok) return c.res
  const j = job(i, userId, completionId, 'reject', reason.slice(0, REJECT_REASON_MAX))
  if (!j) return refuse('Could not record that. Please try again.')
  deps.decide(j)
  return { type: ResponseType.DEFERRED_UPDATE_MESSAGE }
}

function modalValue(i: Interaction, customId: string): string {
  for (const row of i.data?.components ?? []) {
    for (const c of row.components ?? []) if (c.custom_id === customId && typeof c.value === 'string') return c.value
  }
  return ''
}
