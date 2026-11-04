/**
 * Settings for the proposed crew task updates (plans/post-call-agenda-updates.md, ask 2). All off by
 * default: the pass runs only when the switch is on, the crew is in the allowlist (empty = none) and
 * the settings could be read. No crew names or filter values live in code.
 */
import { loadSettings, type Settings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { parseCrewList } from '@/app/lib/calls/live-items'
import { normalizeCrewId } from '@/app/lib/crew-id'

export interface TaskProposalConfig {
  enabled: boolean
  /** Normalized crew ids; empty = none. */
  crews: string[]
  maxPerCall: number
  maxDays: number
  /** '' = the summary model. */
  model: string
  nudge: boolean
}

export function taskProposalConfigFrom(settings: Settings, env: Record<string, string | undefined> = process.env): TaskProposalConfig {
  const crews = settings.readFailed ? [] : parseCrewList(settings.get('calls.taskProposalsCrews'))
  return {
    enabled: !settings.readFailed && crews.length > 0 && resolveToggle('calls.taskProposalsEnabled', settings, env),
    crews,
    maxPerCall: settings.get('calls.taskProposalsMaxPerCall'),
    maxDays: settings.get('calls.taskProposalMaxDays'),
    model: settings.get('calls.taskProposalsModel').trim(),
    nudge: !settings.readFailed && resolveToggle('calls.taskProposalsNudgeEnabled', settings, env),
  }
}

/** Never throws: unreadable settings mean everything off. */
export async function loadTaskProposalConfig(env: Record<string, string | undefined> = process.env): Promise<TaskProposalConfig> {
  try {
    return taskProposalConfigFrom(await loadSettings(), env)
  } catch {
    return { enabled: false, crews: [], maxPerCall: 15, maxDays: 14, model: '', nudge: false }
  }
}

export function crewInAllowlist(cfg: Pick<TaskProposalConfig, 'crews'>, crewId: string | null | undefined): boolean {
  const id = crewId ? normalizeCrewId(crewId) : ''
  return !!id && cfg.crews.includes(id)
}
