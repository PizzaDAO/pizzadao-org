/**
 * Pure helpers shared by the review cards (./review-cards.ts), the decision
 * runner (./review-decision.ts) and the interaction handler
 * (../discord-interactions/mission-review.ts). No DB or network imports, so
 * the interaction handler stays importable in unit tests.
 */

export type ReviewButton = 'approve' | 'release' | 'reject'

export const REVIEW_BUTTON_ID = /^mr:(approve|release|reject):(\d{1,10})$/
export const REJECT_MODAL_ID = /^mr:reject-modal:(\d{1,10})$/
export const REJECT_REASON_INPUT = 'reason'

export const reviewButtonId = (action: ReviewButton, completionId: number) => `mr:${action}:${completionId}`
export const rejectModalId = (completionId: number) => `mr:reject-modal:${completionId}`

/** A review card message. */
export interface CardRef {
  channelId: string
  messageId: string
}

/**
 * Fields that start a new human review round on a row going (back) to
 * PENDING (a resubmission, a reopen): the old Discord card stays as the record
 * of the last decision and a new one is posted; the 48 h SLA clock restarts.
 */
export const NEW_REVIEW_ROUND = () => ({
  reviewQueuedAt: new Date(),
  reviewMsgId: null,
  reviewChannelId: null,
  reviewCardAt: null,
  slaNotifiedAt: null,
})

export interface HandledState {
  status: string
  reviewedBy: string | null
  reviewedAt: Date | null
}

/** "This submission was already approved by <@x> 2 minutes ago." */
export function handledText(h: HandledState | null): string {
  if (!h || h.status === 'PENDING') return 'Someone else is reviewing this submission.'
  const verb = h.status === 'APPROVED' ? 'approved' : 'rejected'
  const who = !h.reviewedBy || h.reviewedBy.startsWith('auto') ? 'automatically' : `by <@${h.reviewedBy}>`
  const when = h.reviewedAt ? ` <t:${Math.floor(h.reviewedAt.getTime() / 1000)}:R>` : ''
  return `This submission was already ${verb} ${who}${when}.`
}
