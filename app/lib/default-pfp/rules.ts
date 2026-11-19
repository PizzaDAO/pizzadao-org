// Pure rules for the default "dough ball" PFP: which review images count as approved or voted down,
// the limits for generating new ones, and the prompt for them. No I/O here.

export const DOUGH_BALL_SET_SLUG = 'dough-ball'
/** traits.round of a candidate the job generated (as opposed to the reviewed seed rounds). */
export const AUTO_ROUND = 'auto'

export interface VoteRules {
  minYesVotes: number
  votedDownMargin: number
}

export interface Tally {
  yes: number
  no: number
}

/** Approved: enough yes votes and more yes than no. */
export function isApproved(t: Tally, r: VoteRules): boolean {
  return t.yes >= Math.max(1, r.minYesVotes) && t.yes > t.no
}

/** Voted down: no leads yes by at least the margin. Such an image is never assigned. */
export function isVotedDown(t: Tally, r: VoteRules): boolean {
  return t.no - t.yes >= Math.max(1, r.votedDownMargin)
}

export interface PoolCandidate extends Tally {
  id: string
  traits: unknown
}

export function isAutoCandidate(traits: unknown): boolean {
  return !!traits && typeof traits === 'object' && (traits as Record<string, unknown>).round === AUTO_ROUND
}

/**
 * Can this unassigned image be given to a member? Approved reviewed images, plus generated images
 * (assigned immediately, before anyone has voted) until they are voted down.
 */
export function isAssignable(c: PoolCandidate, r: VoteRules): boolean {
  if (isVotedDown(c, r)) return false
  return isApproved(c, r) || isAutoCandidate(c.traits)
}

export interface GenerateSettings {
  perRun: number
  dailyMax: number
  monthlyBudgetUsd: number
  costCents: number
}

export interface GenerateUsage {
  /** Generations booked in the last 24 hours (failed ones that may have been billed included). */
  last24h: number
  /** Estimated spend this calendar month, in cents. */
  monthSpentCents: number
}

/** How many new images this run may generate, given the remaining need and every cap. */
export function generationAllowance(needed: number, s: GenerateSettings, u: GenerateUsage): number {
  if (needed <= 0 || s.perRun <= 0 || s.dailyMax <= 0 || s.costCents <= 0) return 0
  const byDay = Math.max(0, s.dailyMax - u.last24h)
  const byBudget = Math.max(0, Math.floor((s.monthlyBudgetUsd * 100 - u.monthSpentCents) / s.costCents))
  return Math.min(needed, s.perRun, byDay, byBudget)
}

// --- prompt ---------------------------------------------------------------------------------

export const EXPRESSIONS = [
  'a cheeky wink with an eager grin',
  'a wide, eager smile with sparkling eyes',
  'a proud, beaming smile',
  'a friendly, slightly nervous grin, eager to impress',
  'a playful, sly smile with a twinkle in the eye',
  'a warm, welcoming smile',
]

export const POSES = [
  'giving a crisp salute with one stubby arm',
  'tipping the fedora with one hand',
  'standing with hands on hips, chest out proudly',
  'giving a thumbs up',
  'waving hello',
]

export const OUTFITS = [
  'a flour-dusted apron',
  'a small pinstripe vest',
  'a tiny tie and suspenders',
  'an oversized trench coat that is a bit too big',
]

/** Big, clearly held kitchen or pizza props. At most one is used, besides the fedora. */
export const PROPS = [
  'a big wooden pizza peel held up in both hands',
  'an oversized rolling pin held proudly in one hand',
  'a giant slice of pizza held up in one hand',
  'a big pizza box held out in front',
  'a large wooden spoon held up like a scepter',
  'a big whisk held up in one hand',
  'a large ladle held up in one hand',
  'a big round pizza pan held up proudly',
  'no prop, just the fedora',
]

/** Words that must never appear in trait values (weapons, necklaces). */
const FORBIDDEN = /pendant|necklace|chain|knife|gun|pistol|revolver|rifle|weapon|sword|\bbat\b|baseball|dagger|blade|cleaver|machete|\baxe\b|bomb|grenade/i

export function isSafeTrait(value: string): boolean {
  return !FORBIDDEN.test(value)
}

export interface AutoTraits {
  expression: string
  pose: string
  outfit: string
  prop: string
  round: typeof AUTO_ROUND
}

const pick = <T>(arr: readonly T[], rnd: () => number): T => arr[Math.floor(rnd() * arr.length) % arr.length]

/** Values seen on approved candidates for a trait (a value on more approved images is more likely), else the full list. */
function preferred(key: string, base: readonly string[], approved: ReadonlyArray<Record<string, unknown>>): string[] {
  const seen = approved
    .map((t) => t[key])
    .filter((v): v is string => typeof v === 'string' && base.includes(v) && isSafeTrait(v))
  return seen.length > 0 ? seen : [...base]
}

/** Traits for one new image: expression, pose and outfit lean toward what won votes; the prop is always from the curated list. */
export function pickAutoTraits(approvedTraits: ReadonlyArray<Record<string, unknown>>, rnd: () => number = Math.random): AutoTraits {
  return {
    expression: pick(preferred('expression', EXPRESSIONS, approvedTraits), rnd),
    pose: pick(preferred('pose', POSES, approvedTraits), rnd),
    outfit: pick(preferred('outfit', OUTFITS, approvedTraits), rnd),
    prop: pick(PROPS, rnd),
    round: AUTO_ROUND,
  }
}

export const ROUND_RULES =
  'Rules: the only props are big, clearly held kitchen or pizza items (at most ONE prop besides the fedora, and it must be easy to see at profile-picture size). NO weapons of any kind, nothing that looks like a weapon. Never a necklace, chain or pendant, and never a tie combined with a necklace. Friendly, eager or mischievous expression, never angry or scowling.'

export function buildAutoPrompt(base: string, t: AutoTraits): string {
  return `${base}\n\nThis version: expression: ${t.expression}; pose: ${t.pose}; outfit: ${t.outfit}; prop: ${t.prop}. ${ROUND_RULES}`
}
