/** Risk signals for a check-in. Any flag holds the check-in for a reviewer; none rejects on its own. */
import { haversineM, type LatLng } from './geo'

export type RiskFlag = 'velocity' | 'new_account' | 'zero_accuracy' | 'round_coords' | 'no_geo'

const KM_SLACK = 50

/** True when `to` is farther from `from` than `maxKmPerHour` over the elapsed time (plus 50 km slack) allows. */
export function isImpossibleTravel(
  from: LatLng & { at: Date },
  to: LatLng & { at: Date },
  maxKmPerHour: number,
): boolean {
  const hours = Math.max(0, (to.at.getTime() - from.at.getTime()) / 3_600_000)
  const km = haversineM(from, to) / 1000
  return km > hours * maxKmPerHour + KM_SLACK
}

/** Spoofing tools often report exactly 0 m accuracy. */
export function isZeroAccuracy(accuracyM: number): boolean {
  return accuracyM === 0
}

/** Coordinates with 3 or fewer decimals (about 100 m) on both axes are typical of hand-typed fake locations. */
export function hasRoundCoords(p: LatLng): boolean {
  const dec = (n: number) => {
    const s = String(n)
    const i = s.indexOf('.')
    return i < 0 ? 0 : s.length - i - 1
  }
  return dec(p.lat) <= 3 && dec(p.lng) <= 3
}
