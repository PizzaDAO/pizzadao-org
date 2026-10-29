/**
 * Rule flags (plans/host-fast-track.md section 5.1). Pure: the context is loaded separately
 * (checks.ts), so every flag is testable without a database.
 *
 * A flag is help for a person to decide; no flag ever approves, rejects or clears anything. The
 * score is the sum of severity weights (high 50, medium 20, low 5), capped at 100. Hard-block flags
 * send the request to HIGH_RISK whatever the score.
 */
import type { PaymentPolicy } from './policy'
import { SEVERITY_WEIGHT, type PaymentFlag, type PaymentKind } from './types'

export const RULES_VERSION = 'rules-2026-11-c'

const DAY = 86_400_000

export interface RuleContext {
  now: Date
  policy: PaymentPolicy
  newAccountDays: number
  req: {
    source: 'FORM' | 'APP' | 'REVIEWER'
    kind: PaymentKind
    amountUsdCents: number
    currency: string
    eventDate: Date | null
    createdAt: Date
    rsvEventSlug: string | null
    title: string
    proposalUrl: string | null
    /** Proposals are on: the legacy poll link is ignored and a passed in-app proposal is required above the cap. */
    proposalsOn?: boolean
    /** The in-app proposal linked to the request (proposals on only). */
    proposal?: { status: string; amountUsdCents: number | null } | null
    requesterDiscordId: string | null
    requesterMemberId: string | null
  }
  attachments: Array<{ kind: string; createdAt: Date }>
  /** An attachment's sha256 is already on another request. */
  reusedAttachment: boolean
  /** The same payee hash is used by a different requester (verified rows only, for a verified request). */
  sharedPayee: boolean
  /** A verified request's payee also appears on a public-form row: a hint, never a block. */
  sharedPayeeFormRow: boolean
  /** A form row's payee matches earlier form rows with the same claimed id: a hint, never a block. */
  repeatFormPayee: boolean
  /** The (verified) requester, or a linked account, has a request rejected as fraud. */
  priorFraud: boolean
  /** A form row's CLAIMED id belongs to someone with a fraud rejection: a hint, never a block. */
  claimedFraudHint: boolean
  /** Disavow-list entries that match the requester (ids only; shown to the top role). */
  restrictedMatches: string[]
  /** The disavow lookup failed: the result is unknown. */
  restrictedCheckFailed: boolean
  /** The restricted list is switched off, so nothing was checked. */
  restrictedCheckOff: boolean
  /** PAYMENTS_HASH_SECRET is set, so payees can be fingerprinted and compared. */
  hashConfigured: boolean
  /** rsv.pizza reports this host as flagged (no detail crosses the boundary). */
  rsvFlagged: boolean
  /** The requester's discord account is younger than newAccountDays (null = unknown). */
  newAccount: boolean | null
  /** The same requester's other requests in the last 30 days. */
  siblings: Array<{ amountUsdCents: number; createdAt: Date }>
}

const GPP_TITLE = /global\s+pizza\s+part(y|ies)|\bgpp\b/i

