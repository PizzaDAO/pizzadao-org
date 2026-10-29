/**
 * Shared payment-request types. Plain string unions mirror the Prisma enums so the pure logic
 * (lanes, rules, decisions) has no database dependency and is easy to test.
 */
export type PaymentStatus = 'RECEIVED' | 'NEEDS_INFO' | 'APPROVED' | 'REJECTED' | 'PAID' | 'WITHDRAWN'
export type PaymentLane = 'FAST' | 'STANDARD' | 'HIGH_RISK' | 'VOTE_REQUIRED'
export type PaymentKind = 'EVENT_BUDGET' | 'REIMBURSEMENT' | 'WORK' | 'OTHER'

export type FlagSeverity = 'high' | 'medium' | 'low' | 'info'
export type FlagSource = 'rules' | 'rsv' | 'ai'

export interface PaymentFlag {
  id: string
  severity: FlagSeverity
  /** Hard blocks send the request to HIGH_RISK whatever the score. */
  hardBlock?: boolean
  /** Short reason shown to reviewers. Never contains payee details. */
  detail: string
  source: FlagSource
  /** Shown to the top review role only; everyone else sees `detail` as "restricted". */
  restricted?: boolean
}

export const SEVERITY_WEIGHT: Record<FlagSeverity, number> = { high: 50, medium: 20, low: 5, info: 0 }

export type DecisionAction =
  | 'APPROVE'
  | 'REJECT'
  | 'REQUEST_INFO'
  | 'MARK_PAID'
  | 'REOPEN'
  | 'NOTE'
  | 'WITHDRAW'
  | 'REPLY'
  | 'SYSTEM_RESET'

export const REVIEW_ACTIONS: readonly DecisionAction[] = ['APPROVE', 'REJECT', 'REQUEST_INFO', 'MARK_PAID', 'REOPEN', 'NOTE']

export interface DecisionRow {
  id: number
  action: DecisionAction | string
  actorDiscordId: string
  actorIsDpr: boolean
  createdAt: Date
}

export const centsToUsd = (cents: number): number => cents / 100

/** True when `actorId` is the requester or one of the accounts counted as the requester. */
export function isSelf(actorId: string, requesterIds: readonly (string | null | undefined)[]): boolean {
  return actorId !== '' && requesterIds.some((id) => !!id && id === actorId)
}
