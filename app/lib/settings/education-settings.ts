/**
 * Education sessions on the site (plans/education-sessions-on-site.md, phases 1 and 2): the manage
 * page, the public /learn listing and the dashboard card. Kept in its own file so the registry only
 * carries one spread line. Every switch is off by default; the tunables hold today's behaviour.
 * This file imports only types from ./registry.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

const ENV_NOTE = 'The matching env var set to off always wins; on preview deploys only the env var counts.'

const toggle = (key: string, label: string, help: string, confirmOn: string): SettingDef<boolean> => ({
  key,
  area: 'discord',
  label,
  help: `${help} ${ENV_NOTE}`,
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? confirmOn : null),
})

const text = (key: string, label: string, help: string, maxLength: number, multiline: boolean): SettingDef<string> => ({
  key,
  area: 'discord',
  label,
  help,
  schema: z.string().trim().max(maxLength),
  default: '',
  onReadFailure: { value: '' },
  input: { type: 'text', maxLength, multiline },
})

export const SESSION_CREW_IDS_DEFAULT: string[] = ['education']

export const EDUCATION_SETTINGS = {
  'education.editEnabled': toggle(
    'education.editEnabled',
    'Manage education sessions from the website',
    'Leads can list, edit, cancel and retry sessions on the manage page. Editing updates the existing Discord event and announcement in place. Off: the manage page is read only.',
    'Crew leads can now edit and cancel scheduled sessions, which changes the Discord event and announcement.',
  ),
  'education.publicListingEnabled': toggle(
    'education.publicListingEnabled',
    'Public sessions page (/learn)',
    'Shows upcoming and past sessions that leads marked public on the marketing site, with add-to-calendar files. Also adds a Sessions link to the member header. Off: /learn answers 404.',
    'The public /learn page will list scheduled sessions.',
  ),
  'education.dashboardCardEnabled': toggle(
    'education.dashboardCardEnabled',
    'Next session card on the member dashboard',
    'Shows the next upcoming session on every member dashboard, and a Schedule button for leads.',
    'Members will see the next session on their dashboard.',
  ),
  'education.defaultLengthMinutes': {
    key: 'education.defaultLengthMinutes',
    area: 'discord',
    label: 'Default session length',
    help: 'The length the schedule form starts with.',
    schema: z.number().int().min(15).max(480),
    default: 60,
    onReadFailure: { value: 60 },
    input: { type: 'int', min: 15, max: 480, unit: 'minutes' },
  } as SettingDef<number>,
  'education.descriptionTemplate': text(
    'education.descriptionTemplate',
    'Session description template',
    'Pre-fills the description on the schedule form so a lead only edits it. Empty: the description starts blank.',
    1000,
    true,
  ),
  'education.publicIntroText': text(
    'education.publicIntroText',
    'Public sessions page intro',
    'A short paragraph above the list on /learn. Plain text. Empty: a generic line is used.',
    500,
    true,
  ),
  'education.sessionCrewIds': {
    key: 'education.sessionCrewIds',
    area: 'discord',
    label: 'Crews that can schedule sessions',
    help: 'Crew ids (one per line) whose leads can schedule sessions from the website. Posts go to the education channels above. Empty: nobody can schedule (admins included).',
    schema: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, 'Not a valid crew id')).max(20),
    default: SESSION_CREW_IDS_DEFAULT,
    onReadFailure: { value: SESSION_CREW_IDS_DEFAULT },
    input: { type: 'stringList', maxItems: 20, maxLength: 40 },
    confirm: (from, to) => (to.some((c) => !from.includes(c)) ? 'Leads of the added crews will be able to post session announcements.' : null),
  } as SettingDef<string[]>,
} as const satisfies Record<string, SettingDef>
