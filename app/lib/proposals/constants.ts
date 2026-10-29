/**
 * Proposals and voting (plans/proposals-voting.md, with the 2026-10-29 decisions).
 * Rules that are NOT settings live here: the pass rule's shape and the text limits.
 */
import { toggleEnabled } from '../settings/toggles'

export const DAY_MS = 24 * 60 * 60 * 1000

export const PROPOSAL_MAX_TITLE = 200
export const PROPOSAL_MAX_BODY = 8000
export const PROPOSAL_MAX_CITY = 100
export const PROPOSAL_MAX_SPONSOR = 120
export const PROPOSAL_MAX_USD = 1_000_000

/** A proposal that was created but never opened (the snapshot failed) is retried by the cron after this long. */
export const DRAFT_RETRY_MS = 2 * 60 * 1000

/** Pass rule shape: (ayes + abstains) reach the threshold AND ayes > nays. Snapshotted on each proposal at open. */
export const COUNT_ABSTAINS = true
export const REQUIRE_AYES_OVER_NAYS = true

/**
 * The whole feature is off unless the setting proposals.enabled is on, or (no setting saved)
 * PROPOSALS_ENABLED is "true"/"1". The env var set to off always wins; unreadable settings mean off.
 */
export function proposalsEnabled(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  return toggleEnabled('proposals.enabled', env)
}
