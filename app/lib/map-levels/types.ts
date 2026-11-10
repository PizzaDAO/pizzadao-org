/** Shared types for the reach-map levels (plans/map-city-levels.md). Everything here is plain data. */

/** A chapter city on the pizzadao.org map (synced from the site by scripts/map-levels/sync-cities.mjs). */
export interface MapCity {
  /** Stable id shared with the site (slug-isoNumeric). */
  key: string
  name: string
  /** ISO 3166-1 alpha-2. */
  country: string
  /** ISO 3166-1 numeric, zero padded: the id the site's world-atlas features use. */
  isoNumeric: string
  coords: [number, number]
}

/** One tier. Level number = position in the list (1-based). Cities and countries share names, not thresholds. */
export interface Tier {
  name: string
  /** A city reaches this tier at this summed score. */
  cityMin: number
  /** A country reaches this tier at this summed score. */
  countryMin: number
}

export interface PlaceAlias {
  /** Normalised raw text (see normalizeAliasMatch). */
  match: string
  /** A map city key, `country:XX`, or `ignore`. */
  target: string
}

export interface MapLevelsConfig {
  weightLevel: number
  weightMission: number
  missionCap: number
  weightPep: number
  pepCap: number
  /** 0 = no cap. */
  scoreCap: number
  minMembersCity: number
  minMembersCountry: number
  tiers: Tier[]
  /** Public member-count buckets, ascending. Empty = publish no counts. */
  buckets: number[]
  aliases: PlaceAlias[]
}

/** Where one member lives, as far as the map is concerned. */
export type PlaceResult =
  | { kind: 'city'; key: string; country: string }
  | { kind: 'countryOnly'; country: string }
  | { kind: 'unplaced' }

/** What the score needs to know about a member (no names, no ids). */
export interface MemberSignals {
  /** False when the member has no Discord account: they count toward the member count but score 0. */
  hasDiscord: boolean
  /** Current level (1 = nothing completed yet). */
  level: number
  approvedMissions: number
  pep: number
}

export interface ScoredMember {
  place: PlaceResult
  score: number
  /** Internal only (never published): the Discord id, for de-duplication. Absent when the member has none. */
  discordId?: string
}

/** The whitelisted public payload. Built field by field in aggregate.ts, never by deleting fields. */
export interface PublicMapLevels {
  version: 1
  generatedAt: string
  tiers: Array<{ level: number; name: string }>
  cities: Array<{ key: string; name: string; country: string; level: number; members?: string }>
  countries: Array<{ iso2: string; isoNumeric: string; name: string; level: number; members?: string }>
}
