/**
 * Pure matching for nearby-event invites. No I/O: the run supplies the events, the members (with their
 * resolved city coordinates), their preferences and their send history.
 *
 * Invites are OPT-OUT: a member with no ReminderPref row is invited; only `nearbyEvents === false` excludes.
 */
import { haversineM } from '@/app/lib/passport/geo'
import { DAY_MS } from '@/app/lib/followups/quiet-hours'
import type { NearbyEvent } from './client'

export const WEEK_MS = 7 * DAY_MS
export const HOUR_MS = 3_600_000

export interface MatchConfig {
  defaultRadiusKm: number
  /** Extra reach when the event only has city-level coordinates. */
  citySlackKm: number
  minLeadHours: number
  maxLeadDays: number
  maxPerWeek: number
  maxPerDay: number
  /** Event kinds that may be invited (gpp, series). */
  kinds: readonly string[]
}

/** A member whose city resolved to a map city. Unplaced members never get an object like this. */
export interface MemberPlace {
  discordId: string
  lat: number
  lng: number
  cityName: string
}

export interface MemberPref {
  nearbyEvents: boolean
  radiusKm: number | null
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineM(a, b) / 1000
}

/** The radius that applies to this member and event. */
export function effectiveRadiusKm(pref: MemberPref | undefined, e: Pick<NearbyEvent, 'cityLevel'>, cfg: Pick<MatchConfig, 'defaultRadiusKm' | 'citySlackKm'>): number {
  return (pref?.radiusKm ?? cfg.defaultRadiusKm) + (e.cityLevel ? cfg.citySlackKm : 0)
}

/** Whether the event itself can be invited to right now (kind, open, lead window). */
export function eventInvitable(e: NearbyEvent, now: Date, cfg: MatchConfig): boolean {
  if (!cfg.kinds.includes(e.kind)) return false
  if (e.full || e.rsvpClosed) return false
  const lead = e.startsAt.getTime() - now.getTime()
  return lead >= cfg.minLeadHours * HOUR_MS && lead <= cfg.maxLeadDays * DAY_MS
}

export type Verdict = { ok: true; km: number } | { ok: false; why: 'opted_out' | 'far' }

/** Opt-out default plus distance, for one member and one (invitable) event. */
export function memberVerdict(m: MemberPlace, pref: MemberPref | undefined, e: NearbyEvent, cfg: MatchConfig): Verdict {
  if (pref && pref.nearbyEvents === false) return { ok: false, why: 'opted_out' }
  const km = distanceKm(m, e)
  return km <= effectiveRadiusKm(pref, e, cfg) ? { ok: true, km } : { ok: false, why: 'far' }
}

/**
 * Caps over this member's earlier nearby sends. Weekly is a rolling 7 days, daily a rolling 24 hours.
 * `sentAt` must include sends already decided earlier in the same run.
 */
export function capVerdict(sentAt: readonly Date[], now: Date, cfg: Pick<MatchConfig, 'maxPerDay' | 'maxPerWeek'>): 'ok' | 'day' | 'week' {
  const t = now.getTime()
  const week = sentAt.filter((d) => t - d.getTime() < WEEK_MS)
  if (week.length >= cfg.maxPerWeek) return 'week'
  if (week.filter((d) => t - d.getTime() < DAY_MS).length >= cfg.maxPerDay) return 'day'
  return 'ok'
}
