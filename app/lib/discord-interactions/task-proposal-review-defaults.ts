/**
 * The real dependencies of the task proposal card buttons (./task-proposal-review.ts): the card view, the
 * call reviewer role, the website's apply / dismiss (call-tasks/apply.ts) and the interaction webhook.
 * Kept apart so the pure handler imports nothing heavy.
 */
import { callReviewRole } from '@/app/lib/calls/review-role'
import { applyProposal, dismissProposal, type DecideAuthorizer } from '@/app/lib/call-tasks/apply'
import { loadProposalCardView, proposalCardState, proposalCardsEnabled, proposalReviewUrl, syncTaskProposalCard, defaultProposalCardDeps } from '@/app/lib/call-tasks/cards'
import { editOriginalReply } from './call-review-defaults'
import type { ProposalReviewDeps, ProposalReviewRunDeps, ProposalReviewTarget } from './task-proposal-review'

/**
 * The handler has already checked the clicker's call reviewer role from the interaction payload, so the
 * crew-lead check of the website (canManageCrew) is replaced by that one for Discord decisions.
 */
const reviewerChecked: DecideAuthorizer = async () => true

export async function loadProposalReviewTarget(id: string, appUrl: string): Promise<ProposalReviewTarget | null> {
  // Lean: no transcript read and no full crew-registry reload inside Discord's 3 s window.
  const v = await loadProposalCardView(id, { lean: true })
  if (!v) return null
  return { id: v.id, kind: v.kind, status: v.status, state: proposalCardState(v), url: proposalReviewUrl(v, appUrl) }
}

export function taskProposalHandlerDeps(appUrl: string, run: ProposalReviewDeps['run'], refresh: NonNullable<ProposalReviewDeps['refresh']>): ProposalReviewDeps {
  return {
    enabled: () => proposalCardsEnabled(),
    roleFor: (roles) => callReviewRole(roles),
    target: (id) => loadProposalReviewTarget(id, appUrl),
    run,
    refresh,
  }
}

export function taskProposalRunDeps(): ProposalReviewRunDeps {
  return {
    apply: (id, actor, confirmed) => applyProposal(id, actor, { confirmed, authorize: reviewerChecked }),
    dismiss: (id, actor) => dismissProposal(id, actor, new Date(), { authorize: reviewerChecked }),
    syncCard: (id) => syncTaskProposalCard(id, defaultProposalCardDeps, { editOnly: true }),
    edit: editOriginalReply,
  }
}
