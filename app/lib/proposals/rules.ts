/**
 * The proposal rules in force: the proposals.* settings plus the payments tiers (one source of truth
 * for the 15/25/35 ayes and the amount limits). A proposal copies what it needs onto itself when it
 * opens (ayesNeeded, closesAt), so a later setting change never moves a running vote.
 */
import { requiredAyes } from '../payments/lane'
import { loadPaymentPolicy, type PaymentPolicy } from '../payments/policy'
import { loadSettings } from '../settings'

export interface ProposalRules {
  windowDays: number
  generalAyes: number
  policy: PaymentPolicy
}

/** Never throws: unreadable settings give the strictest values (longest window, highest threshold). */
export async function loadProposalRules(): Promise<ProposalRules> {
  const policy = await loadPaymentPolicy()
  try {
    const s = await loadSettings()
    return { windowDays: s.get('proposals.windowDays'), generalAyes: s.get('proposals.generalAyes'), policy }
  } catch {
    return { windowDays: 14, generalAyes: 200, policy }
  }
}

/** Ayes (plus abstains) a proposal needs, from its kind and amount. */
export function ayesNeededFor(kind: 'FUNDING' | 'GENERAL', amountUsdCents: number | null, rules: ProposalRules): number {
  if (kind === 'GENERAL' || amountUsdCents == null) return rules.generalAyes
  return requiredAyes(amountUsdCents / 100, rules.policy)
}
