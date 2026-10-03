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
export type MissionEvent = 'x_linked' | 'wallet_connected' | 'crew_joined' | 'attendance_synced' | 'referral_created'

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

/** One pre-check a semi-automatic verifier ran on a proof (true / false / null = not checkable, a reviewer looks). */
export interface SemiCheck {
  label: string
  ok: boolean | null
}

/** How much the pre-checks vouch for a proof: every check passed / some unchecked / one failed. */
export type Confidence = 'high' | 'medium' | 'low'

export type VerifyResult =
  | { status: 'pass'; evidence: Record<string, unknown> }
  | { status: 'fail'; reason: string; progress?: { have: number; need: number }; hint?: string }
  /** The data source was unavailable: nothing is written, nothing is flagged. */
  | { status: 'unknown'; reason: string }
  /**
   * Semi-automatic verifiers: the proof looks valid, here is what was checked;
   * a reviewer decides (the completion stays PENDING with this as checkResult).
   */
  | { status: 'needs_review'; evidence: Record<string, unknown>; checks: SemiCheck[]; confidence: Confidence; summary: string }

export interface Verifier<P = unknown> {
  key: string
  /**
   * 'auto' verifiers may approve (the engine runs them); 'semi' ones only
   * pre-check a submitted proof for a reviewer (the submit route runs them,
   * never the engine); 'manual' ones are never run.
   */
  mode: 'auto' | 'semi' | 'manual'
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
  /** Referrals naming this member as the inviter (L3.1). */
  getReferrals(inviterDiscordId: string): Promise<ReferralRow[]>
  /** Duplicate-account signal kinds (AccountSignal) that involve both Discord accounts. */
  sharedSignalKinds(a: string, b: string): Promise<string[]>
  /** Farcaster accounts linked to the member (SocialAccount; fid when resolved). */
  getFarcasterAccounts(memberId: string | null): Promise<Array<{ username: string; fid: number | null }>>
  /** The member's linked Telegram username (TelegramAccount), without the @. */
  getTelegramUsername(discordId: string): Promise<string | null>
  /** HTTP for the semi verifiers (always wrapped in ./net.ts: timeout + size cap). */
  fetch: typeof fetch
  /** NEYNAR_API_KEY, or null (Farcaster then falls back to the URL check). */
  neynarApiKey(): string | null
  /** RSV_PIZZA_API_URL, default https://api.rsv.pizza. */
  rsvPizzaApiUrl(): string
}

export interface ReferralRow {
  inviteeDiscordId: string
  inviteeMemberId: string | null
  via: string
  createdAt: Date
  qualifiedAt: Date | null
  flags: string[]
}

/** Confidence from the checks: any failed -> low; any unchecked -> medium; else high. */
export function confidenceOf(checks: readonly SemiCheck[]): Confidence {
  if (checks.some((c) => c.ok === false)) return 'low'
  if (checks.some((c) => c.ok === null)) return 'medium'
  return 'high'
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