export function computeRuleFlags(c: RuleContext): PaymentFlag[] {
  const flags: PaymentFlag[] = []
  const add = (f: Omit<PaymentFlag, 'source'>) => flags.push({ ...f, source: 'rules' })
  const usd = c.req.amountUsdCents / 100
  const cap = c.policy.onApprovalCapUsd

  if (c.reusedAttachment) add({ id: 'reused_attachment', severity: 'high', hardBlock: true, detail: 'A file attached here was already used on another request.' })
  if (c.sharedPayee) add({ id: 'shared_payee', severity: 'high', hardBlock: true, detail: 'The same payee reference is used on another request from someone else, or from a form that cannot be tied to this requester.' })
  if (c.sharedPayeeFormRow && !c.sharedPayee) add({ id: 'shared_payee_form_row', severity: 'medium', detail: 'The same payee reference also appears on a public-form request. Form rows are unverified, so this is a hint to look into, not a block.' })
  if (c.repeatFormPayee && !c.sharedPayee) add({ id: 'repeat_form_payee', severity: 'medium', detail: 'Same payee as earlier form rows from the same claimed Discord id. Both are unverified, so this is a hint to look into, not a block.' })
  if (c.priorFraud) add({ id: 'prior_fraud', severity: 'high', hardBlock: true, detail: 'The requester, or a linked account, has a request rejected as fraud.' })
  if (c.claimedFraudHint) add({ id: 'claimed_id_history', severity: 'medium', detail: 'The Discord id typed into this form belongs to someone with a fraud rejection. It is only a claim, so this is a hint to look into, not a block.' })
  if (c.restrictedMatches.length > 0) {
    add({ id: 'restricted_list', severity: 'high', hardBlock: true, restricted: true, detail: `Matches a restricted-list entry (${c.restrictedMatches.slice(0, 3).join(', ')}).` })
  } else if (c.restrictedCheckFailed) {
    add({ id: 'restricted_check_failed', severity: 'medium', detail: 'The restricted-list check could not run. Re-check before approving.' })
  }
  if (c.restrictedCheckOff) add({ id: 'restricted_check_off', severity: 'info', detail: 'The restricted-list check is switched off, so nobody was checked against it.' })
  if (!c.hashConfigured) add({ id: 'payee_check_off', severity: 'info', detail: 'Payee fingerprints are off (no hash secret is set), so reuse of one payee by several people is not checked.' })
  if (c.rsvFlagged) add({ id: 'rsv_flagged', severity: 'high', detail: 'The party platform lists this host as flagged.' })
  if (c.req.proposalsOn) {
    // Proposals on: a Sesh link or typed count counts for nothing. Above the cap the request needs a PASSED in-app proposal,
    // and it may not ask for more than that proposal did.
    const p = c.req.proposal
    const passed = p?.status === 'PASSED'
    if (usd > cap && !passed) add({ id: 'over_cap_no_vote', severity: 'high', detail: 'Above the on-approval cap without a passed in-app proposal linked to the request.' })
    if (passed && p?.amountUsdCents != null && c.req.amountUsdCents > p.amountUsdCents) {
      add({ id: 'amount_over_proposal', severity: 'high', detail: 'The request asks for more than the linked proposal that passed.' })
    }
  } else if (usd > cap && !c.req.proposalUrl) {
    add({ id: 'over_cap_no_vote', severity: 'high', detail: 'Above the on-approval cap with no community proposal link.' })
  }

  const monthAgo = c.now.getTime() - 30 * DAY
  const recent = c.siblings.filter((s) => s.createdAt.getTime() >= monthAgo)
  if (usd <= cap && recent.length > 0 && recent.every((s) => s.amountUsdCents / 100 <= cap)) {
    const total = recent.reduce((n, s) => n + s.amountUsdCents / 100, usd)
    if (total > cap) add({ id: 'split_request', severity: 'medium', detail: `Requests in the last 30 days add up to $${Math.round(total)}, above the cap, while each is under it.` })
  }
  const twoWeeksAgo = c.now.getTime() - 14 * DAY
  const dup = recent.find((s) => s.createdAt.getTime() >= twoWeeksAgo && Math.abs(s.amountUsdCents - c.req.amountUsdCents) <= c.req.amountUsdCents * 0.05)
  if (dup) add({ id: 'duplicate_request', severity: 'medium', detail: 'The same requester sent a request for about the same amount in the last 14 days.' })

  if (c.req.source === 'FORM') add({ id: 'unverified_requester', severity: 'medium', detail: 'This came from a public form. Who sent it is not verified; the Discord id on it is only a claim.' })
  if (!c.req.requesterDiscordId && !c.req.requesterMemberId) add({ id: 'unmatched_requester', severity: 'medium', detail: 'Could not match the requester to a member or Discord account.' })
  if (c.newAccount === true) add({ id: 'new_account', severity: 'medium', detail: `Discord account is younger than ${c.newAccountDays} days.` })
  if (c.req.currency !== 'USD') add({ id: 'currency_unverified', severity: 'medium', detail: `Amount is in ${c.req.currency}. No dollar value was guessed: enter it before approving.` })
  if (c.req.kind === 'REIMBURSEMENT' && c.req.eventDate && c.req.createdAt.getTime() < c.req.eventDate.getTime()) {
    add({ id: 'reimburse_before_event', severity: 'medium', detail: 'A reimbursement was asked for before the event date.' })
  }
  const receipts = c.attachments.filter((a) => a.kind === 'RECEIPT')
  if ((c.req.kind === 'REIMBURSEMENT' || c.req.kind === 'WORK') && receipts.length === 0) {
    add({ id: 'no_receipts', severity: 'medium', detail: 'No receipt is attached.' })
  }
  if (c.req.eventDate) {
    const deadline = c.req.eventDate.getTime() + c.policy.receiptDeadlineDays * DAY
    if (receipts.some((a) => a.createdAt.getTime() > deadline)) add({ id: 'late_receipts', severity: 'low', detail: `Receipts were uploaded more than ${c.policy.receiptDeadlineDays} days after the event.` })
  }
  if (c.req.rsvEventSlug || GPP_TITLE.test(c.req.title)) {
    add({ id: 'gpp_event', severity: 'info', detail: 'Looks like a party event. Handle it on the party platform so it is not paid twice.' })
  }
  return flags
}

export function scoreFlags(flags: readonly PaymentFlag[]): number {
  return Math.min(100, flags.reduce((n, f) => n + SEVERITY_WEIGHT[f.severity], 0))
}
