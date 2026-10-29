/**
 * Payment-request settings (plans/host-fast-track.md section 6). Kept in its own file so the
 * registry only carries one spread line for the whole `payments` group.
 *
 * Rules for this group:
 * - Approval / spend limits are stricter-only: the schema bound stops at the default, so the
 *   admin page can tighten but loosening needs a code change.
 * - Every toggle is an int 0/1 and ships OFF.
 * - If a value cannot be read, the failure value is the one that disables the fast lane (or turns
 *   the feature off), never the one that loosens a rule.
 * - Numbers and switches only. The one text value (the responses sheet id) is defined in registry.ts.
 *
 * This file imports only types from ./registry, so there is no runtime import cycle.
 */
import { z } from 'zod'
import type { FailureMode, SettingDef } from './registry'

const SHEET_ID = /^[A-Za-z0-9_-]{20,120}$/

/** A Google Sheets id: letters, digits, dash and underscore only. */
export function isValidSheetId(v: string): boolean {
  return SHEET_ID.test(v)
}

function pay(o: {
  key: `payments.${string}`
  label: string
  help: string
  min: number
  max: number
  default: number
  unit?: string
  onReadFailure?: FailureMode<number>
  stricterOnly?: boolean
  looserWhen?: 'higher' | 'lower'
}): SettingDef<number> {
  return {
    key: o.key,
    area: 'payments',
    label: o.label,
    help: o.help,
    schema: z.number().int().min(o.min).max(o.max),
    default: o.default,
    onReadFailure: o.onReadFailure ?? 'lastKnownGood',
    input: { type: 'int', min: o.min, max: o.max, ...(o.unit ? { unit: o.unit } : {}) },
    stricterOnly: o.stricterOnly,
    looserWhen: o.looserWhen,
  }
}

const toggle = (key: `payments.${string}`, label: string, help: string) =>
  pay({ key, label, help, min: 0, max: 1, default: 0, onReadFailure: { value: 0 } })

