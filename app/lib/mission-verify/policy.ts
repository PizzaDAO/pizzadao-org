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
 *   - L6 and up (6,942 PEP and more), always, and
 *   - Discord accounts younger than 30 days (from the snowflake timestamp).
 * Such completions stay PENDING with a holdReason until a reviewer releases
 * them (approve in the review panel). A NEW_ACCOUNT hold is lifted
 * automatically by a later run once the account is old enough.
 */
import type { MissionHold } from '@prisma/client'

export function missionVerifiersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'on', 'yes'].includes((env.MISSION_VERIFIERS_ENABLED ?? '').trim().toLowerCase())
}

/** Levels at or above this always need a human release (D9). */
export const HUMAN_RELEASE_MIN_LEVEL = 6
/** Accounts younger than this many days need a human release (D9). */
export const NEW_ACCOUNT_DAYS = 30

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

export function isNewAccount(discordId: string, now: Date): boolean {
  const created = snowflakeCreatedAt(discordId)
  if (!created) return true // can't tell: fail safe, a human releases it
  return now.getTime() - created.getTime() < NEW_ACCOUNT_DAYS * 86_400_000
}

/** Why a verifier pass on a mission of `level` must wait for a human, or null to approve now. */
export function releaseHoldFor(level: number, discordId: string, now: Date): MissionHold | null {
  if (level >= HUMAN_RELEASE_MIN_LEVEL) return 'HIGH_LEVEL'
  if (isNewAccount(discordId, now)) return 'NEW_ACCOUNT'
  return null
}

export const HOLD_LABEL: Record<MissionHold, string> = {
  NEW_ACCOUNT: 'Discord account under 30 days old',
  HIGH_LEVEL: 'Level 6+ needs a human release',
  PREVIOUSLY_REJECTED: 'Rejected before; the verifier now passes',
}
