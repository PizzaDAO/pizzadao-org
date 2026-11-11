/**
 * Pure: is a pilot running? A pilot is running while the tester list is not empty AND go-live has not been recorded
 * (proposals.liveSince set). Once liveSince is set a refilled list is ignored, so it can neither loosen payments nor
 * lock voters out. An unreadable or invalid tester list counts as "pilot running with an unknown list" (fail closed).
 */
import type { Settings } from '@/app/lib/settings'

export interface PilotState {
  /** The tester list is not empty and go-live has not happened (or the list could not be read). */
  running: boolean
  /** The tester list could not be read: nobody is allowed while it is unknown. */
  unknown: boolean
  /** The listed testers (empty when not running). */
  ids: string[]
}

export const NO_PILOT: PilotState = { running: false, unknown: false, ids: [] }

/** '' (or an unparseable value) means go-live has not happened. */
export function isLiveSet(raw: unknown): boolean {
  return typeof raw === 'string' && raw !== '' && !Number.isNaN(Date.parse(raw))
}

export function pilotStateFrom(s: Pick<Settings, 'get' | 'readFailed' | 'invalidKeys'>): PilotState {
  // Go-live wins: once a valid liveSince is set the tester list is irrelevant, even if it cannot be read.
  if (!s.readFailed && !s.invalidKeys.includes('proposals.liveSince') && isLiveSet(s.get('proposals.liveSince'))) return NO_PILOT
  if (s.readFailed || s.invalidKeys.includes('proposals.pilotDiscordIds')) return { running: true, unknown: true, ids: [] }
  const ids = [...s.get('proposals.pilotDiscordIds')]
  if (ids.length === 0) return NO_PILOT
  return { running: true, unknown: false, ids }
}

/** The member may use the voting feature: no pilot running, or listed (never while the list is unknown). */
export function pilotAllows(state: PilotState, discordId: string | null | undefined): boolean {
  if (!state.running) return true
  return !state.unknown && !!discordId && state.ids.includes(discordId)
}
