/**
 * Disavow list rules (plans/disavow-list.md, with Snax's 2026-10-26 decisions).
 * Every threshold lives here so it is easy to change.
 */

/** Level needed to view AND nominate (DPR can always do both). Snax: level 5+. */
export const DISAVOW_MIN_LEVEL = 5

/** Votes needed: at least this many DPR "yes" AND yes > no. */
export const DISAVOW_YES_THRESHOLD = 3
/** A round cannot pass before it has been open this long. */
export const DISAVOW_MIN_OPEN_HOURS = 72
/** A round that has not passed by then fails. */
export const DISAVOW_WINDOW_DAYS = 14
/** Nominations per person per rolling window. */
export const DISAVOW_NOMINATIONS_PER_WINDOW = 3
export const DISAVOW_NOMINATION_WINDOW_DAYS = 30
/** A listing lasts this long, then needs a REAFFIRM round. */
export const DISAVOW_LISTING_MONTHS = 12
/** A listed member may appeal once per this many days. */
export const DISAVOW_APPEAL_COOLDOWN_DAYS = 90

export const DISAVOW_MAX_STATEMENT = 1500
export const DISAVOW_MAX_RESPONSE = 1500
export const DISAVOW_MAX_COMMENT = 500
export const DISAVOW_MAX_NAME = 120
export const DISAVOW_MAX_EVIDENCE = 5
export const DISAVOW_PAGE_SIZE = 50

export const REDACTED = '[redacted]'

/** The whole feature is off unless DISAVOW_ENABLED is "true"/"1". */
export function disavowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.DISAVOW_ENABLED?.trim().toLowerCase()
  return v === 'true' || v === '1'
}

export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS
