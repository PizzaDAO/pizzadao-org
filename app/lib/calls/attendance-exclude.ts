/**
 * Accounts that never count as call attendees (music bots, other bot accounts): the ids in the
 * `calls.attendanceExcludeIds` setting. The recorder already skips bot users it can identify; this
 * is the admin-editable backstop for the ones that still show up. Unreadable settings exclude nobody.
 */
import { loadSettings, type Settings } from '@/app/lib/settings'
import { storedOverride } from '@/app/lib/settings/numbers'
import { ATTENDANCE_EXCLUDE_LINE } from '@/app/lib/settings/registry'

export function parseExcludeIds(raw: string | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const line of String(raw ?? '').split('\n')) {
    const id = line.trim()
    if (ATTENDANCE_EXCLUDE_LINE.test(id)) out.add(id)
  }
  return out
}

/** The ids in force: the saved list, or (settings unreadable) the last list this instance saw, else none. */
export function excludedFromSettings(settings: Settings): Set<string> {
  try {
    return parseExcludeIds(settings.get('calls.attendanceExcludeIds'))
  } catch {
    return new Set()
  }
}

/** False when the settings could not be read and this instance has never seen the list: the answer is a guess. */
export function excludesKnown(settings: Settings): boolean {
  return !settings.readFailed || storedOverride('calls.attendanceExcludeIds', settings) !== undefined
}

export async function loadAttendanceExcludes(): Promise<Set<string>> {
  try {
    return excludedFromSettings(await loadSettings())
  } catch {
    return new Set()
  }
}

/** Like loadAttendanceExcludes, but null when the list is unknown (callers that write rows then wait). */
export async function loadAttendanceExcludesOrNull(): Promise<Set<string> | null> {
  try {
    const s = await loadSettings()
    return excludesKnown(s) ? excludedFromSettings(s) : null
  } catch {
    return null
  }
}
