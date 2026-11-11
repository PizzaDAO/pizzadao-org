/**
 * Accounts that never count as call attendees (music bots, other bot accounts): the ids in the
 * `calls.attendanceExcludeIds` setting. The recorder already skips bot users it can identify; this
 * is the admin-editable backstop for the ones that still show up. Unreadable settings exclude nobody.
 */
import { loadSettings, type Settings } from '@/app/lib/settings'
import { ATTENDANCE_EXCLUDE_LINE } from '@/app/lib/settings/registry'

export function parseExcludeIds(raw: string | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const line of String(raw ?? '').split('\n')) {
    const id = line.trim()
    if (ATTENDANCE_EXCLUDE_LINE.test(id)) out.add(id)
  }
  return out
}

export function excludedFromSettings(settings: Settings): Set<string> {
  return settings.readFailed ? new Set() : parseExcludeIds(settings.get('calls.attendanceExcludeIds'))
}

export async function loadAttendanceExcludes(): Promise<Set<string>> {
  try {
    return excludedFromSettings(await loadSettings())
  } catch {
    return new Set()
  }
}
