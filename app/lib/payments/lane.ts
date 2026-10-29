/**
 * Which lane a request lands in (plans/host-fast-track.md section 2). Pure.
 *
 * The lane only decides how many approvals are needed, who may give them, the queue order and the
 * target review time. It never approves anything.
 *
 *   VOTE_REQUIRED  amount above the on-approval cap (a passed community poll is needed)
 *   HIGH_RISK      risk score at or above the high-risk score, or any hard-block flag
 *   FAST           eligible requester, small amount, low risk, no high flag, fast lane switched on
 *   STANDARD       everything else
 *
 * The risk score passed in must be computed from rule flags only (checks.ts does): AI flags never feed
 * `isHighRisk`, so AI alone can remove FAST but can never force HIGH_RISK.
 *
 * Fail-safe: a degraded policy (settings unreadable) can never produce FAST.
 */
import type { PaymentPolicy } from './policy'
import type { PaymentFlag, PaymentLane } from './types'

export interface LaneInput {
  amountUsd: number
  riskScore: number
  flags: readonly PaymentFlag[]
  /** From trust.ts. False when unknown. */
  fastEligible: boolean
}

/** True when the request needs the top review role plus extra approvals. */
export function isHighRisk(riskScore: number, flags: readonly PaymentFlag[], policy: PaymentPolicy): boolean {
  return riskScore >= policy.highRiskScore || flags.some((f) => f.hardBlock)
}

export function chooseLane(i: LaneInput, policy: PaymentPolicy): { lane: PaymentLane; approvalsNeeded: number } {
  const risky = isHighRisk(i.riskScore, i.flags, policy)
  const approvalsNeeded = risky ? policy.highRiskApprovals : 1
  if (i.amountUsd > policy.onApprovalCapUsd) return { lane: 'VOTE_REQUIRED', approvalsNeeded }
  if (risky) return { lane: 'HIGH_RISK', approvalsNeeded }
  const fast =
    i.fastEligible &&
    policy.fastTrackEnabled &&
    !policy.degraded &&
    i.amountUsd <= policy.fastTrackMaxUsd &&
    i.riskScore <= policy.fastTrackRiskMax &&
    !i.flags.some((f) => f.severity === 'high') &&
    // Any AI flag removes the fast lane. AI can only ever make a request SLOWER, never faster or riskier.
    !i.flags.some((f) => f.source === 'ai')
  return { lane: fast ? 'FAST' : 'STANDARD', approvalsNeeded }
}

/** Ayes the community poll needs for `amountUsd` (display and reviewer checklist only; the poll is external). */
export function requiredAyes(amountUsd: number, policy: PaymentPolicy): number {
  if (amountUsd <= policy.onApprovalCapUsd) return policy.voteAyesLow
  return amountUsd <= policy.voteMidMaxUsd ? policy.voteAyesMid : policy.voteAyesHigh
}

/** Target review time for a lane. */
export function slaHoursFor(lane: PaymentLane, policy: PaymentPolicy): number {
  return lane === 'FAST' ? policy.fastTrackSlaHours : policy.slaHours
}

/** Queue order: FAST first, then older requests first within a lane group. */
export const LANE_ORDER: Record<PaymentLane, number> = { FAST: 0, STANDARD: 1, VOTE_REQUIRED: 2, HIGH_RISK: 3 }