export const PAYMENT_SETTINGS = {
  'payments.onApprovalCapUsd': pay({
    key: 'payments.onApprovalCapUsd',
    label: 'On-approval cap (USD)',
    help: 'Requests above this amount need a passed community proposal. Can only be lowered here.',
    min: 0, max: 625, default: 625, unit: 'USD',
    onReadFailure: { value: 0 }, stricterOnly: true, looserWhen: 'higher',
  }),
  'payments.fastTrackMaxUsd': pay({
    key: 'payments.fastTrackMaxUsd',
    label: 'Fast track maximum (USD)',
    help: 'Largest request that can use the fast lane (never above the on-approval cap). Can only be lowered here.',
    min: 0, max: 625, default: 625, unit: 'USD',
    onReadFailure: { value: 0 }, stricterOnly: true, looserWhen: 'higher',
  }),
  'payments.fastTrackMinPaidRequests': pay({
    key: 'payments.fastTrackMinPaidRequests',
    label: 'Fast track: paid requests needed',
    help: 'Paid requests with proof before a member can use the fast lane without an outside track record. Can only be raised here.',
    min: 2, max: 20, default: 2,
    onReadFailure: { value: 20 }, stricterOnly: true, looserWhen: 'lower',
  }),
  'payments.fastTrackMinAccountDays': pay({
    key: 'payments.fastTrackMinAccountDays',
    label: 'Fast track: account age (days)',
    help: 'Minimum Discord account age for the fast lane. Can only be raised here.',
    min: 45, max: 730, default: 45, unit: 'days',
    onReadFailure: { value: 730 }, stricterOnly: true, looserWhen: 'lower',
  }),
  'payments.fastTrackMinLevel': pay({
    key: 'payments.fastTrackMinLevel',
    label: 'Fast track: minimum level',
    help: 'Minimum member level for the fast lane. Can only be raised here.',
    min: 4, max: 9, default: 4,
    onReadFailure: { value: 9 }, stricterOnly: true, looserWhen: 'lower',
  }),
  'payments.fastTrackRiskMax': pay({
    key: 'payments.fastTrackRiskMax',
    label: 'Fast track: highest risk score',
    help: 'A request scoring above this leaves the fast lane. Can only be lowered here.',
    min: 0, max: 10, default: 10,
    onReadFailure: { value: 0 }, stricterOnly: true, looserWhen: 'higher',
  }),
  'payments.highRiskScore': pay({
    key: 'payments.highRiskScore',
    label: 'High-risk score',
    help: 'A request scoring at or above this needs several approvals including the top review role. Can only be lowered here.',
    min: 10, max: 50, default: 50,
    onReadFailure: { value: 10 }, stricterOnly: true, looserWhen: 'higher',
  }),
  'payments.highRiskApprovals': pay({
    key: 'payments.highRiskApprovals',
    label: 'High-risk approvals needed',
    help: 'Distinct approvers for a high-risk request (one must be the top review role). Can only be raised here.',
    min: 2, max: 3, default: 2,
    onReadFailure: { value: 3 }, stricterOnly: true, looserWhen: 'lower',
  }),
  'payments.fastTrackSlaHours': pay({
    key: 'payments.fastTrackSlaHours', label: 'Fast lane review target (hours)',
    help: 'Target review time for fast-lane requests.', min: 1, max: 336, default: 24, unit: 'hours',
  }),
  'payments.slaHours': pay({
    key: 'payments.slaHours', label: 'Review target (hours)',
    help: 'Target review time for every other request.', min: 1, max: 336, default: 72, unit: 'hours',
  }),
  'payments.receiptDeadlineDays': pay({
    key: 'payments.receiptDeadlineDays', label: 'Receipt deadline (days)',
    help: 'Receipts uploaded later than this after the event raise a low flag.', min: 1, max: 60, default: 14, unit: 'days',
  }),
  'payments.voteAyesLow': pay({
    key: 'payments.voteAyesLow', label: 'Proposal ayes, first tier',
    help: 'Ayes for a proposal at or below the on-approval cap (shown for reference; no poll is required there). The poll itself is external. Can only be raised here.',
    min: 15, max: 200, default: 15, stricterOnly: true, looserWhen: 'lower',
  }),
  'payments.voteAyesMid': pay({
    key: 'payments.voteAyesMid', label: 'Proposal ayes, second tier',
    help: 'Ayes needed for a request above the on-approval cap, up to the second-tier limit. Can only be raised here.',
    min: 25, max: 200, default: 25, stricterOnly: true, looserWhen: 'lower',
  }),
  'payments.voteAyesHigh': pay({
    key: 'payments.voteAyesHigh', label: 'Proposal ayes, third tier',
    help: 'Ayes needed for a request above the second-tier limit. Can only be raised here.',
    min: 35, max: 200, default: 35, stricterOnly: true, looserWhen: 'lower',
  }),
  'payments.voteMidMaxUsd': pay({
    key: 'payments.voteMidMaxUsd', label: 'Proposal second-tier limit (USD)',
    help: 'Requests above this use the third (highest) aye count. Can only be lowered here.',
    min: 625, max: 2500, default: 2500, unit: 'USD',
    onReadFailure: { value: 625 }, stricterOnly: true, looserWhen: 'higher',
  }),
  'payments.fastTrackEnabled': toggle('payments.fastTrackEnabled', 'Fast lane on', '1 lets eligible requests use the fast lane. Off by default; when off every request is standard or higher.'),
  'payments.formIngestEnabled': toggle('payments.formIngestEnabled', 'Form ingest on', '1 reads new work-payment form responses into the queue every 15 minutes (needs the responses sheet id setting below).'),
  'payments.requestFormEnabled': toggle('payments.requestFormEnabled', 'Request form on', '1 opens the in-app payment request form to members.'),
  'payments.receiptUploadEnabled': toggle('payments.receiptUploadEnabled', 'Receipt upload on', '1 allows receipt and photo uploads. Needs a Blob store that supports private files; leave off until that is confirmed.'),
  'payments.aiChecksEnabled': toggle('payments.aiChecksEnabled', 'AI checks on', '1 lets reviewers run an AI check on a request. AI only adds flags; it never approves or rejects.'),
  'payments.aiDailyCap': pay({
    key: 'payments.aiDailyCap', label: 'AI checks per day', help: 'Most AI checks per day across all reviewers.',
    min: 0, max: 200, default: 50, onReadFailure: { value: 0 },
  }),
} as const satisfies Record<string, SettingDef<number>>
