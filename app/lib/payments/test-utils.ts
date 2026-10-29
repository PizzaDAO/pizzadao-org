/** Test helpers for the payments modules (not imported by app code). */
import type { PaymentPolicy } from './policy'
import type { PaymentActor } from './access'
import type { RequestSnapshot } from './decide'

export const policy = (over: Partial<PaymentPolicy> = {}): PaymentPolicy => ({
  onApprovalCapUsd: 625,
  fastTrackMaxUsd: 625,
  fastTrackMinPaidRequests: 2,
  fastTrackMinAccountDays: 45,
  fastTrackMinLevel: 4,
  fastTrackRiskMax: 10,
  highRiskScore: 50,
  highRiskApprovals: 2,
  fastTrackSlaHours: 24,
  slaHours: 72,
  receiptDeadlineDays: 14,
  voteAyesLow: 15,
  voteAyesMid: 25,
  voteAyesHigh: 35,
  voteMidMaxUsd: 2500,
  fastTrackEnabled: false,
  formIngestEnabled: false,
  requestFormEnabled: false,
  receiptUploadEnabled: false,
  aiChecksEnabled: false,
  aiDailyCap: 50,
  degraded: false,
  ...over,
})

export const actor = (id: string, over: Partial<PaymentActor> = {}): PaymentActor => ({
  discordId: id,
  isDpr: false,
  canReview: true,
  canMarkPaid: false,
  ...over,
})

export const DPR = (id = '900000000000000001'): PaymentActor => actor(id, { isDpr: true, canMarkPaid: true })

export const snapshot = (over: Partial<RequestSnapshot> = {}): RequestSnapshot => ({
  id: 'req1',
  status: 'RECEIVED',
  lane: 'STANDARD',
  riskScore: 0,
  flags: [],
  approvalsNeeded: 1,
  requesterDiscordId: '100000000000000001',
  linkedDiscordIds: [],
  claimedDiscordId: null,
  checkedAt: new Date('2026-11-02T00:00:00Z'),
  checkMarker: { attachments: '0:', approvals: 0 },
  currentMarker: { attachments: '0:', approvals: 0 },
  payeeHash: null,
  proposalUrl: null,
  amountUsdCents: 20000,
  updatedAt: new Date('2026-11-01T00:00:00Z'),
  ...over,
})
