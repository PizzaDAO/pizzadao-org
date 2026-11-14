/**
 * Buddy system rules (plans/buddy-system.md, phase 1). Pure: no database, no Discord. The service
 * modules load the facts and pass them in, so every rule here is unit-tested directly.
 */

/** A pair in one of these states counts: it holds the trainee's one buddy slot and the buddy's capacity. */
export const ACTIVE_PAIR_STATUSES = ['QUEUED', 'MATCHED', 'INTRODUCED'] as const
export type ActivePairStatus = (typeof ACTIVE_PAIR_STATUSES)[number]

export const isActiveStatus = (status: string): boolean => (ACTIVE_PAIR_STATUSES as readonly string[]).includes(status)

/** A member can offer to be a buddy once their current mission level reaches the configured minimum. */
export function isBuddyEligible(currentLevel: number, minLevel: number): boolean {
  return Number.isFinite(currentLevel) && currentLevel >= minLevel
}

/** The trainee is done when they have completed the configured missions level (current level is past it). */
export function hasTraineeFinished(currentLevel: number, completionLevel: number): boolean {
  return currentLevel > completionLevel
}

/** How many trainees one buddy can hold: their own limit, never above the site-wide cap, never below one. */
export function buddyCapacity(maxActive: number, cap: number): number {
  const own = Number.isFinite(maxActive) ? Math.floor(maxActive) : 1
  return Math.max(1, Math.min(own, Math.max(1, cap)))
}

export type PairRefusal =
  | 'self'
  | 'buddy_unavailable' // not a buddy, opted out
  | 'buddy_paused'
  | 'buddy_full'
  | 'trainee_has_buddy'
  | 'trainee_finished'

export interface PairingFacts {
  traineeDiscordId: string
  buddyDiscordId: string
  /** The buddy's profile, or null when they never opted in. */
  buddy: { active: boolean; paused: boolean; maxActive: number } | null
  /** Active pairs the buddy already holds. */
  buddyActiveCount: number
  /** Active pairs the trainee already has (should be 0 or 1). */
  traineeActiveCount: number
  traineeFinished: boolean
  /** buddy.maxActivePerBuddy */
  capacityCap: number
}

/** The first reason this pair cannot be made, or null when it can. */
export function checkPairing(f: PairingFacts): PairRefusal | null {
  if (f.traineeDiscordId === f.buddyDiscordId) return 'self'
  if (!f.buddy || !f.buddy.active) return 'buddy_unavailable'
  if (f.buddy.paused) return 'buddy_paused'
  if (f.traineeFinished) return 'trainee_finished'
  if (f.traineeActiveCount > 0) return 'trainee_has_buddy'
  if (f.buddyActiveCount >= buddyCapacity(f.buddy.maxActive, f.capacityCap)) return 'buddy_full'
  return null
}

export const REFUSAL_TEXT: Record<PairRefusal, string> = {
  self: 'A member cannot be their own buddy.',
  buddy_unavailable: 'That member is not an active buddy.',
  buddy_paused: 'That buddy is paused.',
  buddy_full: 'That buddy already has the most trainees they can take.',
  trainee_has_buddy: 'That trainee already has a buddy.',
  trainee_finished: 'That trainee has already finished the level this pairing runs to.',
}

export interface ChecklistFacts {
  /** Whether the intro was recorded (the thread was opened). */
  introduced: boolean
  traineeLevel: number
  completionLevel: number
  /** Community calls the trainee has attended. */
  traineeCalls: number
  /** The buddy has vouched for the trainee. */
  vouched: boolean
}

export interface ChecklistItem {
  key: string
  label: string
  done: boolean
  /** Ticked from existing data (always true in phase 1). */
  auto: boolean
}

/** The buddy's checklist. Everything ticks from existing mission, attendance and vouch data. */
export function buildChecklist(f: ChecklistFacts): ChecklistItem[] {
  const items: ChecklistItem[] = [
    { key: 'intro', label: 'Meet your trainee in the buddy thread', done: f.introduced, auto: true },
    { key: 'call', label: 'Bring them to a community call', done: f.traineeCalls > 0, auto: true },
  ]
  for (let level = 1; level <= Math.max(1, f.completionLevel); level++) {
    items.push({ key: `level${level}`, label: `Help them finish Level ${level} missions`, done: f.traineeLevel > level, auto: true })
  }
  items.push({ key: 'vouch', label: 'Vouch for them once you have met', done: f.vouched, auto: true })
  return items
}

/** Fill {trainee} and {buddy} with Discord mentions. Unknown placeholders are left alone. */
export function renderIntro(template: string, ids: { traineeDiscordId: string; buddyDiscordId: string }): string {
  return template.replaceAll('{trainee}', `<@${ids.traineeDiscordId}>`).replaceAll('{buddy}', `<@${ids.buddyDiscordId}>`)
}

/** A Discord thread name (max 100 chars) with no mentions, newlines or markdown from a display name. */
export function threadName(traineeName: string): string {
  const clean = traineeName.replace(/[\r\n@#<>`*_~|]/g, ' ').replace(/\s+/g, ' ').trim()
  return `Buddy: ${clean || 'new member'}`.slice(0, 100)
}
