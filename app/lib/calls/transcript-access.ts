/**
 * Who may read which parts of a published call. Each section has its own minimum member level (admin
 * settings, code defaults below); Dread Pizza Roberts sees everything. Evaluated per request; any lookup
 * failure fails closed (section hidden). Title, date and duration are not gated here.
 */
import { getCurrentLevel } from '@/app/lib/missions'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { getSetting } from '@/app/lib/settings'

/** Code defaults for the settings `calls.transcriptMinLevel`, `calls.summaryMinLevel`, `calls.actionItemsMinLevel`, `calls.chaptersMinLevel`. */
export const CALL_TRANSCRIPT_MIN_LEVEL = 6
export const CALL_SUMMARY_MIN_LEVEL = 5
export const CALL_ACTION_ITEMS_MIN_LEVEL = 4
export const CALL_CHAPTERS_MIN_LEVEL = 3

export type CallSection = 'transcript' | 'summary' | 'actionItems' | 'chapters'

const SECTION_SETTING = {
  transcript: 'calls.transcriptMinLevel',
  summary: 'calls.summaryMinLevel',
  actionItems: 'calls.actionItemsMinLevel',
  chapters: 'calls.chaptersMinLevel',
} as const

const SECTIONS = Object.keys(SECTION_SETTING) as CallSection[]

export type CallSectionAccess = Record<CallSection, { visible: boolean; minLevel: number }>

/** The current minimum level (admin setting). */
export function transcriptMinLevel(): Promise<number> {
  return getSetting('calls.transcriptMinLevel')
}

/**
 * Which sections of a published call this member may see, with the level each needs. One level lookup;
 * the (slower) Discord role lookup happens only if some section is still hidden by level.
 */
export async function callSectionAccess(discordId: string): Promise<CallSectionAccess> {
  // An unreadable setting hides the section (level 10 is above any member level).
  const minLevels = await Promise.all(SECTIONS.map((s) => getSetting(SECTION_SETTING[s]).catch(() => 10)))
  const out = {} as CallSectionAccess
  SECTIONS.forEach((s, i) => (out[s] = { visible: false, minLevel: minLevels[i] }))
  if (!discordId) return out
  const level = await getCurrentLevel(discordId).catch(() => 0)
  for (const s of SECTIONS) out[s].visible = level >= out[s].minLevel
  if (SECTIONS.some((s) => !out[s].visible) && (await isDreadPizzaRoberts(discordId).catch(() => false))) {
    for (const s of SECTIONS) out[s].visible = true
  }
  return out
}

export async function canViewCallTranscript(discordId: string): Promise<boolean> {
  if (!discordId) return false
  return (await callSectionAccess(discordId)).transcript.visible
}
