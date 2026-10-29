/**
 * The disavow voting rules in force: the admin settings, with the constants in ./constants as the
 * code defaults. Loaded once per action and passed down (a vote count never re-reads settings).
 *
 * A round snapshots its own vote threshold and decision days when it opens (DisavowRound
 * yesThreshold / decisionDays), so changing a setting never changes the rules of a round that is
 * already open. Rounds opened before the snapshot existed have no snapshot and keep the code
 * defaults, which are what they were opened under.
 *
 * If the settings cannot be read, each rule keeps its last known value in this instance, else the
 * code default (the reviewed value). Counting an open round never depends on settings at all.
 */
import { loadSettings } from '../settings'
import {
  DISAVOW_APPEAL_COOLDOWN_DAYS, DISAVOW_DECISION_DAYS, DISAVOW_LISTING_MONTHS, DISAVOW_NOMINATIONS_PER_WINDOW,
  DISAVOW_NOMINATION_WINDOW_DAYS, DISAVOW_WINDOW_DAYS, DISAVOW_YES_THRESHOLD,
} from './constants'

export interface DisavowRules {
  /** DPR "yes" votes needed (and yes > no). */
  yesThreshold: number
  /** Nothing is counted before a round has been open this long. */
  decisionDays: number
  /** A round that has not passed by then fails. Never shorter than decisionDays. */
  windowDays: number
  nominationsPerWindow: number
  nominationWindowDays: number
  listingMonths: number
  appealCooldownDays: number
}

export const DEFAULT_DISAVOW_RULES: DisavowRules = {
  yesThreshold: DISAVOW_YES_THRESHOLD,
  decisionDays: DISAVOW_DECISION_DAYS,
  windowDays: DISAVOW_WINDOW_DAYS,
  nominationsPerWindow: DISAVOW_NOMINATIONS_PER_WINDOW,
  nominationWindowDays: DISAVOW_NOMINATION_WINDOW_DAYS,
  listingMonths: DISAVOW_LISTING_MONTHS,
  appealCooldownDays: DISAVOW_APPEAL_COOLDOWN_DAYS,
}

export async function loadDisavowRules(): Promise<DisavowRules> {
  try {
    const s = await loadSettings()
    const decisionDays = s.get('disavow.decisionDays')
    return {
      yesThreshold: s.get('disavow.yesThreshold'),
      decisionDays,
      // The two are checked together when saved; this keeps a round winnable if they ever disagree.
      windowDays: Math.max(s.get('disavow.windowDays'), decisionDays),
      nominationsPerWindow: s.get('disavow.nominationsPerWindow'),
      nominationWindowDays: s.get('disavow.nominationWindowDays'),
      listingMonths: s.get('disavow.listingMonths'),
      appealCooldownDays: s.get('disavow.appealCooldownDays'),
    }
  } catch {
    return DEFAULT_DISAVOW_RULES
  }
}
