/**
 * The payment rules as numbers, resolved from the `payments.*` settings.
 *
 * Fail-safe: if the settings could not be read (database down, or any payments value failed its
 * schema) the fast lane is switched off and the numbers are the registry's strict failure values.
 * Cross-key rules run here so a bad pair of values can never loosen anything:
 * the fast-track maximum is never above the on-approval cap.
 */
import { loadSettings, type Settings } from '@/app/lib/settings'
import { SETTING_KEYS } from '@/app/lib/settings/registry'

export interface PaymentPolicy {
  onApprovalCapUsd: number
  fastTrackMaxUsd: number
  fastTrackMinPaidRequests: number
  fastTrackMinAccountDays: number
  fastTrackMinLevel: number
  fastTrackRiskMax: number
  highRiskScore: number
  highRiskApprovals: number
  fastTrackSlaHours: number
  slaHours: number
  receiptDeadlineDays: number
  voteAyesLow: number
  voteAyesMid: number
  voteAyesHigh: number
  voteMidMaxUsd: number
  fastTrackEnabled: boolean
  formIngestEnabled: boolean
  requestFormEnabled: boolean
  receiptUploadEnabled: boolean
  aiChecksEnabled: boolean
  aiDailyCap: number
  /** True when the settings could not be read cleanly: no fast lane, everything waits for a human. */
  degraded: boolean
}

export function resolvePaymentPolicy(s: Pick<Settings, 'get' | 'readFailed' | 'invalidKeys'>): PaymentPolicy {
  const paymentKeys = new Set<string>(SETTING_KEYS.filter((k) => k.startsWith('payments.')))
  const degraded = s.readFailed || s.invalidKeys.some((k) => paymentKeys.has(k))
  const cap = s.get('payments.onApprovalCapUsd')
  return {
    onApprovalCapUsd: cap,
    fastTrackMaxUsd: Math.min(s.get('payments.fastTrackMaxUsd'), cap),
    fastTrackMinPaidRequests: s.get('payments.fastTrackMinPaidRequests'),
    fastTrackMinAccountDays: s.get('payments.fastTrackMinAccountDays'),
    fastTrackMinLevel: s.get('payments.fastTrackMinLevel'),
    fastTrackRiskMax: s.get('payments.fastTrackRiskMax'),
    highRiskScore: s.get('payments.highRiskScore'),
    highRiskApprovals: s.get('payments.highRiskApprovals'),
    fastTrackSlaHours: s.get('payments.fastTrackSlaHours'),
    slaHours: s.get('payments.slaHours'),
    receiptDeadlineDays: s.get('payments.receiptDeadlineDays'),
    voteAyesLow: s.get('payments.voteAyesLow'),
    voteAyesMid: s.get('payments.voteAyesMid'),
    voteAyesHigh: s.get('payments.voteAyesHigh'),
    voteMidMaxUsd: s.get('payments.voteMidMaxUsd'),
    fastTrackEnabled: !degraded && s.get('payments.fastTrackEnabled') === 1,
    formIngestEnabled: !degraded && s.get('payments.formIngestEnabled') === 1,
    requestFormEnabled: !degraded && s.get('payments.requestFormEnabled') === 1,
    receiptUploadEnabled: !degraded && s.get('payments.receiptUploadEnabled') === 1,
    aiChecksEnabled: !degraded && s.get('payments.aiChecksEnabled') === 1,
    aiDailyCap: degraded ? 0 : s.get('payments.aiDailyCap'),
    degraded,
  }
}

/** Never throws: an unreadable setting store gives the strict, degraded policy. */
export async function loadPaymentPolicy(): Promise<PaymentPolicy> {
  try {
    return resolvePaymentPolicy(await loadSettings())
  } catch {
    // A key with a 'throw' failure mode would land here; the payments group has none, but fail closed anyway.
    return resolvePaymentPolicy({
      readFailed: true,
      invalidKeys: [],
      get: ((key: string) => {
        // Strictest values, matching the registry's failure values.
        const strict: Record<string, number> = {
          'payments.onApprovalCapUsd': 0, 'payments.fastTrackMaxUsd': 0, 'payments.fastTrackMinPaidRequests': 20,
          'payments.fastTrackMinAccountDays': 730, 'payments.fastTrackMinLevel': 9, 'payments.fastTrackRiskMax': 0,
          'payments.highRiskScore': 10, 'payments.highRiskApprovals': 3, 'payments.fastTrackSlaHours': 24,
          'payments.slaHours': 72, 'payments.receiptDeadlineDays': 14, 'payments.voteAyesLow': 15,
          'payments.voteAyesMid': 25, 'payments.voteAyesHigh': 35, 'payments.voteMidMaxUsd': 625,
        }
        return strict[key] ?? 0
      }) as Settings['get'],
    })
  }
}
