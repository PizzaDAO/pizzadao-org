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
  help: "Nightly: a signed-up member who attended enough of a crew's recent calls is added to that crew: their Crews cell, the crew page roster (as 3. Warm, when it reads from the database) and the crew Discord role. A member already on the crew who misses one of these gets it filled in. Nobody is ever removed and nothing is announced. Off: the job only counts what it would add. The CREWS_ROSTER_AUTOADD_ENABLED env var set to off always wins; on preview deploys only the env var counts.",
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

const benchEnabled: SettingDef<boolean> = {
  key: 'crews.rosterBenchEnabled',
  area: 'crews',
  label: 'Add past attendees to the crew Bench',
  help: 'Nightly: members who attended a crew\'s calls in the past but are not active regulars get a "5. Cold" row on the crew page. Separate from the switch above. Off: the job only counts what it would add. The CREWS_ROSTER_BENCH_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? 'Past attendees will be added to crew pages as Cold bench members.' : null),
}

const taskUpdatePostsEnabled: SettingDef<boolean> = {
  key: 'crews.taskUpdatePostsEnabled',
  area: 'crews',
  label: 'Post crew task updates to the crew channel',
  help: "When a crew task is created, moved to Doing or Done, or given a lead on the website, Metalhead posts one digest in that crew's Discord channel with a link to the crew page (at most one per crew per the interval below; no pings). Uses the private post filter: excluded crews get no post. Off: nothing is posted and nothing is queued. The CREWS_TASK_UPDATE_POSTS_ENABLED env var set to off always wins; preview deploys never post.",
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? "Crew channels will get a digest of task changes made on the website." : null),
}

function flag(key: string, label: string, help: string, confirmOn?: string): SettingDef<boolean> {
  return {
    key,
    area: 'crews',
    label,
    help,
    schema: z.boolean(),
    default: false,
    onReadFailure: { value: false },
    input: { type: 'bool' },
    ...(confirmOn ? { confirm: (from: boolean, to: boolean) => (to && !from ? confirmOn : null) } : {}),
  }
}

const CREW_CALL_POST_TEMPLATE_DEFAULT = '{crew} call is starting now. Join: {voice} Live notes: {live}'

const crewCallPostTemplate: SettingDef<string> = {
  key: 'crewCall.postTemplate',
  area: 'crews',
  label: 'Start crew call: channel post',
  help: 'Posted in the crew channel when a call is started from the crew page. Placeholders: {crew}, {voice} (the voice channel link), {live} (the live notes link). Empty: nothing is posted.',
  schema: z.string().trim().max(500),
  default: CREW_CALL_POST_TEMPLATE_DEFAULT,
  onReadFailure: { value: CREW_CALL_POST_TEMPLATE_DEFAULT },
  input: { type: 'text', multiline: true, maxLength: 500 },
}

const crewCallCrews: SettingDef<string[]> = {
  key: 'crewCall.crews',
  area: 'crews',
  label: 'Start crew call: only these crews',
  help: 'Crew ids, one per line. Only these crews get the Start crew call button. Empty: every crew (once the switch is on). Use it to pilot with one crew.',
  schema: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, 'Not a valid crew id')).max(40),
  default: [],
  onReadFailure: { value: [] },
  input: { type: 'stringList', maxItems: 40, maxLength: 40 },
}

export const CREWS_SETTINGS = {
  'crewCall.startEnabled': flag(
    'crewCall.startEnabled',
    'Start crew call button on the crew page',
    "Crew leads, Pizza Capos and admins get a Start crew call button on their crew's page. It starts the crew's Discord call event (Metalhead then records as usual) and posts a short note in the crew channel. Off: no button and the endpoint refuses. The CREW_CALL_START_ENABLED env var set to off always wins; preview deploys never write to Discord.",
    "Crew leads, capos and admins will be able to start crew calls from the crew page, which changes the Discord event and posts in the crew channel.",
  ),
  'crewCall.allowAdHoc': flag(
    'crewCall.allowAdHoc',
    'Start crew call: allow calls outside the schedule',
    "When the crew has no call scheduled close to now, the button creates a one-off Discord call event so the call is recorded. Off: it answers with the crew's next call time instead.",
    'Crews will be able to start unscheduled calls, which create Discord events.',
  ),
  'crewCall.allowCrewMembers': flag(
    'crewCall.allowCrewMembers',
    'Start crew call: any crew member',
    "Off: only crew leads, Pizza Capos and admins can press the button. On: anyone on the crew's roster can.",
    "Every member on a crew's roster will be able to start that crew's call.",
  ),
  'crewCall.pingRole': flag(
    'crewCall.pingRole',
    'Start crew call: ping the crew role',
    "Off: the channel note mentions nobody. On: it mentions the crew's Discord role.",
    'The crew role will be pinged each time a call is started from the crew page.',
  ),
  'crewCall.startWindowMinutes': int({
    key: 'crewCall.startWindowMinutes',
    label: 'Start crew call: schedule window',
    help: "A scheduled call counts as this call when it starts within this many minutes of now (before or after).",
    min: 5,
    max: 60,
    default: 30,
    unit: 'minutes',
  }),
  'crewCall.cooldownMinutes': int({
    key: 'crewCall.cooldownMinutes',
    label: 'Start crew call: cooldown',
    help: 'After a crew call is started from the page, the crew cannot start another for this long.',
    min: 5,
    max: 180,
    default: 30,
    unit: 'minutes',
  }),
  'crewCall.postTemplate': crewCallPostTemplate,
  'crewCall.crews': crewCallCrews,
  'crews.taskUpdatePostsEnabled': taskUpdatePostsEnabled,
  'crews.taskUpdateDigestMinutes': int({
    key: 'crews.taskUpdateDigestMinutes',
    label: 'Task update digest: minutes between posts',
    help: 'A crew gets at most one task-update digest per this many minutes; changes in between are listed together in the next one. The job runs every 15 minutes, so the effective minimum is 15.',
    min: 15,
    max: 1440,
    default: 60,
    unit: 'minutes',
  }),
  'crews.rosterAutoAddEnabled': enabled,
  'crews.rosterAutoAddMinCalls': int({
    key: 'crews.rosterAutoAddMinCalls',
    label: 'Roster auto-add: calls attended',
    help: "A member is an active regular when they attended at least this many different calls of the crew within the look-back period below.",
    min: 1,
    max: 50,
    default: 3,
  }),
  'crews.rosterAutoAddLookbackDays': int({
    key: 'crews.rosterAutoAddLookbackDays',
    label: 'Roster auto-add: look-back (days)',
    help: "How far back the attendance counts for an active regular.",
    min: 30,
    max: 3650,
    default: 365,
    unit: 'days',
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
  'crews.rosterBenchEnabled': benchEnabled,
  'crews.rosterBenchMinCalls': int({
    key: 'crews.rosterBenchMinCalls',
    label: 'Crew bench: calls attended, ever',
    help: 'A member who is not an active regular but attended at least this many different calls of the crew at any time gets a "5. Cold" row on the crew page (the Bench). Nothing else changes: no Crews cell, no Discord role.',
    min: 1,
    max: 50,
    default: 3,
  }),
  'crews.rosterBenchMaxPerRun': int({
    key: 'crews.rosterBenchMaxPerRun',
    label: 'Crew bench: most rows per night',
    help: 'Caps the bench rows one nightly run adds, so a large backlog is caught up over a few nights.',
    min: 1,
    max: 1000,
    default: 100,
  }),
} as const satisfies Record<string, SettingDef>
