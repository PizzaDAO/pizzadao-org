/**
 * Fast-track and party-platform signals for one request. Whenever a source fails or is missing the
 * answer is the safe one: no fast lane, not flagged. The only positive outcomes are an explicit
 * eligible result (trust.ts) or a flagged tier from the party platform.
 */
import type { LoadedRequest } from './checks'
import type { PaymentPolicy } from './policy'
import { rsvConfig } from './rsv-track'
import { trustFor } from './trust-load'

export interface TrackSignals {
  /** The party platform reports this host as flagged. */
  rsvFlagged: boolean
  /** The requester qualifies for the fast lane. False when unknown. */
  fastEligible: boolean
  /** Extra check rows to store (for example the party-platform tier snapshot). */
  checks?: Array<{ kind: string; version: string; result: unknown }>
}

export const RSV_TRACK_VERSION = 'rsv-track-1'

export async function signalsFor(req: LoadedRequest, policy: PaymentPolicy): Promise<TrackSignals> {
  if (!req.requesterDiscordId) return { rsvFlagged: false, fastEligible: false }
  const { input, result } = await trustFor(req.requesterDiscordId, policy, { excludeRequestId: req.id })
  const checks: NonNullable<TrackSignals['checks']> = []
  if (rsvConfig()) {
    // Only the tier summary is stored; never identifiers.
    checks.push({
      kind: 'RSV_TRACK',
      version: RSV_TRACK_VERSION,
      result: input.rsv
        ? { available: true, tier: input.rsv.rawTier, eligibleForFastPass: input.rsv.eligibleForFastPass, verifiedParties: input.rsv.verifiedParties }
        : { available: false },
    })
  }
  return { rsvFlagged: input.rsv?.tier === 'flagged', fastEligible: result.eligible, checks }
}
