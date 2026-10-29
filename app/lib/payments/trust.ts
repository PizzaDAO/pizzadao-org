/**
 * Fast-track eligibility (plans/host-fast-track.md section 4). Pure; inputs are loaded separately
 * (trust-load.ts).
 *
 * A requester is eligible when ALL hold:
 *  - history: the party platform says Fast Pass, OR enough in-app requests were paid with a proof
 *    reference (and none was rejected for fraud in the last 12 months);
 *  - the Discord account is old enough and the member level is high enough;
 *  - no blocker: an open high flag on another of their requests, or a flagged party-platform tier;
 *  - the fast lane is switched on and the settings were readable.
 * The amount ceiling and the per-request risk limits are applied by the lane rules, not here.
 *
 * The host-facing view never shows blockers: a flagged host sees the same "building" card as anyone
 * who has not qualified yet.
 */
import type { PaymentPolicy } from './policy'
import type { RsvTrack } from './rsv-track'

const DAY = 86_400_000

export interface TrustInput {
  now: Date
  /** null = the party platform was not asked, not configured, or failed. */
  rsv: RsvTrack | null
  paidWithProof: number
  fraudRejectedLast12Months: boolean
  accountCreatedAt: Date | null
  level: number
  openHighFlagElsewhere: boolean
}

export type MissingItem = 'history' | 'account_age' | 'level'

export interface TrustResult {
  eligible: boolean
  missing: MissingItem[]
  /** True if anything other than a missing item stops the fast lane (never shown to the requester). */
  blocked: boolean
  rsvFastPass: boolean
}

export function evaluateTrust(i: TrustInput, policy: PaymentPolicy): TrustResult {
  const rsvFastPass = i.rsv?.eligibleForFastPass === true
  const rsvFlagged = i.rsv?.tier === 'flagged'
  const paidRule = i.paidWithProof >= policy.fastTrackMinPaidRequests && !i.fraudRejectedLast12Months
  const missing: MissingItem[] = []
  if (!rsvFastPass && !paidRule) missing.push('history')
  const age = i.accountCreatedAt ? (i.now.getTime() - i.accountCreatedAt.getTime()) / DAY : -1
  if (age < policy.fastTrackMinAccountDays) missing.push('account_age')
  if (i.level < policy.fastTrackMinLevel) missing.push('level')
  const blocked = rsvFlagged || i.openHighFlagElsewhere || i.fraudRejectedLast12Months || !policy.fastTrackEnabled || policy.degraded
  return { eligible: missing.length === 0 && !blocked, missing, blocked, rsvFastPass }
}

export interface HostView {
  state: 'ready' | 'building'
  paid: number
  needed: number
  missing: MissingItem[]
}

/** What the requester may see. Blockers and flags never appear: they just read as "building". */
export function toHostView(t: TrustResult, i: Pick<TrustInput, 'paidWithProof'>, policy: PaymentPolicy): HostView {
  return {
    state: t.eligible ? 'ready' : 'building',
    paid: Math.min(i.paidWithProof, policy.fastTrackMinPaidRequests),
    needed: policy.fastTrackMinPaidRequests,
    missing: t.missing,
  }
}
