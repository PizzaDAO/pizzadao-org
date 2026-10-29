/**
 * The check-in decision table (pure; no I/O). Phase 1: partner pizzerias only, and a valid table QR
 * is required. Geo is checked on top: close enough and accurate enough, or the check-in is refused;
 * no location at all with a valid QR is held for a reviewer.
 *
 * Outcomes:
 *   APPROVED  stamp (or another visit) recorded now
 *   PENDING   recorded but held; a reviewer releases or rejects it
 *   REJECTED  recorded as rejected, nothing granted
 */
import { haversineM, isValidLatLng, type LatLng } from './geo'
import { hasRoundCoords, isImpossibleTravel, isZeroAccuracy, type RiskFlag } from './abuse'

export type Decision = 'APPROVED' | 'PENDING' | 'REJECTED'
export type Method = 'QR' | 'QR_NO_GEO'

export type RejectReason =
  | 'not_allowed'
  | 'not_eligible'
  | 'bad_qr'
  | 'bad_location'
  | 'low_accuracy'
  | 'too_far'
  | 'daily_limit'

export interface DecisionInput {
  /** The member is on the disavow list (or the lookup failed: the caller fails closed). */
  disallowed: boolean
  pizzeria: { isPartner: boolean; isChain: boolean; status: string; lat: number; lng: number }
  qrValid: boolean
  /** What the browser reported, or null when the member denied or skipped location. */
  client: { lat: unknown; lng: unknown; accuracy: unknown } | null
  config: { radiusM: number; maxAccuracyM: number; maxNewStampsPerDay: number; revisitCooldownHours: number; maxTravelKmPerHour: number }
  newAccount: boolean
  /** The member's previous located check-in (inside the 30-day coordinate window), if any. */
  previous: (LatLng & { at: Date }) | null
  /** Existing stamp for this (member, pizzeria): when the last visit counted. */
  existing: { lastVisitAt: Date } | null
  newStampsLast24h: number
  now: Date
}

export interface DecisionResult {
  decision: Decision
  method: Method
  reason?: RejectReason
  riskFlags: RiskFlag[]
  distanceM: number | null
  accuracyM: number | null
  /** APPROVED only: a first stamp. */
  newStamp: boolean
  /** APPROVED only: counts as another visit (false inside the cooldown). */
  countsAsVisit: boolean
  /** The location to keep for review (30 days), or null. */
  located: LatLng | null
}

function reject(base: Omit<DecisionResult, 'decision' | 'newStamp' | 'countsAsVisit'>, reason: RejectReason): DecisionResult {
  return { ...base, decision: 'REJECTED', reason, newStamp: false, countsAsVisit: false }
}

export function decideCheckIn(i: DecisionInput): DecisionResult {
  const riskFlags: RiskFlag[] = []
  const base = {
    method: 'QR' as Method,
    riskFlags,
    distanceM: null as number | null,
    accuracyM: null as number | null,
    located: null as LatLng | null,
  }

  if (i.disallowed) return reject(base, 'not_allowed')
  const p = i.pizzeria
  if (!p.isPartner || p.isChain || p.status !== 'ACTIVE') return reject(base, 'not_eligible')
  if (!i.qrValid) return reject(base, 'bad_qr')

  // Location: required for an automatic approval; absent with a valid QR means a reviewer decides.
  const hasLoc = !!i.client && i.client.lat != null && i.client.lng != null
  let located: LatLng | null = null
  if (hasLoc) {
    const c = i.client!
    if (!isValidLatLng({ lat: c.lat, lng: c.lng }) || typeof c.accuracy !== 'number' || !Number.isFinite(c.accuracy) || c.accuracy < 0) {
      return reject(base, 'bad_location')
    }
    located = { lat: c.lat as number, lng: c.lng as number }
    base.located = located
    base.accuracyM = Math.round(c.accuracy)
    if (c.accuracy > i.config.maxAccuracyM) return reject(base, 'low_accuracy')
    base.distanceM = Math.round(haversineM(located, { lat: p.lat, lng: p.lng }))
    if (base.distanceM > i.config.radiusM) return reject(base, 'too_far')
    if (isZeroAccuracy(c.accuracy)) riskFlags.push('zero_accuracy')
    if (hasRoundCoords(located)) riskFlags.push('round_coords')
    if (i.previous && isImpossibleTravel(i.previous, { ...located, at: i.now }, i.config.maxTravelKmPerHour)) {
      riskFlags.push('velocity')
    }
  } else {
    base.method = 'QR_NO_GEO'
    riskFlags.push('no_geo')
  }
  if (i.newAccount) riskFlags.push('new_account')

  const newStamp = !i.existing
  if (newStamp && i.newStampsLast24h >= i.config.maxNewStampsPerDay) return reject(base, 'daily_limit')

  if (riskFlags.length > 0) {
    return { ...base, decision: 'PENDING', riskFlags, newStamp: false, countsAsVisit: false }
  }

  const cooldownMs = i.config.revisitCooldownHours * 3_600_000
  const countsAsVisit = newStamp || i.now.getTime() - i.existing!.lastVisitAt.getTime() >= cooldownMs
  return { ...base, decision: 'APPROVED', newStamp, countsAsVisit }
}
