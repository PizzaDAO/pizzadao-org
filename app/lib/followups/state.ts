/**
 * Follow-up state machine. One table of allowed moves; every status change in the app goes
 * through canTransition() and a guarded database update (so two writers cannot both win).
 */
import type { FollowUpStatus } from '@prisma/client'

const MEMBER_STATES: FollowUpStatus[] = ['REPLIED', 'IN_PROGRESS', 'NEEDS_HELP', 'DONE']

export const TRANSITIONS: Record<FollowUpStatus, readonly FollowUpStatus[]> = {
  DRAFT: ['APPROVED', 'DISMISSED'],
  // DRAFT: an approval that went stale goes back to needing a new approval.
  APPROVED: ['SENT', 'FAILED', 'UNREACHABLE', 'ESCALATED', 'DISMISSED', 'DRAFT'],
  FAILED: ['APPROVED', 'UNREACHABLE', 'ESCALATED', 'DISMISSED'],
  UNREACHABLE: ['ESCALATED', 'FAILED', 'APPROVED', 'DISMISSED'],
  ESCALATED: ['DISMISSED'],
  SENT: [...MEMBER_STATES, 'DISMISSED'],
  REPLIED: [...MEMBER_STATES, 'DISMISSED'],
  IN_PROGRESS: [...MEMBER_STATES, 'DISMISSED'],
  NEEDS_HELP: [...MEMBER_STATES, 'DISMISSED'],
  DONE: [],
  DISMISSED: [],
}

export function canTransition(from: FollowUpStatus, to: FollowUpStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** Statuses where the person was messaged and may still answer (buttons, replies). */
export const OPEN_AFTER_SEND: readonly FollowUpStatus[] = ['SENT', 'REPLIED', 'IN_PROGRESS', 'NEEDS_HELP']

/** Statuses a reviewer may still edit. */
export const EDITABLE: readonly FollowUpStatus[] = ['DRAFT', 'FAILED', 'UNREACHABLE']
