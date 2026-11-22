/**
 * The Community Call host checklist (the run-of-show) on /calls/live, shown to hosts only.
 * Steps come from the setting calls.hostChecklist, one per line: `time | step` or `time | step | note`
 * (the note says what now happens automatically). Lines without a `|` are steps with no time.
 */
import type { Settings } from '@/app/lib/settings'
import { parseCrewAliases } from '@/app/lib/settings/registry'
import { attendanceCrewId } from './crew-alias'

export interface HostChecklistStep {
  time: string
  step: string
  note: string | null
}

/** The crew id the checklist belongs to (the recorder's id is mapped through calls.attendanceCrewAliases). */
const CHECKLIST_CREW_ID = 'community_call'

export const MAX_CHECKLIST_STEPS = 60

export function parseHostChecklist(raw: string): HostChecklistStep[] {
  const out: HostChecklistStep[] = []
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const parts = t.split('|').map((p) => p.trim())
    const [time, step, note] = parts.length === 1 ? ['', parts[0], ''] : parts
    if (!step) continue
    out.push({ time: time ?? '', step, note: note ? note : null })
    if (out.length >= MAX_CHECKLIST_STEPS) break
  }
  return out
}

/** The checklist for this call, or null (not the Community Call, or the list is empty / unreadable). */
export function hostChecklistFor(crewId: string | null | undefined, settings: Pick<Settings, 'get'>): HostChecklistStep[] | null {
  const id = (crewId ?? '').trim().toLowerCase()
  if (!id) return null
  try {
    const mapped = attendanceCrewId(id, parseCrewAliases(settings.get('calls.attendanceCrewAliases'))).toLowerCase()
    if (mapped !== CHECKLIST_CREW_ID) return null
    const steps = parseHostChecklist(settings.get('calls.hostChecklist'))
    return steps.length ? steps : null
  } catch {
    return null
  }
}
