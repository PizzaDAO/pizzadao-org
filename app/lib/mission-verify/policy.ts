import { getVerifier } from './verifiers'
/**
 * Rollout flag and payout policy for automatic mission verification.
 *
 *   MISSION_VERIFIERS_ENABLED  "1" / "true" / "on" turns the engine on. Default
 *                              OFF: every run is a dry run (progress hints only,
 *                              nothing approved, nothing paid, no Discord posts).
 *
 * Decision D9 (plans/mission-verification.md §9): a verifier pass is approved
 * automatically only when no human "release" is required. A release is
 * required for
 *   - the human-release level and up (default L6, 6,942 PEP and more), always, and
 *   - Discord accounts younger than the new-account age (default 30 days, from the snowflake
 *     timestamp).
 * Both numbers are admin settings (missions.humanReleaseMinLevel, missions.newAccountDays) that can
 * only be made stricter from the admin page.
 * Such completions stay PENDING with a holdReason until a reviewer releases
 * them (approve in the review panel). A NEW_ACCOUNT hold is lifted
 * automatically by a later run once the account is old enough.
 */
import type { MissionHold } from '@prisma/client'
import { loadSettings } from '../settings'

export function missionVerifiersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'on', 'yes'].includes((env.MISSION_VERIFIERS_ENABLED ?? '').trim().toLowerCase())
}

/** Code default for `missions.humanReleaseMinLevel`: levels at or above this always need a human release (D9). */
export const HUMAN_RELEASE_MIN_LEVEL = 6
/** Code default for `missions.newAccountDays`: accounts younger than this need a human release (D9). */
export const NEW_ACCOUNT_DAYS = 30

/** The hold rules in force. Pure functions take one so bulk runs read the settings once. */
export interface HoldPolicy {
  humanReleaseMinLevel: number
  newAccountDays: number
  /**
   * True when the settings could not be read (or a stored value was invalid), so the numbers above
   * are the strictest fallback, not the real rules. Automatic passes must then neither approve nor
   * create a hold: nothing is written and nobody is pinged until the settings read again.
   */
  readFailed?: boolean
}

export const DEFAULT_HOLD_POLICY: HoldPolicy = {
  humanReleaseMinLevel: HUMAN_RELEASE_MIN_LEVEL,
  newAccountDays: NEW_ACCOUNT_DAYS,
}

/**
 * The live hold rules from the admin settings. If the settings cannot be read, every auto-pass
 * waits for a human (humanReleaseMinLevel 1, newAccountDays 365: see the registry).
 */
export async function loadHoldPolicy(): Promise<HoldPolicy> {
  const s = await loadSettings()
  const invalid = s.invalidKeys.some((k) => k === 'missions.humanReleaseMinLevel' || k === 'missions.newAccountDays')
  return {
    humanReleaseMinLevel: s.get('missions.humanReleaseMinLevel'),
    newAccountDays: s.get('missions.newAccountDays'),
    ...(s.readFailed || invalid ? { readFailed: true } : {}),
  }
}

const DISCORD_EPOCH_MS = BigInt(1420070400000)

/** When a Discord account (snowflake) was created, or null if `id` isn't a snowflake. */
export function snowflakeCreatedAt(id: string): Date | null {
  if (!/^\d{15,25}$/.test(id)) return null
  const ms = Number((BigInt(id) >> BigInt(22)) + DISCORD_EPOCH_MS)
  return Number.isFinite(ms) ? new Date(ms) : null
}

/** A snowflake for a given creation time (tests and fixtures). */
export function snowflakeAt(date: Date, increment = 0): string {
  return ((BigInt(date.getTime()) - DISCORD_EPOCH_MS) << BigInt(22) | BigInt(increment & 0xfff)).toString()
}

export function isNewAccount(discordId: string, now: Date, policy: HoldPolicy = DEFAULT_HOLD_POLICY): boolean {
  const created = snowflakeCreatedAt(discordId)
  if (!created) return true // can't tell: fail safe, a human releases it
  return now.getTime() - created.getTime() < policy.newAccountDays * 86_400_000
}

/** Why a verifier pass on a mission of `level` must wait for a human, or null to approve now. */
export function releaseHoldFor(
  level: number,
  discordId: string,
  now: Date,
  policy: HoldPolicy = DEFAULT_HOLD_POLICY,
): MissionHold | null {
  if (level >= policy.humanReleaseMinLevel) return 'HIGH_LEVEL'
  if (isNewAccount(discordId, now, policy)) return 'NEW_ACCOUNT'
  return null
}

/** Reviewer and member copy for a hold, built from the rules in force (never a literal number). */
export function holdLabel(hold: MissionHold, policy: HoldPolicy = DEFAULT_HOLD_POLICY): string {
  switch (hold) {
    case 'NEW_ACCOUNT':
      return `Discord account under ${policy.newAccountDays} days old`
    case 'HIGH_LEVEL':
      return `Level ${policy.humanReleaseMinLevel}+ needs a human approval`
    case 'PREVIOUSLY_REJECTED':
      return 'Rejected before; the verifier now passes'
  }
}

/** The labels at the code defaults (tests and fixtures). Live code uses holdLabel(hold, policy). */
export const HOLD_LABEL: Record<MissionHold, string> = {
  NEW_ACCOUNT: holdLabel('NEW_ACCOUNT'),
  HIGH_LEVEL: holdLabel('HIGH_LEVEL'),
  PREVIOUSLY_REJECTED: holdLabel('PREVIOUSLY_REJECTED'),
}

/**
 * Whether a member may submit this mission by hand. An automatic verifier with
 * no proof to submit (proofKind NONE: the vouch received, Rare Pizza Box, role,
 * attendance missions...) is checked by "Check my progress" and the nightly run,
 * never by a reviewer: a manual submission would only clog the review queue.
 * L3.1 referral is the exception (its description invites a manual submission
 * for invites made before referrals were tracked).
 */
export function acceptsManualSubmission(mission: {
  verifierKey: string | null | undefined
  proofKind: string | null | undefined
}): boolean {
  if (!mission.verifierKey || mission.verifierKey === 'referral') return true
  if ((mission.proofKind ?? 'NONE') !== 'NONE') return true
  return getVerifier(mission.verifierKey)?.mode !== 'auto'
}
