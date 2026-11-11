/**
 * Crew roster auto-add from call attendance. Kept in its own file so the registry only carries one
 * spread line for the group. Everything defaults to the safe state: the switch is off, and the
 * nightly job then only counts what it would do. This file imports only types from ./registry.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

function int(o: { key: string; label: string; help: string; min: number; max: number; default: number; unit?: string }): SettingDef<number> {
  return {
    key: o.key,
    area: 'crews',
    label: o.label,
    help: o.help,
    schema: z.number().int().min(o.min).max(o.max),
    default: o.default,
    onReadFailure: { value: o.default },
    input: { type: 'int', min: o.min, max: o.max, ...(o.unit ? { unit: o.unit } : {}) },
  }
}

const enabled: SettingDef<boolean> = {
  key: 'crews.rosterAutoAddEnabled',
  area: 'crews',
  label: 'Add regular call attendees to the crew roster',
  help: "Nightly: a signed-up member who attended enough of a crew's recent calls is added to that crew: their Crews cell, the crew page roster (when it reads from the database) and the crew Discord role. A member already on the crew who misses one of these gets it filled in. Nobody is ever removed and nothing is announced. Off: the job only counts what it would add. The CREWS_ROSTER_AUTOADD_ENABLED env var set to off always wins; on preview deploys only the env var counts.",
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? "Members who attend a crew's calls regularly will be added to that crew and given its Discord role." : null),
}

const excludeIds: SettingDef<string> = {
  key: 'crews.rosterAutoAddExcludeIds',
  area: 'crews',
  label: 'Never auto-add these Discord ids',
  help: 'Discord user ids (recorder bots, test accounts), separated by spaces, commas or new lines. They are skipped by the roster auto-add.',
  schema: z.string().trim().max(2000),
  default: '',
  onReadFailure: { value: '' },
  input: { type: 'text', multiline: true, maxLength: 2000 },
}

export const CREWS_SETTINGS = {
  'crews.rosterAutoAddEnabled': enabled,
  'crews.rosterAutoAddMinCalls': int({
    key: 'crews.rosterAutoAddMinCalls',
    label: 'Roster auto-add: calls attended',
    help: "A member is added when they attended at least this many of the crew's last calls (the window below).",
    min: 1,
    max: 20,
    default: 2,
  }),
  'crews.rosterAutoAddWindowCalls': int({
    key: 'crews.rosterAutoAddWindowCalls',
    label: 'Roster auto-add: window (last calls)',
    help: "How many of the crew's most recent calls (calls with recorded attendance) are looked at.",
    min: 1,
    max: 20,
    default: 4,
  }),
  'crews.rosterAutoAddMaxPerRun': int({
    key: 'crews.rosterAutoAddMaxPerRun',
    label: 'Roster auto-add: most additions per night',
    help: 'Caps one nightly run. Only members who actually got something written count (a member who fails or is skipped does not use up the cap). The rest wait for the next night.',
    min: 1,
    max: 200,
    default: 25,
  }),
  'crews.rosterAutoAddExcludeIds': excludeIds,
} as const satisfies Record<string, SettingDef>
