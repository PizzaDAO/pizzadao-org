/**
 * Verifier contract (plans/mission-verification.md §3.2).
 *
 * A verifier checks one mission for one member against a data source and
 * returns pass / fail / unknown. Verifiers never write: the engine
 * (./engine.ts) turns a pass into an APPROVED (or held) completion.
 *
 * Data sources are injected (VerifierSources) so every verifier is unit
 * tested without a DB, Discord or Google.
 */

/** What started a run. Stored as MissionReviewEvent.via. */
export type Trigger = 'on_demand' | 'discord' | 'event' | 'submit' | 'cron' | 'backfill'

/** Events that re-run the verifiers for one member (route hooks). */
export type MissionEvent = 'x_linked' | 'wallet_connected' | 'crew_joined' | 'attendance_synced'

export interface VerifyCtx {
  discordId: string
  /** Resolved once per run (members sheet); null when unknown / not onboarded. */
  memberId: string | null
  trigger: Trigger
  now: Date
  /** The member's roles from a Discord interaction payload: free and fresh. */
  interactionRoles?: string[]
  /** The proof on the member's existing completion row, if any (e.g. a message link). */
  evidence?: string | null
  sources: VerifierSources
  /** Per-run cache shared by the verifiers (e.g. the member's roles). */
  memo: Map<string, unknown>
}

export type VerifyResult =
  | { status: 'pass'; evidence: Record<string, unknown> }
  | { status: 'fail'; reason: string; progress?: { have: number; need: number }; hint?: string }
  /** The data source was unavailable: nothing is written, nothing is flagged. */
  | { status: 'unknown'; reason: string }

export interface Verifier<P = unknown> {
  key: string
  /** 'auto' verifiers may approve; 'manual' ones are never run. */
  mode: 'auto' | 'manual'
  /** Whether a pass can later become a fail (a role removed): flag, never claw back. */
  stateful: boolean
  /** Validate Mission.verifierParams. Throws on bad params (the mission is skipped and reported). */
  parse(params: unknown): P
  check(ctx: VerifyCtx, params: P): Promise<VerifyResult>
}

/** Read-only data the verifiers need. The defaults live in ./sources.ts. */
export interface VerifierSources {
  getXAccount(discordId: string): Promise<{ xUsername: string } | null>
  /** Calls attended (community + crew), from CallAttendance (synced from the attendance sheets). */
  countCallsAttended(discordId: string): Promise<{ total: number; calls: number; byCrew: Record<string, number> }>
  /** The member's guild roles; null when Discord couldn't be asked; [] when not in the guild. */
  getMemberRoles(discordId: string): Promise<string[] | null>
  /** Guild role ids for these role names (case-insensitive, cached guild role list); null when unavailable. */
  resolveRoleIds(names: string[]): Promise<string[] | null>
  guildId(): string | null
  resolveChannelId(name: string, envName?: string): Promise<string | null>
  getChannelMessage(channelId: string, messageId: string): Promise<{ channelId: string; authorId: string } | null | 'unknown'>
  getChannel(channelId: string): Promise<{ id: string; parentId: string | null } | null | 'unknown'>
  countWallets(discordId: string, memberId: string | null): Promise<number>
}

// ---- small param helpers (no zod dependency) ----

export function asObject(params: unknown): Record<string, unknown> {
  if (params == null) return {}
  if (typeof params !== 'object' || Array.isArray(params)) throw new Error('params must be an object')
  return params as Record<string, unknown>
}

export function positiveInt(v: unknown, name: string, fallback?: number): number {
  if (v === undefined && fallback !== undefined) return fallback
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error(`${name} must be a positive integer`)
  return v
}

export function stringList(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string' && x.trim())) {
    throw new Error(`${name} must be a non-empty list of strings`)
  }
  return v.map((x) => (x as string).trim())
}
