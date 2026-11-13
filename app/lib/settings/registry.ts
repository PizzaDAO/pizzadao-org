/**
 * The settings registry (plans/app-settings.md). One entry per admin-editable rule: its key,
 * code default, zod bounds, and what to do when the stored value cannot be read.
 *
 * Rules:
 * - With no AppSetting row, the code default applies, so deploying this changes no behaviour
 *   (registry.test.ts locks every default to the constant it replaced).
 * - Bounds are enforced on write AND on read. A bound is also how "stricter only" is enforced for
 *   approval-authority settings: the schema's min/max stop at today's value, so the admin page can
 *   tighten a rule but loosening it needs a code change.
 * - Keys never contain secrets. Editorial/private values live only in DB rows, never here.
 */
import { z } from 'zod'
import { explorersTextValid } from '@/app/lib/proposals/explorers'
import { CONTENT_SETTINGS } from './content-settings'
import { ECONOMY_SETTINGS } from './economy-settings'
import { isValidSheetId, PAYMENT_SETTINGS } from './payments-settings'
import { TELEGRAM_SETTINGS } from './telegram-settings'
import { CALL_TIME_SETTINGS } from './call-time-settings'
import { SHEETS_SETTINGS } from './sheets-settings'
import { MAP_LEVELS_SETTINGS } from './map-levels-settings'
import { REMINDERS_SETTINGS } from './reminders-settings'
import { CREWS_SETTINGS } from './crews-settings'
import { SITE_SETTINGS } from './site-settings'
import { CALL_UPDATES_SETTINGS } from './call-updates-settings'
import { MEMBERS_SETTINGS } from './members-settings'
import { MARKETING_SETTINGS } from './marketing-settings'
import { ADMIN_ROLE_IDS, DREAD_PIZZA_ROBERTS_ROLE_ID, MISSION_REVIEWER_ROLE_IDS } from '@/app/ui/constants'

export type SettingArea = 'missions' | 'calls' | 'disavow' | 'passport' | 'guide' | 'followups' | 'discord' | 'features' | 'payments' | 'proposals' | 'economy' | 'mafia' | 'telegram' | 'sheets' | 'map' | 'reminders' | 'crews' | 'members' | 'marketing'

/** Admin-only English group names (kept out of messages/*.json: the disavow feature must not leak into them). */
export const AREA_LABELS: Record<SettingArea, string> = {
  missions: 'Missions',
  calls: 'Calls',
  disavow: 'Disavow list',
  passport: 'Pizza Passport',
  guide: 'Handbook facts',
  followups: 'Follow-ups',
  discord: 'Discord channels and roles',
  features: 'Other feature switches',
  payments: 'Payments',
  proposals: 'Proposals',
  economy: 'Economy and spend caps',
  mafia: 'Mafia points and ranks',
  telegram: 'Telegram',
  sheets: 'Google Sheets cutover',
  map: 'Reach map levels',
  reminders: 'Reminders',
  crews: 'Crew rosters',
  members: 'Members',
  marketing: 'Website forms',
}

/** What a reader gets when the stored value cannot be used (DB down, row fails its schema). */
export type FailureMode<T> = { value: T } | 'lastKnownGood' | 'throw'

export type TableColumn =
  | { key: string; label: string; kind: 'text'; maxLength?: number; fixed?: boolean }
  | { key: string; label: string; kind: 'int'; min: number; max: number }

/** How the admin page edits a value. Text-like inputs allow an empty string (= unset). */
export type SettingInput =
  | { type: 'int'; min: number; max: number; unit?: string }
  | { type: 'text'; maxLength: number; multiline?: boolean; placeholder?: string }
  | { type: 'date' }
  | { type: 'url'; maxLength: number }
  | { type: 'bool' }
  /** The role income table: rows of {name, amount, intervalHours, roleId?}; stricter-only (rows can be removed or lowered). */
  | { type: 'roleIncome' }
  /** A list of short strings, edited one per line. */
  | { type: 'stringList'; maxItems: number; maxLength: number }
  /** A list of rows with fixed columns (`fixed`: the cell is shown, not edited; `fixedRows`: rows cannot be added or removed). */
  | { type: 'table'; columns: ReadonlyArray<TableColumn>; maxRows: number; fixedRows?: boolean }
  /** Edited elsewhere (the page only shows whether it is set and links there). */
  | { type: 'managed'; href: string }
  | { type: 'channel'; kind: 'text' | 'voice' }
  | { type: 'role' }
  /** `allowed`: a stricter-only list may only hold ids from this code list (an empty value means the whole list). */
  | { type: 'roleList'; allowed?: readonly string[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SettingDef<T = any> {
  key: string
  area: SettingArea
  /** Admin-only English label and help (the admin page is not translated per setting). */
  label: string
  help: string
  schema: z.ZodType<T>
  default: T
  onReadFailure: FailureMode<T>
  /** Shown in the UI; the schema is the authority. */
  input: SettingInput
  /** Non-null text makes the admin page ask for confirmation before saving. */
  confirm?: (from: T, to: T) => string | null
  /** True when the code bound deliberately stops at today's value (loosening needs a PR). */
  stricterOnly?: boolean
  /** For stricter-only settings: which direction is looser (moving back toward the default asks for confirmation). */
  looserWhen?: 'higher' | 'lower' | 'larger'
  /** Editorial values: only ever sent to the settings page and its API. */
  private?: boolean
}

function intSetting(o: {
  key: string
  area: SettingArea
  label: string
  help: string
  min: number
  max: number
  default: number
  unit?: string
  onReadFailure?: FailureMode<number>
  confirm?: (from: number, to: number) => string | null
  stricterOnly?: boolean
  looserWhen?: 'higher' | 'lower'
}): SettingDef<number> {
  const { min, max } = o
  return {
    key: o.key,
    area: o.area,
    label: o.label,
    help: o.help,
    schema: z.number().int().min(min).max(max),
    default: o.default,
    onReadFailure: o.onReadFailure ?? 'lastKnownGood',
    input: { type: 'int', min, max, ...(o.unit ? { unit: o.unit } : {}) },
    confirm: o.confirm,
    stricterOnly: o.stricterOnly,
    looserWhen: o.looserWhen,
  }
}

const FOOTER_TELEGRAM_DEFAULT = "Replies to this bot aren't read. Use the buttons below to answer, snooze or stop these messages."

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** An ISO-8601 instant with an explicit zone (Z or an offset), or empty (= unset). */
function isoInstantValid(v: string): boolean {
  if (v === '') return true
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return false
  return !Number.isNaN(Date.parse(v))
}

/** One line of calls.endSongCrewMap: `our crew label = pizza-radio crew`. */
export const END_SONG_CREW_LINE = /^([^=\n]{1,60}?)\s*=\s*([^=\n]{1,60})$/
export const END_SONG_CREW_MAP_DEFAULT = ['Ops', 'Tech', 'Comms', 'Biz Dev', 'Events', 'Art', 'Merch', 'Real Estate', 'Governance'].map((c) => `${c} = ${c}`).join('\n')

/** Starter spellings for calls.transcriptionTerms (no personal names; member nicknames are added in the setting). */
export const TRANSCRIPTION_KEYTERMS_DEFAULT = [
  'PizzaDAO', 'RSVPizza', 'Pizza MCP', 'OpenPizza', 'ETHDenver', 'Devcon', 'EthCC', 'Global Pizza Party', 'Bitcoin Pizza Day', 'PEP', 'Metalhead', 'Rare Pizzas',
].join('\n')

/** One line of calls.agendaLinks: `crew-id = Label | https://...`. */
export const AGENDA_LINK_LINE = /^([A-Za-z0-9_-]+)\s*=\s*([^|\n]{1,60}?)\s*\|\s*(https:\/\/\S+)$/

/** One line of calls.liveStreamLinks: `crew-id = https://...` (an X / Twitter link). */
export const LIVE_STREAM_LINE = /^([A-Za-z0-9_-]+)\s*=\s*(https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\S+)$/

/** One role id per line of calls.liveHostRoleIds. */
export const LIVE_HOST_ROLE_LINE = /^\d{15,25}$/

/** One line of calls.attendanceCrewAliases: `from = to` (crew ids). */
export const CREW_ALIAS_LINE = /^([A-Za-z0-9_-]+)\s*=\s*([A-Za-z0-9_-]+)$/

/** One line of calls.crewVoiceChannels: `crew-id = voice channel id`. */
export const CREW_VOICE_CHANNEL_LINE = /^([A-Za-z0-9_-]+)\s*=\s*(\d{15,25})$/

/** One id per line of calls.recordableVoiceChannels. */
export const VOICE_CHANNEL_ID_LINE = /^\d{15,25}$/

/** One Discord user id per line of calls.attendanceExcludeIds. */
export const ATTENDANCE_EXCLUDE_LINE = /^\d{15,25}$/

/** Parse calls.crewVoiceChannels into lower-case crew id -> channel id. Bad lines are skipped. */
export function parseCrewVoiceChannels(raw: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of String(raw ?? '').split('\n')) {
    const m = CREW_VOICE_CHANNEL_LINE.exec(line.trim())
    if (m) out.set(m[1].toLowerCase(), m[2])
  }
  return out
}

/** Parse calls.attendanceCrewAliases into lower-case from -> to. Lines that do not parse, and self-maps, are skipped. */
export function parseCrewAliases(raw: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of String(raw ?? '').split('\n')) {
    const m = CREW_ALIAS_LINE.exec(line.trim())
    if (m && m[1].toLowerCase() !== m[2].toLowerCase()) out.set(m[1].toLowerCase(), m[2].toLowerCase())
  }
  return out
}

export function textSetting(o: {
  key: string
  area: SettingArea
  label: string
  help: string
  maxLength: number
  multiline?: boolean
  default?: string
  placeholder?: string
  /** Extra validation on the trimmed value (runs on write and on read). */
  check?: (value: string) => boolean
  checkMessage?: string
  onReadFailure?: FailureMode<string>
}): SettingDef<string> {
  const base = z.string().trim().max(o.maxLength)
  const check = o.check
  const schema = check ? base.refine(check, o.checkMessage ?? 'Invalid value') : base
  return {
    key: o.key,
    area: o.area,
    label: o.label,
    help: o.help,
    schema,
    default: o.default ?? '',
    onReadFailure: o.onReadFailure ?? { value: o.default ?? '' },
    input: {
      type: 'text',
      maxLength: o.maxLength,
      ...(o.multiline ? { multiline: true } : {}),
      ...(o.placeholder ? { placeholder: o.placeholder } : {}),
    },
  }
}

/** ISO `YYYY-MM-DD` that is a real calendar date, or empty (= unset). */
function dateSetting(o: { key: string; area: SettingArea; label: string; help: string; default?: string }): SettingDef<string> {
  return {
    key: o.key,
    area: o.area,
    label: o.label,
    help: o.help,
    schema: z.string().refine((v) => {
      if (v === '') return true
      if (!ISO_DATE.test(v)) return false
      const d = new Date(`${v}T00:00:00Z`)
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
    }, 'Use a real date as YYYY-MM-DD, or leave empty'),
    default: o.default ?? '',
    onReadFailure: { value: o.default ?? '' },
    input: { type: 'date' },
  }
}

/** https-only URL (no credentials), or empty (= unset, and whatever links to it is hidden). */
function urlSetting(o: { key: string; area: SettingArea; label: string; help: string; default?: string }): SettingDef<string> {
  const maxLength = 300
  return {
    key: o.key,
    area: o.area,
    label: o.label,
    help: o.help,
    schema: z.string().trim().max(maxLength).refine((v) => {
      if (v === '') return true
      try {
        const u = new URL(v)
        return u.protocol === 'https:' && !u.username && !u.password && !!u.hostname
      } catch {
        return false
      }
    }, 'Use a full https:// address, or leave empty').transform((v) => (v === '' ? '' : new URL(v).href)),
    default: o.default ?? '',
    onReadFailure: { value: o.default ?? '' },
    input: { type: 'url', maxLength },
  }
}

/**
 * On/off switch. `default` is the legacy behaviour (what happened before the switch existed);
 * how env interacts is in toggles.ts (env off always wins; env is the fallback while no row exists).
 */
function boolSetting(o: {
  key: string
  area: SettingArea
  label: string
  help: string
  default?: boolean
  /** Text asked before turning it ON (it posts, pays or emails). */
  confirmOn?: string
}): SettingDef<boolean> {
  return {
    key: o.key,
    area: o.area,
    label: o.label,
    help: o.help,
    schema: z.boolean(),
    default: o.default ?? false,
    // Unreadable settings turn anything that posts, pays or emails OFF.
    onReadFailure: { value: false },
    input: { type: 'bool' },
    confirm: o.confirmOn ? (from, to) => (to && !from ? o.confirmOn! : null) : undefined,
  }
}

/** A Discord snowflake. */
export const snowflake = z.string().regex(/^\d{15,25}$/, 'Not a Discord id')
/** A snowflake, or '' meaning "not set here: use the env value, then the code default". */
const optionalSnowflake = z.union([snowflake, z.literal('')])

function channelSetting(o: { key: string; label: string; help: string; kind?: 'text' | 'voice' }): SettingDef<string> {
  return {
    key: o.key,
    area: 'discord',
    label: o.label,
    help: `${o.help} Empty uses the environment value, then the built-in default. Checked against the server when saved.`,
    schema: optionalSnowflake,
    default: '',
    onReadFailure: 'lastKnownGood',
    input: { type: 'channel', kind: o.kind ?? 'text' },
    confirm: (from, to) => (to && to !== from ? 'Messages will go to the new channel from now on.' : null),
  }
}

function roleListSetting(o: {
  key: string
  area: SettingArea
  label: string
  help: string
  confirm?: (from: string[], to: string[]) => string | null
}): SettingDef<string[]> {
  return {
    key: o.key,
    area: o.area,
    label: o.label,
    help: `${o.help} Empty uses the built-in list. Checked against the server when saved.`,
    schema: z.array(snowflake).max(10),
    default: [],
    onReadFailure: 'lastKnownGood',
    input: { type: 'roleList' },
    confirm: o.confirm,
  }
}

/** Reviewer roles for missions L1-L7 in code today (Dread Pizza Roberts is always added in code too). */
export const REVIEWER_ROLE_CODE_LIST: readonly string[] = [...new Set<string>([...ADMIN_ROLE_IDS, ...MISSION_REVIEWER_ROLE_IDS])]

const slaPingRole: SettingDef<string> = {
  key: 'missions.slaPingRoleId',
  area: 'discord',
  label: 'Review digest ping role',
  help: 'The role tagged by the daily review digest. Empty uses the built-in role. Checked against the server when saved.',
  schema: optionalSnowflake,
  default: '',
  onReadFailure: 'lastKnownGood',
  input: { type: 'role' },
}

const proposalsPingRole: SettingDef<string> = {
  key: 'discord.proposalsPingRoleId',
  area: 'discord',
  label: 'Proposals ping role',
  help: 'Optional role tagged when a new proposal is posted in the proposals channel. The intended value at go-live is the Super Voter role, as the Sesh process did. Empty tags nobody (keep it empty during the pilot). Checked against the server when saved.',
  schema: optionalSnowflake,
  default: '',
  onReadFailure: { value: '' },
  input: { type: 'role' },
}

const reviewerRoles: SettingDef<string[]> = {
  key: 'missions.reviewerRoleIds',
  area: 'discord',
  label: 'Mission reviewer roles (levels 1-7)',
  help: 'Roles that may approve missions below the top-role-only level. Can only be narrowed here to a subset of the built-in list; adding a role needs a code change. Dread Pizza Roberts is always included. Empty uses the whole built-in list.',
  schema: z
    .array(snowflake)
    .max(10)
    .refine((ids) => ids.every((id) => REVIEWER_ROLE_CODE_LIST.includes(id)), 'Only roles from the built-in list; adding a role needs a code change'),
  default: [],
  // Unreadable: only the top role approves.
  onReadFailure: { value: [DREAD_PIZZA_ROBERTS_ROLE_ID] },
  input: { type: 'roleList', allowed: REVIEWER_ROLE_CODE_LIST },
  stricterOnly: true,
  looserWhen: 'larger',
  // An empty list means the whole built-in list.
  confirm: (from, to) => {
    const size = (l: string[]) => (l.length === 0 ? REVIEWER_ROLE_CODE_LIST.length : l.length)
    return size(to) < size(from) ? 'Fewer roles will be able to approve missions.' : null
  },
}

export const SETTINGS = {
  'calls.transcriptMinLevel': intSetting({
    key: 'calls.transcriptMinLevel',
    area: 'calls',
    label: 'Call transcript minimum level',
    help: 'Lowest member level that can read the full transcript of a published call. 9 means nobody by level (the review role still can).',
    min: 1,
    max: 9,
    default: 6,
    confirm: (from, to) => (to < from ? 'Lowering this shows full call transcripts to more members.' : null),
  }),
  'calls.summaryMinLevel': intSetting({
    key: 'calls.summaryMinLevel',
    area: 'calls',
    label: 'Call summary minimum level',
    help: 'Lowest member level that can read the summary of a published call. 9 means nobody by level (the review role still can).',
    min: 1,
    max: 9,
    default: 5,
    confirm: (from, to) => (to < from ? 'Lowering this shows call summaries to more members.' : null),
  }),
  'calls.actionItemsMinLevel': intSetting({
    key: 'calls.actionItemsMinLevel',
    area: 'calls',
    label: 'Call action items minimum level',
    help: 'Lowest member level that can read the action items of a published call. 9 means nobody by level (the review role still can).',
    min: 1,
    max: 9,
    default: 4,
    confirm: (from, to) => (to < from ? 'Lowering this shows call action items to more members.' : null),
  }),
  'calls.chaptersMinLevel': intSetting({
    key: 'calls.chaptersMinLevel',
    area: 'calls',
    label: 'Call chapters minimum level',
    help: 'Lowest member level that can read the chapters of a published call. 9 means nobody by level (the review role still can).',
    min: 1,
    max: 9,
    default: 3,
    confirm: (from, to) => (to < from ? 'Lowering this shows call chapters to more members.' : null),
  }),
  'missions.humanReleaseMinLevel': intSetting({
    key: 'missions.humanReleaseMinLevel',
    area: 'missions',
    label: 'Human release from level',
    help: 'Auto-verified passes at or above this level wait for a reviewer instead of paying out. Can only be lowered here; raising it needs a code change.',
    min: 1,
    max: 6,
    default: 6,
    onReadFailure: { value: 1 },
    stricterOnly: true,
    looserWhen: 'higher',
  }),
  'missions.newAccountDays': intSetting({
    key: 'missions.newAccountDays',
    area: 'missions',
    label: 'New Discord account age (days)',
    help: 'Auto-verified passes from Discord accounts younger than this wait for a reviewer. Can only be raised here; lowering it needs a code change.',
    min: 30,
    max: 365,
    default: 30,
    unit: 'days',
    onReadFailure: { value: 365 },
    stricterOnly: true,
    looserWhen: 'lower',
  }),
  'missions.dprOnlyMinLevel': intSetting({
    key: 'missions.dprOnlyMinLevel',
    area: 'missions',
    label: 'Top-role-only approval from level',
    help: 'Missions at or above this level can only be approved by the top review role. Can only be lowered here; raising it needs a code change.',
    min: 2,
    max: 8,
    default: 8,
    onReadFailure: { value: 1 },
    stricterOnly: true,
    looserWhen: 'higher',
    confirm: (from, to) => (to < from ? 'Fewer roles will be able to approve missions at these levels.' : null),
  }),
  'missions.slaHours': intSetting({
    key: 'missions.slaHours',
    area: 'missions',
    label: 'Review target (hours)',
    help: 'A pending submission is overdue, and appears in the daily digest, after this many hours.',
    min: 1,
    max: 336,
    default: 48,
    unit: 'hours',
  }),
  'missions.slaDigestMaxLines': intSetting({
    key: 'missions.slaDigestMaxLines',
    area: 'missions',
    label: 'Daily digest length (lines)',
    help: 'Most overdue items listed in the daily review digest; the rest are counted.',
    min: 1,
    max: 25,
    default: 15,
  }),
  'missions.maxAttempts': intSetting({
    key: 'missions.maxAttempts',
    area: 'missions',
    label: 'Maximum attempts per mission',
    help: 'Rejections before a mission locks until a reviewer steps in.',
    min: 1,
    max: 10,
    default: 3,
  }),
  'disavow.minLevel': intSetting({
    key: 'disavow.minLevel',
    area: 'disavow',
    label: 'Disavow list minimum level',
    help: 'Lowest member level that can view and nominate (the review role always can).',
    min: 1,
    max: 9,
    default: 5,
    confirm: (from, to) => (to < from ? 'Lowering this exposes the list and nominations to more members.' : null),
  }),
  'passport.enabled': intSetting({
    key: 'passport.enabled',
    area: 'passport',
    label: 'Pizza Passport on (1) or off (0)',
    help: 'Shows the passport, accepts check-ins and shows stamps on profiles. Off by default. The PASSPORT_ENABLED=off environment variable forces it off whatever this says.',
    min: 0,
    max: 1,
    default: 0,
    onReadFailure: { value: 0 },
  }),
  'passport.checkInRadiusM': intSetting({
    key: 'passport.checkInRadiusM',
    area: 'passport',
    label: 'Check-in radius (metres)',
    help: 'How close to the venue a check-in must be.',
    min: 25,
    max: 1000,
    default: 150,
    unit: 'm',
  }),
  'passport.maxAccuracyM': intSetting({
    key: 'passport.maxAccuracyM',
    area: 'passport',
    label: 'Worst accepted location accuracy (metres)',
    help: 'A location reading less precise than this is refused.',
    min: 20,
    max: 1000,
    default: 150,
    unit: 'm',
  }),
  'passport.maxNewStampsPerDay': intSetting({
    key: 'passport.maxNewStampsPerDay',
    area: 'passport',
    label: 'New stamps per member per day',
    help: 'Most new stamps one member can collect in 24 hours.',
    min: 1,
    max: 50,
    default: 5,
  }),
  'passport.revisitCooldownHours': intSetting({
    key: 'passport.revisitCooldownHours',
    area: 'passport',
    label: 'Repeat-visit cooldown (hours)',
    help: 'A second check-in at the same venue inside this window does not count as another visit.',
    min: 1,
    max: 168,
    default: 20,
    unit: 'hours',
  }),
  'passport.publicDelayHours': intSetting({
    key: 'passport.publicDelayHours',
    area: 'passport',
    label: 'Public profile delay (hours)',
    help: 'A new stamp shows on the public profile only after this long, so a profile is not a live location feed. Members always see their own stamps at once.',
    min: 0,
    max: 168,
    default: 6,
    unit: 'hours',
  }),
  'passport.maxTravelKmPerHour': intSetting({
    key: 'passport.maxTravelKmPerHour',
    area: 'passport',
    label: 'Impossible-travel speed (km/h)',
    help: 'A check-in farther from the previous one than this speed allows (plus 50 km slack) waits for a reviewer.',
    min: 100,
    max: 1500,
    default: 900,
    unit: 'km/h',
  }),
  // Handbook facts (plans/onboarding-guide.md). Everything defaults to unset, and the handbook text
  // that depends on a value is hidden until an admin fills it in here.
  'guide.discordUrl': urlSetting({
    key: 'guide.discordUrl',
    area: 'guide',
    label: 'Discord invite link',
    help: 'Public invite link shown in Getting started. Empty hides the sentence.',
  }),
  'guide.eventsUrl': urlSetting({
    key: 'guide.eventsUrl',
    area: 'guide',
    label: 'Events site link',
    help: 'Where hosts list their party. Empty hides the sentence.',
  }),
  'guide.gppDate': dateSetting({
    key: 'guide.gppDate',
    area: 'guide',
    label: 'Global Pizza Party date',
    help: 'Next Global Pizza Party date (YYYY-MM-DD). Empty hides the date. Shown formatted for each reader\'s language.',
  }),
  'guide.gppEdition': intSetting({
    key: 'guide.gppEdition',
    area: 'guide',
    label: 'Global Pizza Party edition number',
    help: 'Edition number of the next Global Pizza Party. 0 hides it.',
    min: 0,
    max: 50,
    default: 0,
    onReadFailure: { value: 0 },
  }),
  'guide.hostCapUsd': intSetting({
    key: 'guide.hostCapUsd',
    area: 'guide',
    label: 'Host contribution cap (USD)',
    help: 'Most the DAO contributes per hosted party, shown on Host a party. 0 hides the cap sentence.',
    min: 0,
    max: 100000,
    default: 0,
    unit: 'USD',
    onReadFailure: { value: 0 },
  }),
  'guide.budgetTemplateUrl': urlSetting({
    key: 'guide.budgetTemplateUrl',
    area: 'guide',
    label: 'Event budget template link',
    help: 'Link to the budget spreadsheet hosts copy. Empty hides the link.',
  }),
  'guide.paymentFormUrl': urlSetting({
    key: 'guide.paymentFormUrl',
    area: 'guide',
    label: 'Payment form link',
    help: 'Link to the form hosts use to request reimbursement. Empty hides the link.',
  }),
  'guide.hostPlaybookUrl': urlSetting({
    key: 'guide.hostPlaybookUrl',
    area: 'guide',
    label: 'Host playbook link',
    help: 'Link to the host playbook document. Empty hides the link.',
  }),
  'guide.hashtags': textSetting({
    key: 'guide.hashtags',
    area: 'guide',
    label: 'Hashtags',
    help: 'Hashtags hosts should use when posting. Empty hides the sentence.',
    maxLength: 200,
  }),
  'guide.hostDeadlines': textSetting({
    key: 'guide.hostDeadlines',
    area: 'guide',
    label: 'Host deadlines',
    help: 'Markdown list of this year\'s host deadlines (for example "- Budget submitted: 1 March"). Empty hides the section.',
    maxLength: 1000,
    multiline: true,
  }),
  // ---- BEGIN follow-ups block (metalhead-followups). Kept separate to ease merges. ----
  // Booleans are 0/1 integers (the settings editor has number and text inputs only).
  'followups.sendEnabled': intSetting({
    key: 'followups.sendEnabled',
    area: 'followups',
    label: 'Sending follow-up messages (0 = off, 1 = on)',
    help: 'Master switch. Off by default: approved follow-ups wait and nothing is sent. The FOLLOWUPS_SEND_ENABLED environment variable set to off always wins over this. If settings cannot be read, nothing is sent.',
    min: 0,
    max: 1,
    default: 0,
    onReadFailure: { value: 0 },
    confirm: (from, to) => (to > from ? 'Approved follow-ups will start going out as private messages.' : null),
  }),
  'followups.draftEnabled': intSetting({
    key: 'followups.draftEnabled',
    area: 'followups',
    label: 'Draft follow-ups after each call (0 = off, 1 = on)',
    help: 'When on, every summarized call is scanned once for things worth following up. Drafts only: nothing is sent without an approval click.',
    min: 0,
    max: 1,
    default: 1,
  }),
  'followups.draftCrews': textSetting({
    key: 'followups.draftCrews',
    area: 'followups',
    label: 'Only draft for these crews',
    help: 'Comma-separated crew ids. Empty means every call.',
    maxLength: 300,
    default: '',
    onReadFailure: 'lastKnownGood',
    placeholder: 'crew-id, other-crew-id',
    check: (v) => v === '' || /^[A-Za-z0-9_\-]+(\s*,\s*[A-Za-z0-9_\-]+)*$/.test(v),
    checkMessage: 'Use comma-separated crew ids (letters, digits, - and _)',
  }),
  'followups.replyMinLevel': intSetting({
    key: 'followups.replyMinLevel',
    area: 'followups',
    label: 'Follow-up reply minimum level',
    help: "Lowest member level that can read the text of members' DM replies to follow-ups. Others still see that a reply exists. 9 means nobody by level (the review role still can).",
    min: 1,
    max: 9,
    default: 7,
    onReadFailure: { value: 9 },
    confirm: (from, to) => (to < from ? "Lowering this shows members' follow-up replies to more people." : null),
  }),
  'followups.maxPerDay': intSetting({
    key: 'followups.maxPerDay',
    area: 'followups',
    label: 'Most follow-ups per person per day',
    help: 'Extra approved messages to the same person wait until the 24 hour window has room.',
    min: 1,
    max: 20,
    default: 3,
    onReadFailure: { value: 1 },
  }),
  'followups.quietStartHour': intSetting({
    key: 'followups.quietStartHour',
    area: 'followups',
    label: 'Quiet hours start (local hour, 0-23)',
    help: 'No follow-ups are sent to a person between this hour and the end hour in their own timezone (UTC when unknown).',
    min: 0,
    max: 23,
    default: 21,
    unit: 'h',
  }),
  'followups.quietEndHour': intSetting({
    key: 'followups.quietEndHour',
    area: 'followups',
    label: 'Quiet hours end (local hour, 0-23)',
    help: 'See quiet hours start. Equal start and end hours mean no quiet hours.',
    min: 0,
    max: 23,
    default: 9,
    unit: 'h',
  }),
  'followups.escalationDiscordIds': textSetting({
    key: 'followups.escalationDiscordIds',
    area: 'followups',
    label: 'Escalation contacts (Discord ids)',
    help: 'Comma-separated Discord ids told when someone cannot be reached or asks for help. Empty means the approvers who linked Telegram.',
    maxLength: 400,
    default: '',
    onReadFailure: 'lastKnownGood',
    placeholder: '123456789012345678, 234567890123456789',
    check: (v) => v === '' || /^\d{5,25}(\s*,\s*\d{5,25})*$/.test(v),
    checkMessage: 'Use comma-separated Discord ids (digits only)',
  }),
  'followups.footerTelegram': textSetting({
    key: 'followups.footerTelegram',
    area: 'followups',
    label: 'Footer on Telegram messages',
    help: 'Added under every follow-up sent on Telegram. Replies to the bot are not read, so it must point at the buttons (it cannot ask people to type STOP).',
    maxLength: 200,
    default: FOOTER_TELEGRAM_DEFAULT,
    check: (v) => v.length > 0 && !/\breply\s+stop\b/i.test(v),
    checkMessage: "Typed STOP can't be read on Telegram any more; point at the buttons instead",
    onReadFailure: { value: FOOTER_TELEGRAM_DEFAULT },
  }),
  'followups.footerDiscord': textSetting({
    key: 'followups.footerDiscord',
    area: 'followups',
    label: 'Footer on Discord messages',
    help: 'Added under every follow-up sent as a Discord message (typed replies are not read there, so point at the Stop button).',
    maxLength: 200,
    default: 'Tap Stop to stop these messages.',
    check: (v) => v.length > 0,
    checkMessage: 'The footer cannot be empty',
    onReadFailure: 'lastKnownGood',
  }),
  'followups.maxAlertsPerDay': intSetting({
    key: 'followups.maxAlertsPerDay',
    area: 'followups',
    label: 'Most approver alerts per member per day',
    help: 'Replies and help requests from one member alert the approvers at most this many times in 24 hours (they are still saved in the queue).',
    min: 1,
    max: 50,
    default: 5,
  }),
  'followups.approvalMaxDays': intSetting({
    key: 'followups.approvalMaxDays',
    area: 'followups',
    label: 'Approvals expire after (days)',
    help: 'An approved follow-up that has not gone out after this many days is not sent; it goes back to draft and needs approving again.',
    min: 1,
    max: 60,
    default: 7,
    unit: 'days',
  }),
  'followups.unknownTzStartHour': intSetting({
    key: 'followups.unknownTzStartHour',
    area: 'followups',
    label: 'Sending window start when timezone is unknown (UTC hour)',
    help: 'For people with no known timezone, messages only go out between this UTC hour and the end hour.',
    min: 0,
    max: 23,
    default: 14,
    unit: 'h UTC',
  }),
  'followups.unknownTzEndHour': intSetting({
    key: 'followups.unknownTzEndHour',
    area: 'followups',
    label: 'Sending window end when timezone is unknown (UTC hour)',
    help: 'See the window start.',
    min: 0,
    max: 23,
    default: 22,
    unit: 'h UTC',
  }),
  'followups.linkTtlDays': intSetting({
    key: 'followups.linkTtlDays',
    area: 'followups',
    label: 'Follow-up action links last (days)',
    help: 'How long the Done, On it, Snooze, Need help, Reply and Stop links in Telegram messages keep working.',
    min: 7,
    max: 90,
    default: 30,
    unit: 'days',
  }),
  'followups.snoozeDays': intSetting({
    key: 'followups.snoozeDays',
    area: 'followups',
    label: 'Snooze lasts (days)',
    help: 'When a member taps Snooze on a follow-up, reminders for it wait this long.',
    min: 1,
    max: 14,
    default: 3,
    unit: 'days',
  }),
  // Typed replies to follow-up messages (plans/followup-replies-inbox.md). All off by default.
  'followups.inboundTelegramEnabled': intSetting({
    key: 'followups.inboundTelegramEnabled',
    area: 'followups',
    label: 'Read typed replies on Telegram (0 = off, 1 = on)',
    help: 'When on, the inbound endpoint keeps text that members send to the Telegram bot shortly after a follow-up. Messages that are not tied to a recent follow-up are never stored.',
    min: 0,
    max: 1,
    default: 0,
    onReadFailure: { value: 0 },
    confirm: (from, to) => (to > from ? 'Typed Telegram replies to follow-ups will be saved and shown to the approvers.' : null),
  }),
  'followups.inboundDiscordEnabled': intSetting({
    key: 'followups.inboundDiscordEnabled',
    area: 'followups',
    label: 'Read typed replies on Discord (0 = off, 1 = on)',
    help: 'When on, the inbound endpoint keeps direct messages that members send to the bot shortly after a follow-up. Messages that are not tied to a recent follow-up are never stored.',
    min: 0,
    max: 1,
    default: 0,
    onReadFailure: { value: 0 },
    confirm: (from, to) => (to > from ? 'Typed Discord replies to follow-ups will be saved and shown to the approvers.' : null),
  }),
  'followups.inboundWindowDays': intSetting({
    key: 'followups.inboundWindowDays',
    area: 'followups',
    label: 'Typed replies count for (days)',
    help: 'A typed message is treated as a reply only if the member was sent a follow-up within this many days.',
    min: 1,
    max: 60,
    default: 14,
    unit: 'days',
  }),
  'followups.inboundAckTelegram': textSetting({
    key: 'followups.inboundAckTelegram',
    area: 'followups',
    label: 'Acknowledgement after a typed Telegram reply',
    help: 'Sent back when a typed reply was saved. Empty sends nothing.',
    maxLength: 200,
    default: 'Got it, thanks. I passed this on.',
  }),
  'followups.inboundAckDiscord': textSetting({
    key: 'followups.inboundAckDiscord',
    area: 'followups',
    label: 'Acknowledgement after a typed Discord reply',
    help: 'Sent back when a typed reply was saved. Empty reacts with a check mark instead of replying.',
    maxLength: 200,
    default: '',
  }),
  'followups.replyRetentionDays': intSetting({
    key: 'followups.replyRetentionDays',
    area: 'followups',
    label: 'Keep reply text for (days, 0 = keep)',
    help: 'Reply text older than this is erased from follow-ups (the fact that a reply came in stays).',
    min: 0,
    max: 3650,
    default: 180,
    unit: 'days',
  }),
  // ---- END follow-ups block ----
  // ---- Telegram sending through the shared sender bot (plans/telegram-shared-bot.md). Kept separate to ease merges. ----
  'telegram.dmEnabled': boolSetting({
    key: 'telegram.dmEnabled',
    area: 'telegram',
    label: 'Follow-up DMs over Telegram',
    help: 'Send follow-ups to members who linked Telegram through the shared sender bot, with Discord as the fallback. Also needs "Sending follow-up messages" on. The TELEGRAM_DM_ENABLED env var set to off always wins; previews use the env var only.',
    confirmOn: 'Approved follow-ups will go to members on Telegram when they have started the bot.',
  }),
  'telegram.dmRecheckDays': intSetting({
    key: 'telegram.dmRecheckDays',
    area: 'telegram',
    label: 'First retry after "has not started the bot" (days)',
    help: 'A member who linked Telegram but never started the bot is skipped (Discord is used) and tried again after this many days, doubling after each further miss.',
    min: 1,
    max: 90,
    default: 7,
    unit: 'days',
  }),
  'telegram.dmRecheckMaxDays': intSetting({
    key: 'telegram.dmRecheckMaxDays',
    area: 'telegram',
    label: 'Longest wait between those retries (days)',
    help: 'The doubling stops at this many days.',
    min: 7,
    max: 180,
    default: 60,
    unit: 'days',
  }),
  // ---- END telegram block ----
  // ---- Phase 3: disavow voting rules (a round snapshots its threshold and decision days when it opens) ----
  'disavow.yesThreshold': intSetting({
    key: 'disavow.yesThreshold',
    area: 'disavow',
    label: 'Yes votes needed',
    help: 'Top-role yes votes needed (and more yes than no) to list someone. Can only be raised here; lowering it below 3 needs a code change. Applies to rounds opened from now on; open rounds keep the rule they opened under.',
    min: 3,
    max: 20,
    default: 3,
    stricterOnly: true,
    looserWhen: 'lower',
  }),
  'disavow.decisionDays': intSetting({
    key: 'disavow.decisionDays',
    area: 'disavow',
    label: 'Days before a round can be decided',
    help: 'Nothing is counted until a round has been open this long, so dissent has time to show up. Can only be raised here; shortening it below 7 days needs a code change. Applies to rounds opened from now on. Cannot be longer than the voting window.',
    min: 7,
    max: 30,
    default: 7,
    unit: 'days',
    stricterOnly: true,
    looserWhen: 'lower',
  }),
  'disavow.windowDays': intSetting({
    key: 'disavow.windowDays',
    area: 'disavow',
    label: 'Voting window',
    help: 'A round that has not passed by then fails. Must be at least the decision days. Applies to rounds opened from now on.',
    min: 1,
    max: 60,
    default: 14,
    unit: 'days',
  }),
  'disavow.nominationsPerWindow': intSetting({
    key: 'disavow.nominationsPerWindow',
    area: 'disavow',
    label: 'Nominations per person',
    help: 'Nominations (including duplicates) one person can submit per nomination window.',
    min: 1,
    max: 20,
    default: 3,
  }),
  'disavow.nominationWindowDays': intSetting({
    key: 'disavow.nominationWindowDays',
    area: 'disavow',
    label: 'Nomination window',
    help: 'The rolling window the nominations limit is counted over.',
    min: 1,
    max: 90,
    default: 30,
    unit: 'days',
  }),
  'disavow.listingMonths': intSetting({
    key: 'disavow.listingMonths',
    area: 'disavow',
    label: 'Listing length',
    help: 'How long a listing lasts before it needs a new vote. Applies to listings and re-affirmations from now on.',
    min: 1,
    max: 36,
    default: 12,
    unit: 'months',
  }),
  'disavow.appealCooldownDays': intSetting({
    key: 'disavow.appealCooldownDays',
    area: 'disavow',
    label: 'Appeal cooldown',
    help: 'A listed member can appeal once per this many days.',
    min: 7,
    max: 365,
    default: 90,
    unit: 'days',
  }),

  // ---- Phase 3: feature switches (env stays the fallback and a kill switch: see toggles.ts) ----
  'missions.verifiersEnabled': boolSetting({
    key: 'missions.verifiersEnabled',
    area: 'missions',
    label: 'Automatic mission verification',
    help: 'On: passes are approved and paid automatically (subject to the human-release rules). Off: dry runs only. The MISSION_VERIFIERS_ENABLED env var set to off always wins.',
    confirmOn: 'Verified missions will start paying PEP automatically.',
  }),
  'missions.reviewCardsEnabled': boolSetting({
    key: 'missions.reviewCardsEnabled',
    area: 'missions',
    label: 'Discord review cards',
    help: 'Post review cards, the daily digest and the nightly summary to Discord. The MISSION_REVIEW_CARDS_ENABLED env var set to off always wins.',
  }),
  'calls.recapPostEnabled': boolSetting({
    key: 'calls.recapPostEnabled',
    area: 'calls',
    label: 'Post call recaps',
    help: 'Post the recap to Discord when a call is published. The CALL_RECAP_POST_ENABLED env var set to off always wins.',
    confirmOn: 'Published calls will post a recap to Discord.',
  }),
  'calls.recapMentionPing': boolSetting({
    key: 'calls.recapMentionPing',
    area: 'calls',
    label: 'Ping people mentioned in recaps',
    help: 'On: members named in a call recap (speakers, action-item owners) are @mentioned and notified. Off: they show as clickable names without a notification. The CALL_RECAP_MENTION_PING_ENABLED env var set to off always wins.',
    default: true,
  }),
  'education.sessionAnnounceEnabled': boolSetting({
    key: 'education.sessionAnnounceEnabled',
    area: 'discord',
    label: 'Schedule education sessions from the website',
    help: 'Lets crew leads create the Discord event and post the announcement for an education session. Off: the form only previews the flyer. The EDUCATION_SESSION_ANNOUNCE_ENABLED env var set to off always wins.',
    confirmOn: 'Crew leads can now create Discord events and announcements for education sessions.',
  }),
  'calls.agendaPostEnabled': boolSetting({
    key: 'calls.agendaPostEnabled',
    area: 'calls',
    label: 'Post call agendas',
    help: 'Post the pre-call agenda to Discord. The CALL_AGENDA_POST_ENABLED env var set to off always wins.',
    confirmOn: 'Upcoming calls will get an agenda post in Discord.',
  }),
  'calls.agendaLinks': textSetting({
    key: 'calls.agendaLinks',
    area: 'calls',
    label: 'Agenda links by crew',
    help: 'One per line: crew-id = Label | https link. Replaces the crew page link at the end of that crew\'s agenda.',
    maxLength: 2000,
    multiline: true,
    default: '',
    onReadFailure: 'lastKnownGood',
    placeholder: 'crew-id = Call guide | https://example.com/guide',
    check: (v) => v.split('\n').every((line) => line.trim() === '' || AGENDA_LINK_LINE.test(line.trim())),
    checkMessage: 'Use one line per crew: crew-id = Label | https link',
  }),
  'calls.attendanceExcludeIds': textSetting({
    key: 'calls.attendanceExcludeIds',
    area: 'calls',
    label: 'Accounts left out of attendance',
    help: 'One Discord user id per line (music bots such as the radio or jukebox, other bot accounts). These accounts are not listed or counted in call attendance, the live view, or the minutes. Empty: nobody is left out.',
    maxLength: 2000,
    multiline: true,
    default: '',
    onReadFailure: 'lastKnownGood',
    placeholder: '123456789012345678',
    check: (v) => v.split('\n').every((line) => line.trim() === '' || ATTENDANCE_EXCLUDE_LINE.test(line.trim())),
    checkMessage: 'Use one Discord user id per line (digits only)',
  }),
  'calls.attendanceCrewAliases': textSetting({
    key: 'calls.attendanceCrewAliases',
    area: 'calls',
    label: 'Attendance crew aliases',
    help: 'One per line: recorder crew id = attendance crew id. Recording attendance is stored under the second id, so it matches the sheets and is never counted twice.',
    maxLength: 1000,
    multiline: true,
    default: 'community = community_call',
    onReadFailure: 'lastKnownGood',
    placeholder: 'community = community_call',
    check: (v) => v.split('\n').every((line) => line.trim() === '' || CREW_ALIAS_LINE.test(line.trim())),
    checkMessage: 'Use one line per alias: from-id = to-id',
  }),
  'calls.recordableVoiceChannels': textSetting({
    key: 'calls.recordableVoiceChannels',
    area: 'calls',
    label: 'Recordable voice channels',
    help: 'One voice channel id per line. The recorder joins a call only in these channels (and the default call channel, which is always allowed). Empty: the default channel only.',
    maxLength: 1000,
    multiline: true,
    default: '',
    onReadFailure: 'lastKnownGood',
    placeholder: '123456789012345678',
    check: (v) => v.split('\n').every((line) => line.trim() === '' || VOICE_CHANNEL_ID_LINE.test(line.trim())),
    checkMessage: 'Use one channel id per line (digits only)',
  }),
  'calls.crewVoiceChannels': textSetting({
    key: 'calls.crewVoiceChannels',
    area: 'calls',
    label: 'Crew voice channels',
    help: 'One per line: crew id = voice channel id. For a crew whose Discord event has no channel of its own, the recorder joins this channel (it must also be in the recordable channels). An event that has a voice channel always uses that channel.',
    maxLength: 1000,
    multiline: true,
    default: '',
    onReadFailure: 'lastKnownGood',
    placeholder: 'latam = 123456789012345678',
    check: (v) => v.split('\n').every((line) => line.trim() === '' || CREW_VOICE_CHANNEL_LINE.test(line.trim())),
    checkMessage: 'Use one line per crew: crew-id = channel id',
  }),
  'calls.attendanceMinMinutes': intSetting({
    key: 'calls.attendanceMinMinutes',
    area: 'calls',
    label: 'Attendance: minutes in the call to count',
    help: 'A person must be in the voice channel this many minutes (added up over the whole call, across split recordings) to be counted from a recording. 0 counts anyone seen. Recordings made before presence was measured keep the old rule (anyone seen counts).',
    min: 0,
    max: 120,
    default: 5,
    unit: 'minutes',
    onReadFailure: { value: 5 },
  }),
  'calls.attendanceShortCallPercent': intSetting({
    key: 'calls.attendanceShortCallPercent',
    area: 'calls',
    label: 'Attendance: share of a short call to count',
    help: 'When the whole call (all recordings of that crew and day) is shorter than twice the minutes above, the threshold becomes this percent of the call length instead. 0 counts anyone seen on short calls.',
    min: 0,
    max: 100,
    default: 50,
    unit: '%',
    onReadFailure: { value: 50 },
  }),
  'calls.attendanceSpeakersAlwaysCount': boolSetting({
    key: 'calls.attendanceSpeakersAlwaysCount',
    area: 'calls',
    label: 'Attendance: speakers always count',
    help: 'Anyone with talk time in the recording counts as present, however few minutes they were in the channel.',
    default: true,
  }),
  // Metalhead call features (plans/metalhead-call-features.md). All off: the recorder keeps today's behaviour.
  'calls.welcomeEnabled': boolSetting({
    key: 'calls.welcomeEnabled',
    area: 'calls',
    label: 'Welcome members to calls',
    help: 'The recorder greets people who join a call with one batched, friendly message that includes the short recording line, in place of the late-joiner welcome. The full recording notice still opens every recorded call. The CALL_WELCOME_ENABLED env var set to off always wins; on preview deploys only the env var counts. Takes effect for the next recorded call.',
    confirmOn: 'The recorder will post welcome messages in the call voice channel chat.',
  }),
  'calls.welcomeTemplate': textSetting({
    key: 'calls.welcomeTemplate',
    area: 'calls',
    label: 'Welcome message',
    help: 'Use {members} (the mentions of the people joining) and {call} (the crew or event name). Both are required.',
    maxLength: 300,
    default: 'Welcome {members} to the {call} 🍕',
    check: (v) => v.includes('{members}') && v.includes('{call}'),
    checkMessage: 'Must contain both {members} and {call}',
  }),
  'calls.welcomeBatchSeconds': intSetting({
    key: 'calls.welcomeBatchSeconds',
    area: 'calls',
    label: 'Welcome batching window',
    help: 'People who join within this many seconds of each other get one welcome message.',
    min: 5,
    max: 120,
    default: 20,
    unit: 'seconds',
  }),
  'calls.recordingLine': textSetting({
    key: 'calls.recordingLine',
    area: 'calls',
    label: 'Recording line in welcomes',
    help: 'The short recording notice added to every welcome message. Cannot be empty: people must always be told the call is recorded.',
    maxLength: 300,
    default: "🔴 This call is recorded and transcribed; audio stays private. Leave the call if you'd rather not be recorded.",
    check: (v) => v.length > 0,
    checkMessage: 'The recording line cannot be empty',
  }),
  'calls.startNotice': textSetting({
    key: 'calls.startNotice',
    area: 'calls',
    label: 'Start-of-call notice',
    help: 'Posted in the voice channel chat when the recorder starts a call. Empty posts nothing. Mentions (@everyone, @here, roles) are stripped.',
    maxLength: 500,
    multiline: true,
    default: '',
  }),
  'calls.endSongTriggerEnabled': boolSetting({
    key: 'calls.endSongTriggerEnabled',
    area: 'calls',
    label: 'End-of-call song from the recorder',
    help: 'When a recorded call really ends (the Discord event ends or the recording hits its time limit) with people still in the channel, the recorder asks the pizza-radio bot to play the crew song. Metalhead never plays audio itself. Also needs PIZZA_RADIO_URL and PIZZA_RADIO_API_KEY on the recorder. Turn the old Apps Script timer off after the first verified call so the song does not play twice. The CALL_END_SONG_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Pizza-radio will play the crew song when a recorded call ends. Disable the Apps Script song timer to avoid a double play.',
  }),
  'calls.endSongMinHumans': intSetting({
    key: 'calls.endSongMinHumans',
    area: 'calls',
    label: 'People needed for the end song',
    help: 'Play the song only if at least this many people are still in the call channel when it ends.',
    min: 1,
    max: 50,
    default: 1,
    unit: 'people',
  }),
  'calls.playOutCommandEnabled': boolSetting({
    key: 'calls.playOutCommandEnabled',
    area: 'calls',
    label: 'Spoken "play us out" command',
    help: 'Lets a crew lead or admin say "That\'s the end of the call, Metalhead, play the song" (also "play us out") and the recorder asks pizza-radio to play the crew song right away, at most once per call. Replaces the automatic end-of-call song for that call. Needs the end-of-call song switch on, the crew in its crew map, and a live recorder. Short speech from allowed speakers is transcribed on the side (about 1 cent per call). The CALL_PLAY_OUT_COMMAND_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Metalhead will play the crew song when an allowed member asks for it out loud.',
  }),
  'calls.playOutAnyMember': boolSetting({
    key: 'calls.playOutAnyMember',
    area: 'calls',
    label: 'Play-out command: any member may give it',
    help: 'Off (default): only crew leads of the call\'s crew and guild admins can ask Metalhead to play the song. On: any signed-up member in the call can.',
  }),
  'calls.startBandEnabled': boolSetting({
    key: 'calls.startBandEnabled',
    area: 'calls',
    label: 'House band at call start',
    help: 'When a recorded call from the list below starts (at its scheduled start, or when recording begins if that is later), the recorder asks the pizza-radio bot to play the house band in the call channel. Metalhead never plays audio itself. Also needs PIZZA_RADIO_URL and PIZZA_RADIO_API_KEY on the recorder. Plays once per call; a recorder restart does not replay it. The CALL_START_BAND_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Pizza-radio will play the house band when a listed call starts.',
  }),
  'calls.startBandCalls': textSetting({
    key: 'calls.startBandCalls',
    area: 'calls',
    label: 'House band: calls',
    help: 'One call name per line. A line matches a Discord event whose name contains it (any case, extra spaces ignored, so "Community Call" also matches "Community Call (Recorded)" or a dated name), or a crew whose label is exactly that. Only these calls get the house band.',
    maxLength: 1000,
    multiline: true,
    default: 'Community Call',
    onReadFailure: 'lastKnownGood',
    placeholder: 'Community Call',
  }),
  'calls.transcriptionTerms': textSetting({
    key: 'calls.transcriptionTerms',
    area: 'calls',
    label: 'Transcription: spellings to prefer',
    help: 'One term per line (conference names, community lingo, nicknames). Sent to Deepgram as keyterms when a call is transcribed, and given to the summary as spellings to prefer. At most 100 terms, 40 characters each, about 1000 characters in all (Deepgram allows 500 tokens per request); extra or longer lines are ignored. Applies to calls recorded after the recorder next reads its settings (within about 5 minutes).',
    maxLength: 2000,
    multiline: true,
    default: TRANSCRIPTION_KEYTERMS_DEFAULT,
    onReadFailure: 'lastKnownGood',
    placeholder: 'ETHDenver',
  }),
  'calls.startBandMaxSongs': intSetting({
    key: 'calls.startBandMaxSongs',
    area: 'calls',
    label: 'House band: songs',
    help: 'Pizza-radio leaves the call channel after the house band has played this many songs.',
    min: 1,
    max: 10,
    default: 1,
    unit: 'songs',
  }),
  'calls.supersedeMaxDeferMinutes': intSetting({
    key: 'calls.supersedeMaxDeferMinutes',
    area: 'calls',
    label: 'Keep recording a call that runs over',
    help: "When the next crew's call is due but most people in the channel were just talking in the current one, keep recording the current call for up to this long before starting the next recording. 0 switches right at the next start.",
    min: 0,
    max: 120,
    default: 30,
    unit: 'minutes',
  }),
  'calls.dstFixEnabled': boolSetting({
    key: 'calls.dstFixEnabled',
    area: 'calls',
    label: 'Fix crew call times after a clock change',
    help: 'Every 6 hours, compares each event in "Crew call local times" with its next start and moves the Discord event when daylight saving shifted it. Events already running are retried later; shifts over the limit below are reported, never applied. While "dry run" (next setting) is on it only logs what it would change. The CALL_DST_FIX_ENABLED env var set to off always wins; preview deploys never change events.',
    confirmOn: 'This lets the app change the start time of Discord scheduled events (when dry run is also off).',
  }),
  'calls.dstFixDryRun': {
    ...boolSetting({
      key: 'calls.dstFixDryRun',
      area: 'calls',
      label: 'Crew call time fix: dry run',
      help: 'On: the fix only logs and reports what it would change. Turn off to let it patch Discord events (and also switch the fix on).',
      default: true,
    }),
    // Unreadable settings keep dry run ON.
    onReadFailure: { value: true },
  },
  'calls.dstFixMaxShiftMinutes': intSetting({
    key: 'calls.dstFixMaxShiftMinutes',
    area: 'calls',
    label: 'Crew call time fix: largest shift',
    help: 'An event whose next start differs from its intended local time by more than this is reported and left alone (someone probably moved it on purpose, or the row is wrong).',
    min: 15,
    max: 180,
    default: 120,
    unit: 'minutes',
  }),
  'calls.endSongCrewMap': textSetting({
    key: 'calls.endSongCrewMap',
    area: 'calls',
    label: 'End song: crew names',
    help: 'One per line: our crew label = pizza-radio crew name. Only crews listed here get an end-of-call song. Pizza-radio knows: Amore, Art, Biz Dev, Comms, Events, Finance, Governance, Mafia, Merch, Ops, Real Estate, Tech.',
    maxLength: 1000,
    multiline: true,
    default: END_SONG_CREW_MAP_DEFAULT,
    onReadFailure: 'lastKnownGood',
    placeholder: 'Ops = Ops',
    check: (v) => v.split('\n').every((line) => line.trim() === '' || END_SONG_CREW_LINE.test(line.trim())),
    checkMessage: 'Use one line per crew: our crew label = radio crew',
  }),
  // "We're live" announcements (app/lib/calls/live-announce.ts). All off by default; previews never post.
  'calls.liveAnnounceCommandEnabled': boolSetting({
    key: 'calls.liveAnnounceCommandEnabled',
    area: 'calls',
    label: '/live command',
    help: 'Lets hosts, admins and the live host roles run /live: it posts the "we\'re live" message in the channel below and queues the Telegram posts, once per call. The command must also be registered with Discord. The CALL_LIVE_ANNOUNCE_COMMAND_ENABLED env var set to off always wins; on preview deploys only the env var counts and nothing is ever posted.',
    confirmOn: '/live will post a "we\'re live" message in the announcements channel and queue Telegram posts.',
  }),
  'calls.liveAnnounceAutoEnabled': boolSetting({
    key: 'calls.liveAnnounceAutoEnabled',
    area: 'calls',
    label: 'Announce automatically when the Community Call starts recording',
    help: 'When the recorder starts on the Community Call, post the "we\'re live" Discord message and queue the Telegram posts by itself (once per call, no stream link unless one was set; /live can add it later). Needs the live call view (calls.liveViewEnabled) on, because it rides on the live heartbeat of the recorder. The CALL_LIVE_ANNOUNCE_AUTO_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'The Community Call will announce itself in Discord and Telegram as soon as recording starts.',
  }),
  'calls.liveReminderEnabled': boolSetting({
    key: 'calls.liveReminderEnabled',
    area: 'calls',
    label: 'Live reminder on Telegram',
    help: 'A few minutes after the announcement, a second Telegram nudge goes to the reminder groups below (once per call). The CALL_LIVE_REMINDER_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'A second "the call is live" nudge will go to the Telegram groups a few minutes after each announcement.',
  }),
  'calls.liveReminderMinutes': intSetting({
    key: 'calls.liveReminderMinutes',
    area: 'calls',
    label: 'Live reminder: minutes after the announcement',
    help: 'How long after the "we\'re live" announcement the Telegram reminder is queued.',
    min: 1,
    max: 30,
    default: 3,
    unit: 'minutes',
  }),
  'calls.liveAnnounceChannelId': channelSetting({
    key: 'calls.liveAnnounceChannelId',
    label: 'Live announcement channel',
    help: 'Where the "we\'re live" message is posted (the announcements or general channel). Nothing is posted to Discord while this is empty.',
  }),
  'calls.liveAnnounceEveryone': boolSetting({
    key: 'calls.liveAnnounceEveryone',
    area: 'calls',
    label: 'Live announcement pings @everyone',
    help: 'Adds @everyone to the Discord "we\'re live" message. Off by default.',
    confirmOn: 'Every live announcement will ping @everyone.',
  }),
  'calls.liveAnnounceDiscordTemplate': textSetting({
    key: 'calls.liveAnnounceDiscordTemplate',
    area: 'calls',
    label: 'Live announcement: Discord message',
    help: 'Placeholders: {eventLink} {voiceChannel} {streamLink} {date}. Wrap an optional part in [[ ]]; it is dropped when a placeholder inside it is empty (for example [[Also streaming: {streamLink}]]).',
    maxLength: 1500,
    multiline: true,
    default: "🍕🤙 We're live! Our community call is starting now.\nJoin: {eventLink}\nVoice: {voiceChannel}[[\nAlso streaming: {streamLink}]]",
  }),
  'calls.liveAnnounceTelegramTemplate': textSetting({
    key: 'calls.liveAnnounceTelegramTemplate',
    area: 'calls',
    label: 'Live announcement: Telegram post',
    help: 'Placeholders: {eventLink} {voiceChannel} {streamLink} {date}. [[optional parts]] as above. Plain text only (no mentions or formatting).',
    maxLength: 1500,
    multiline: true,
    default: "🍕🤙 We're live! Our community call is starting now. Join: {eventLink}[[ Also streaming: {streamLink}]]",
  }),
  'calls.liveAnnounceXTemplate': textSetting({
    key: 'calls.liveAnnounceXTemplate',
    area: 'calls',
    label: 'Live announcement: X post text',
    help: 'Shown to the host after /live, ready to copy (nothing is posted to X). Placeholders: {eventLink} {voiceChannel} {streamLink} {date}. [[optional parts]] as above.',
    maxLength: 600,
    multiline: true,
    default: "🍕🤙 We're live on {eventLink} for our community call![[ Also streaming: {streamLink}]]",
  }),
  'calls.liveReminderTemplate': textSetting({
    key: 'calls.liveReminderTemplate',
    area: 'calls',
    label: 'Live reminder: Telegram post',
    help: 'Placeholders: {eventLink} {voiceChannel} {streamLink} {date}. [[optional parts]] as above.',
    maxLength: 1500,
    multiline: true,
    default: 'Community Call is live now. Join: {eventLink}[[ Also streaming: {streamLink}]]',
  }),
  'calls.liveTelegramCityKeys': {
    key: 'calls.liveTelegramCityKeys',
    area: 'calls',
    label: 'Live announcement: Telegram groups',
    help: 'City keys (one per line, as in the city directory) of the Telegram groups, including the hosts chat, that get the "we\'re live" post. Empty falls back to the Community Call announcement groups.',
    schema: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9 .'-]{2,80}$/, 'Not a valid city key')).max(30),
    default: [] as string[],
    onReadFailure: { value: [] as string[] },
    input: { type: 'stringList', maxItems: 30, maxLength: 80 },
  } as SettingDef<string[]>,
  'calls.liveRandomCityKeys': {
    key: 'calls.liveRandomCityKeys',
    area: 'calls',
    label: 'Live announcement: random city pool',
    help: 'City keys (one per line) of Telegram groups. Each "we\'re live" announcement also goes to ONE group picked at random from this list, on top of the fixed groups above. Empty = no random group.',
    schema: z.array(z.string().trim().toLowerCase().min(1).max(80).regex(/^[^\p{Cc}\p{Cf}]+$/u, 'Not a valid city key')).max(1000),
    default: [] as string[],
    onReadFailure: { value: [] as string[] },
    input: { type: 'stringList', maxItems: 1000, maxLength: 80 },
  } as SettingDef<string[]>,
  'calls.liveRandomCityNoRepeat': intSetting({
    key: 'calls.liveRandomCityNoRepeat',
    area: 'calls',
    label: 'Random city: no repeat for the last N calls',
    help: 'The random group is never one of the groups picked for the last N calls (as far as the pool allows). 0 allows repeats.',
    min: 0,
    max: 50,
    default: 4,
    unit: 'calls',
  }),
  'calls.liveStreamAskChannelId': channelSetting({
    key: 'calls.liveStreamAskChannelId',
    label: 'Stream link ask: channel',
    help: 'When the automatic "we\'re live" announcement posts, one short message asking the hosts to run /live with the X stream link is posted here (the hosts channel). Empty = off.',
  }),
  'calls.liveStreamAskTemplate': textSetting({
    key: 'calls.liveStreamAskTemplate',
    area: 'calls',
    label: 'Stream link ask: message',
    help: 'The message posted in the stream link ask channel after an automatic announcement.',
    maxLength: 500,
    multiline: true,
    default: '📡 The Community Call is live. Going live on X? Run /live and paste the stream link.',
  }),
  'calls.liveReminderCityKeys': {
    key: 'calls.liveReminderCityKeys',
    area: 'calls',
    label: 'Live reminder: Telegram groups',
    help: 'City keys (one per line) of the Telegram groups, including the hosts chat, that get the reminder. Empty uses the groups of the live announcement.',
    schema: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9 .'-]{2,80}$/, 'Not a valid city key')).max(30),
    default: [] as string[],
    onReadFailure: { value: [] as string[] },
    input: { type: 'stringList', maxItems: 30, maxLength: 80 },
  } as SettingDef<string[]>,
  'calls.progressReportEnabled': boolSetting({
    key: 'calls.progressReportEnabled',
    area: 'calls',
    label: '/progress command',
    help: 'Lets anyone in the server run /progress in a channel: it posts the crew\'s last call action items and open tasks as a public message (the crew is the option, else the call in progress). Uses the same private post filter as agendas. The command must also be registered with Discord. The CALL_PROGRESS_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: '/progress will post crew action items and tasks publicly in the channel where it is used.',
  }),
  'calls.progressMaxItems': intSetting({
    key: 'calls.progressMaxItems',
    area: 'calls',
    label: '/progress items per section',
    help: 'Most last-call action items, and most open tasks, shown in one /progress report.',
    min: 3,
    max: 15,
    default: 8,
    unit: 'items',
  }),
  'calls.progressShowFollowups': boolSetting({
    key: 'calls.progressShowFollowups',
    area: 'calls',
    label: 'Show follow-up status in /progress',
    help: 'Add a status icon (done, in progress, needs help) to each action item that has a follow-up. Only the icon is shown, never the message text or replies. The CALL_PROGRESS_FOLLOWUPS_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: '/progress will show who is done, in progress or needs help on last call\'s action items.',
  }),
  // Action items confirmed during the call (plans/post-call-agenda-updates.md, options A and C). All off.
  'calls.liveActionItemsEnabled': boolSetting({
    key: 'calls.liveActionItemsEnabled',
    area: 'calls',
    label: 'Confirm spoken action items during calls',
    help: 'While a call is recorded, the recorder sends the new speech every few minutes; the app transcribes it, looks for new action items and Metalhead confirms them in the call chat ("Action item recorded: ..."). Only crews in "Live action items: crews" take part. Uses the private post filter: items with a blocked term and excluded crews are never posted. Costs extra transcription and model calls. The CALL_LIVE_ACTION_ITEMS_ENABLED env var set to off always wins; on preview deploys only the env var counts. Takes effect for the next recorded call.',
    confirmOn: 'Metalhead will post machine-detected action items in the call chat during calls, before any review.',
  }),
  'calls.chatActionItemsEnabled': boolSetting({
    key: 'calls.chatActionItemsEnabled',
    area: 'calls',
    label: 'Confirm typed action items during calls',
    help: 'A message in the call chat that starts with one of the prefixes ("action: ...") gets an instant confirmation from Metalhead and goes into the call\'s action items. Only crews in "Live action items: crews" take part; the private post filter applies. No model cost. The CALL_CHAT_ACTION_ITEMS_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Metalhead will reply in the call chat to messages that start with an action item prefix.',
  }),
  'calls.liveActionItemsCrews': textSetting({
    key: 'calls.liveActionItemsCrews',
    area: 'calls',
    label: 'Live action items: crews',
    help: 'Comma-separated crew ids that get live action items (spoken and typed). Empty means none, so the switches alone do nothing.',
    maxLength: 300,
    default: '',
    onReadFailure: { value: '' },
    placeholder: 'crew-id, other-crew-id',
    check: (v) => v === '' || /^[A-Za-z0-9_\-]+(\s*,\s*[A-Za-z0-9_\-]+)*$/.test(v),
    checkMessage: 'Use comma-separated crew ids (letters, digits, - and _)',
  }),
  'calls.liveChunkSeconds': intSetting({
    key: 'calls.liveChunkSeconds',
    area: 'calls',
    label: 'Live action items: check every',
    help: 'How often the recorder sends new speech. Shorter is faster but costs a little more (more model calls; speech is transcribed once either way). Items appear about half this long after they are said, plus 10 to 30 seconds. Below 90 seconds, also raise "most checks per call".',
    min: 30,
    max: 600,
    default: 150,
    unit: 'seconds',
  }),
  'calls.liveWindowMinutes': intSetting({
    key: 'calls.liveWindowMinutes',
    area: 'calls',
    label: 'Live action items: context window',
    help: 'Minutes of recent speech the model reads at each check (the new speech plus what came just before it).',
    min: 3,
    max: 20,
    default: 8,
    unit: 'minutes',
  }),
  'calls.liveActionItemsMaxPerCall': intSetting({
    key: 'calls.liveActionItemsMaxPerCall',
    area: 'calls',
    label: 'Live action items: most posted per call',
    help: 'After this many confirmations in one call Metalhead stays quiet; later items still go into the call notes.',
    min: 1,
    max: 30,
    default: 10,
    unit: 'items',
  }),
  'calls.liveMaxChunksPerCall': intSetting({
    key: 'calls.liveMaxChunksPerCall',
    area: 'calls',
    label: 'Live action items: most checks per call',
    help: 'Cost cap: after this many speech checks in one call, later speech is not transcribed live (the post-call summary still covers it).',
    min: 1,
    max: 200,
    default: 40,
    unit: 'checks',
  }),
  'calls.liveMaxAudioMinutesPerCall': intSetting({
    key: 'calls.liveMaxAudioMinutesPerCall',
    area: 'calls',
    label: 'Live action items: most speech per call',
    help: 'Cost cap: minutes of speech (all speakers together) transcribed live per call.',
    min: 5,
    max: 600,
    default: 120,
    unit: 'minutes',
  }),
  // Live call view (plans/live-call-view-and-attendance.md, PR 4 and 5).
  'calls.liveViewEnabled': boolSetting({
    key: 'calls.liveViewEnabled',
    area: 'calls',
    label: 'Live call view',
    help: 'Turns on the live-state endpoint the recorder reports to and the /calls/live page with its banners. Everyone sees the title, crew, start time, stream link and head count; signed-in members also see who is present. The CALL_LIVE_VIEW_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Anyone can see which crew call is live and how many people are in it. Signed-in members see who is present.',
  }),
  'calls.liveStreamLinks': textSetting({
    key: 'calls.liveStreamLinks',
    area: 'calls',
    label: 'Live stream links by crew',
    help: 'One per line: crew-id = https link on x.com. Used when nobody posts a stream link in the call chat. A broadcast or status link posted in the call chat during the call wins.',
    maxLength: 2000,
    multiline: true,
    default: '',
    onReadFailure: 'lastKnownGood',
    placeholder: 'community_call = https://x.com/i/broadcasts/...',
    check: (v) => v.split('\n').every((line) => line.trim() === '' || LIVE_STREAM_LINE.test(line.trim())),
    checkMessage: 'Use one line per crew: crew-id = https link on x.com',
  }),
  'calls.livePushSeconds': intSetting({
    key: 'calls.livePushSeconds',
    area: 'calls',
    label: 'Live view: recorder heartbeat',
    help: 'How often the recorder reports the live state of a call (it also reports right away when someone joins or leaves). Takes effect for the next recorded call.',
    min: 10,
    max: 120,
    default: 20,
    unit: 'seconds',
  }),
  'calls.liveStaleSeconds': intSetting({
    key: 'calls.liveStaleSeconds',
    area: 'calls',
    label: 'Live view: stale after',
    help: 'A call with no heartbeat for this long no longer shows as live (a recorder crash).',
    min: 30,
    max: 600,
    default: 120,
    unit: 'seconds',
  }),
  'calls.liveHostRoleIds': textSetting({
    key: 'calls.liveHostRoleIds',
    area: 'calls',
    label: 'Live view: host roles',
    help: 'One Discord role id per line. Members with one of these roles (and Dread Pizza Roberts) can moderate the live Q&A and run live polls. Whoever started the call is not a host by default. Empty means Dread Pizza Roberts only.',
    maxLength: 500,
    multiline: true,
    default: '',
    onReadFailure: { value: '' },
    placeholder: '123456789012345678',
    check: (v) => v.split('\n').every((line) => line.trim() === '' || LIVE_HOST_ROLE_LINE.test(line.trim())),
    checkMessage: 'Use one numeric role id per line',
  }),
  'calls.liveQuestionMaxPerMember': intSetting({
    key: 'calls.liveQuestionMaxPerMember',
    area: 'calls',
    label: 'Live Q&A: most questions per member',
    help: 'How many questions one member can ask during one call.',
    min: 1,
    max: 50,
    default: 5,
    unit: 'questions',
  }),
  'calls.liveQuestionMinGapSeconds': intSetting({
    key: 'calls.liveQuestionMinGapSeconds',
    area: 'calls',
    label: 'Live Q&A: pause between questions',
    help: 'A member must wait this long between two questions.',
    min: 0,
    max: 600,
    default: 20,
    unit: 'seconds',
  }),
  'calls.livePollSeconds': intSetting({
    key: 'calls.livePollSeconds',
    area: 'calls',
    label: 'Live view: page refresh',
    help: 'How often the /calls/live page asks for updates while the tab is visible.',
    min: 5,
    max: 60,
    default: 10,
    unit: 'seconds',
  }),
  'calls.liveItemsRetentionDays': intSetting({
    key: 'calls.liveItemsRetentionDays',
    area: 'calls',
    label: 'Live action items: keep for',
    help: 'Stored live items are deleted after this many days (they are already merged into the call\'s action items), and right away when the call is rejected.',
    min: 1,
    max: 365,
    default: 30,
    unit: 'days',
  }),
  'calls.chatActionPrefixes': textSetting({
    key: 'calls.chatActionPrefixes',
    area: 'calls',
    label: 'Typed action item prefixes',
    help: 'Comma-separated. A call chat message that starts with one of these (any case) is an action item.',
    maxLength: 120,
    default: 'action:, ai:, todo:',
    onReadFailure: 'lastKnownGood',
    check: (v) => v.split(',').every((p) => p.trim().length >= 2 && p.trim().length <= 20),
    checkMessage: 'Use comma-separated prefixes of 2 to 20 characters',
  }),
  'calls.liveActionItemsModel': textSetting({
    key: 'calls.liveActionItemsModel',
    area: 'calls',
    label: 'Live action items: model',
    help: 'AI Gateway model id (provider/model) for the live check. Empty uses the summary model. A small model keeps the cost down.',
    maxLength: 80,
    default: '',
    onReadFailure: 'lastKnownGood',
    placeholder: 'provider/model',
    check: (v) => v === '' || /^[a-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(v),
    checkMessage: 'Use a provider/model id',
  }),
  'calls.liveActionItemNote': textSetting({
    key: 'calls.liveActionItemNote',
    area: 'calls',
    label: 'Live action items: what happens next',
    help: 'Small line under each confirmation saying what Metalhead will do with it. Empty leaves it out.',
    maxLength: 120,
    default: 'Added to the call notes for review.',
    onReadFailure: 'lastKnownGood',
  }),
  // Proposed crew task updates after a call (plans/post-call-agenda-updates.md, ask 2). All off.
  'calls.taskProposalsEnabled': boolSetting({
    key: 'calls.taskProposalsEnabled',
    area: 'calls',
    label: 'Propose crew task updates after calls',
    help: 'After a call is summarized, a separate model pass compares what was said with the crew\'s tasks and proposes changes (new task, stage, priority, lead, done, retire). Nothing changes until a crew lead or admin clicks Apply. Only crews in "Task proposals: crews" take part; hidden speakers and lines never reach the model. Costs one extra model call per call. The CALL_TASK_PROPOSALS_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Every summarized call of the listed crews will get one extra model pass that proposes task changes for the crew leads to review.',
  }),
  'calls.taskProposalsCrews': textSetting({
    key: 'calls.taskProposalsCrews',
    area: 'calls',
    label: 'Task proposals: crews',
    help: 'Comma-separated crew ids that get task proposals. Empty means none, so the switch alone does nothing. The crew\'s tasks must already be edited on the website.',
    maxLength: 300,
    default: '',
    onReadFailure: { value: '' },
    placeholder: 'crew-id, other-crew-id',
    check: (v) => v === '' || /^[A-Za-z0-9_\-]+(\s*,\s*[A-Za-z0-9_\-]+)*$/.test(v),
    checkMessage: 'Use comma-separated crew ids (letters, digits, - and _)',
  }),
  'calls.taskProposalsMaxPerCall': intSetting({
    key: 'calls.taskProposalsMaxPerCall',
    area: 'calls',
    label: 'Task proposals: most per call',
    help: 'Cap on proposals kept from one call.',
    min: 1,
    max: 40,
    default: 15,
    unit: 'proposals',
  }),
  'calls.taskProposalMaxDays': intSetting({
    key: 'calls.taskProposalMaxDays',
    area: 'calls',
    label: 'Task proposals: expire after',
    help: 'Proposals nobody decided on become stale after this many days and can no longer be applied.',
    min: 1,
    max: 90,
    default: 14,
    unit: 'days',
  }),
  'calls.taskProposalsModel': textSetting({
    key: 'calls.taskProposalsModel',
    area: 'calls',
    label: 'Task proposals: model',
    help: 'AI Gateway model id (provider/model) for the proposal pass. Empty uses the summary model.',
    maxLength: 80,
    default: '',
    onReadFailure: 'lastKnownGood',
    placeholder: 'provider/model',
    check: (v) => v === '' || /^[a-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(v),
    checkMessage: 'Use a provider/model id',
  }),
  'calls.taskProposalsNudgeEnabled': boolSetting({
    key: 'calls.taskProposalsNudgeEnabled',
    area: 'calls',
    label: 'Nudge the crew channel about waiting proposals',
    help: 'When proposals are waiting after a call, Metalhead posts one short line in the crew\'s Discord channel with a link to the crew page (a count only, never the proposals). Uses the private post filter: excluded crews get no post. The CALL_TASK_PROPOSALS_NUDGE_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Metalhead will post in the crew channel when task proposals from a call are waiting for review.',
  }),
  // Vouching and levels made easier (plans/metalhead-call-features.md, phase C). All off.
  'vouches.dailyLimit': intSetting({
    key: 'vouches.dailyLimit',
    area: 'features',
    label: 'Vouches per member per day',
    help: 'Most vouches one member can give in a rolling 24 hours, on the website and in Discord alike. The default is the maximum (50), so saving nothing changes nothing; lower it to throttle.',
    min: 1,
    max: 50,
    default: 50,
    unit: 'vouches',
  }),
  'vouches.requestsEnabled': boolSetting({
    key: 'vouches.requestsEnabled',
    area: 'features',
    label: 'Ask a member to vouch for you',
    help: "Signed-in members can pick a member on their dashboard and send them a \"vouch for me\" request, which shows in that member's notification bell (they can dismiss it). Needs the VOUCH_REQUEST notification type migration applied first. The VOUCH_REQUESTS_ENABLED env var set to off always wins; on preview deploys only the env var counts.",
    confirmOn: 'Members will be able to send vouch requests to other members.',
  }),
  'vouches.requestDailyLimit': intSetting({
    key: 'vouches.requestDailyLimit',
    area: 'features',
    label: 'Vouch requests per member per day',
    help: 'Most vouch requests one member can send in a rolling 24 hours. A member can also have only one unread request open with another member at a time, and the cooldown below applies per member pair.',
    min: 1,
    max: 50,
    default: 5,
    unit: 'requests',
  }),
  'vouches.requestCooldownDays': intSetting({
    key: 'vouches.requestCooldownDays',
    area: 'features',
    label: 'Days before asking the same member again',
    help: 'After a member sends a vouch request to someone, they cannot send that same member another for this many days, whether or not it was read or dismissed. 0 turns the cooldown off.',
    min: 0,
    max: 365,
    default: 14,
    unit: 'days',
  }),
  'vouches.quickVouchEnabled': boolSetting({
    key: 'vouches.quickVouchEnabled',
    area: 'features',
    label: 'One-click Vouch on the members list',
    help: 'Show a Vouch button on every card of the members list (/crew) for signed-in members. Disavow-eligible viewers are sent to the profile when the member is listed. The VOUCH_QUICK_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Members will see a one-click Vouch button on the members list.',
  }),
  'vouches.showVouchersEnabled': boolSetting({
    key: 'vouches.showVouchersEnabled',
    area: 'features',
    label: 'Show who vouched on profiles',
    help: 'Profiles show how many members vouched for this member, and who. The VOUCH_SHOW_VOUCHERS_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Profiles will list the members who vouched for them.',
  }),
  'dashboard.levelCardEnabled': boolSetting({
    key: 'dashboard.levelCardEnabled',
    area: 'features',
    label: 'Level card on the dashboard',
    help: 'Show a card with the current level, title, progress through the level and the next missions. The DASHBOARD_LEVEL_CARD_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Members will see a level card on their dashboard.',
  }),
  'dashboard.startHereMaxLevel': intSetting({
    key: 'dashboard.startHereMaxLevel',
    area: 'features',
    label: 'Start here card: highest level',
    help: 'Members at this level or below see a "Start here" card on their dashboard (next steps: check your level, do your next mission, get vouched). 0 turns the card off.',
    min: 0,
    max: 10,
    default: 2,
  }),
  'discord.vouchCommandEnabled': boolSetting({
    key: 'discord.vouchCommandEnabled',
    area: 'discord',
    label: '/vouch command',
    help: 'Let members vouch for another member with /vouch @member (private reply). The command must also be registered with Discord. The VOUCH_COMMAND_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Members will be able to vouch from Discord.',
  }),
  'discord.levelCommandEnabled': boolSetting({
    key: 'discord.levelCommandEnabled',
    area: 'discord',
    label: '/level command',
    help: 'Let members see their level and what is needed for the next one with /level (private reply); for another member only their level and title. The LEVEL_COMMAND_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Members will be able to check levels from Discord.',
  }),
  'discord.profileCommandEnabled': boolSetting({
    key: 'discord.profileCommandEnabled',
    area: 'discord',
    label: '/profile command',
    help: 'Let members see profile stats with /profile [@member] (private reply). Another member shows only what their public profile shows. The PROFILE_COMMAND_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Members will be able to look up profile stats from Discord.',
  }),
  // Calls imported from X live broadcasts (plans/x-call-import.md). All off: an imported call never reaches Discord,
  // the follow-up drafter, the agenda or the automatic summary sweep unless a setting here says so.
  'calls.importedRecapPostEnabled': boolSetting({
    key: 'calls.importedRecapPostEnabled',
    area: 'calls',
    label: 'Post recaps for imported calls',
    help: 'Also post the Discord recap when an imported (X broadcast) call is published. Needs "Post call recaps" on too. The CALL_IMPORT_RECAP_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Publishing an imported call will post a recap to Discord.',
  }),
  'calls.importedFollowupsEnabled': boolSetting({
    key: 'calls.importedFollowupsEnabled',
    area: 'calls',
    label: 'Draft follow-ups for imported calls',
    help: 'Let the follow-up drafter (sweep and manual) work on imported calls. Off: imported calls never produce follow-ups. The CALL_IMPORT_FOLLOWUPS_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Imported calls will be turned into follow-up items.',
  }),
  'calls.importedAgendaContext': boolSetting({
    key: 'calls.importedAgendaContext',
    area: 'calls',
    label: 'Use imported calls in agendas',
    help: 'Let the action items of imported calls feed the pre-call agenda. Off: only Discord-recorded calls do. The CALL_IMPORT_AGENDA_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Old imported calls can show up in upcoming call agendas.',
  }),
  'calls.importedAutoSummarize': boolSetting({
    key: 'calls.importedAutoSummarize',
    area: 'calls',
    label: 'Auto-summarize imported calls',
    help: 'Let the transcript cron write AI summaries for imported calls (costs model usage). Off: the import tool summarizes them on purpose. The CALL_IMPORT_AUTOSUMMARY_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'The cron will spend model usage summarizing imported calls.',
  }),
  'calls.attendanceFromRecordings': boolSetting({
    key: 'calls.attendanceFromRecordings',
    area: 'calls',
    label: 'Attendance from recorded calls',
    help: 'Count everyone in a recorded Discord call (speakers and, with a current recorder, silent attendees) as present for that crew and day. Rows are only added, never removed or overwritten. Off: attendance comes only from the daily sheets. The CALL_ATTENDANCE_FROM_RECORDINGS_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: 'Members will gain attendance rows from recorded calls, and the admin backfill can write them.',
  }),
  'calls.bulkActionMax': intSetting({
    key: 'calls.bulkActionMax',
    area: 'calls',
    label: 'Bulk publish / reject: calls per click',
    help: 'Most imported calls a reviewer can publish or reject with one bulk click on /admin/calls. Each call still has to pass the normal publish checks. Never above 50.',
    min: 1,
    max: 50,
    default: 50,
    onReadFailure: { value: 1 },
  }),
  'disavow.enabled': boolSetting({
    key: 'disavow.enabled',
    area: 'disavow',
    label: 'Disavow list',
    help: 'The whole feature. Off: every page and API answers as if it does not exist. The DISAVOW_ENABLED env var set to off always wins.',
    confirmOn: 'The disavow pages and API become reachable to eligible members.',
  }),
  'reengage.enabled': boolSetting({
    key: 'reengage.enabled',
    area: 'features',
    label: 'Re-engagement emails',
    help: 'Send the weekly re-engagement email. Off: dry run. The REENGAGE_EMAIL_ENABLED env var set to off always wins.',
    confirmOn: 'Members will be emailed on the next run.',
  }),
  'onboarding.traineeNickEnabled': boolSetting({
    key: 'onboarding.traineeNickEnabled',
    area: 'features',
    label: 'Trainee nickname sync',
    help: 'Apply the trainee nickname and role changes in Discord. Off: dry run. The TRAINEE_NICK_ENABLED env var set to off always wins.',
  }),
  'onboarding.traineeNickHealEnabled': boolSetting({
    key: 'onboarding.traineeNickHealEnabled',
    area: 'features',
    label: 'Restore chosen names on Pizza Trainee members',
    help: 'Restore the name a member chose on signed-up members who are still nicknamed Pizza Trainee (names that just match their Discord name are left alone). Off: they keep Pizza Trainee until they claim a name. Needs the trainee nickname sync on. The TRAINEE_NICK_HEAL_ENABLED env var set to off always wins.',
  }),
  'names.requireThemed': boolSetting({
    key: 'names.requireThemed',
    area: 'mafia',
    label: 'Themed display names only',
    help: 'New sign-ups and name changes must use a generator name or include a pizza topping or pizza word. Existing names are kept as they are. Off: any name is accepted.',
  }),
  'mafia.rankFreshHours': intSetting({
    key: 'mafia.rankFreshHours',
    area: 'mafia',
    label: 'Precomputed rank freshness (hours)',
    help: 'A member rank computed by the nightly job is shown on profiles for this long; after that the profile falls back to a live lookup.',
    min: 1,
    max: 168,
    default: 26,
    unit: 'hours',
  }),
  'profile.collectionStatsFreshHours': intSetting({
    key: 'profile.collectionStatsFreshHours',
    area: 'mafia',
    label: 'Profile collection counts freshness (hours)',
    help: 'POAP, NFT and ticket counts on profiles come from a nightly precompute. After this long a view still shows them but refreshes them in the background.',
    min: 1,
    max: 168,
    default: 26,
    unit: 'hours',
  }),
  'mafia.rankPrecomputeConcurrency': intSetting({
    key: 'mafia.rankPrecomputeConcurrency',
    area: 'mafia',
    label: 'Nightly rank job: members at once',
    help: 'How many members the nightly rank precompute looks up in parallel (Discord, Alchemy and POAP calls). Lower it if those services rate-limit.',
    min: 1,
    max: 10,
    default: 4,
  }),
  'games.enabled': boolSetting({
    key: 'games.enabled',
    area: 'features',
    label: 'PEP games',
    help: 'Slots, roulette and blackjack (web and Discord). The PEP_GAMES_ENABLED env var set to off always wins.',
    confirmOn: 'PEP games go live: members can win and lose PEP.',
  }),
  'crime.enabled': boolSetting({
    key: 'crime.enabled',
    area: 'features',
    label: 'Crime (PEP earn)',
    help: 'The crime action. The PEP_CRIME_ENABLED env var set to off always wins.',
    confirmOn: 'Crime goes live: members can earn and lose PEP.',
  }),
  'portrait.enabled': boolSetting({
    key: 'portrait.enabled',
    area: 'features',
    label: 'Mafia portraits',
    help: 'AI portrait generation (it also needs the OpenAI key). The MAFIA_PORTRAIT_ENABLED env var set to off always wins.',
    confirmOn: 'Portrait generation goes live and spends OpenAI credit.',
  }),
  'pfp.restyleEnabled': boolSetting({
    key: 'pfp.restyleEnabled',
    area: 'features',
    label: 'PFP dress up (AI)',
    help: 'Members redraw their picture wearing an unlocked outfit (AI image edit; it also needs the OpenAI key). The PFP_RESTYLE_ENABLED env var set to off always wins.',
    confirmOn: 'PFP dress up goes live and spends OpenAI credit (see the daily limit and monthly budget below).',
  }),
  'pfp.restylePerUnlock': intSetting({
    key: 'pfp.restylePerUnlock',
    area: 'features',
    label: 'Dress-up tries per outfit',
    help: 'How many AI generations a member gets for each unlocked outfit.',
    min: 0,
    max: 20,
    default: 2,
  }),
  'pfp.restyleDailyLimit': intSetting({
    key: 'pfp.restyleDailyLimit',
    area: 'features',
    label: 'Dress-up daily limit',
    help: 'Most AI generations one member can start in 24 hours (refused ones do not count).',
    min: 0,
    max: 50,
    default: 3,
  }),
  'pfp.restyleMonthlyBudgetUsd': intSetting({
    key: 'pfp.restyleMonthlyBudgetUsd',
    area: 'features',
    label: 'Dress-up monthly budget',
    help: 'Estimated spend across all members per calendar month (UTC). New generations are refused once it would be exceeded.',
    min: 0,
    max: 100000,
    default: 50,
    unit: 'USD',
  }),
  'pfp.restyleRefusalDailyLimit': intSetting({
    key: 'pfp.restyleRefusalDailyLimit',
    area: 'features',
    label: 'Dress-up declined pictures per day',
    help: 'How many times the image service may decline a member\'s picture in 24 hours before they are stopped until tomorrow.',
    min: 0,
    max: 50,
    default: 3,
  }),
  'pfp.restyleCostCents': intSetting({
    key: 'pfp.restyleCostCents',
    area: 'features',
    label: 'Dress-up cost estimate per generation',
    help: 'Estimated cost of one generation, in cents (20 = $0.20). Used for the monthly budget.',
    min: 1,
    max: 1000,
    default: 20,
    unit: 'cents',
  }),
  'pfp.outfitOverlayEnabled': boolSetting({
    key: 'pfp.outfitOverlayEnabled',
    area: 'features',
    label: 'PFP outfit overlays',
    help: 'Let members layer outfit art directly over their picture (the old flat overlay). Off: outfits are only used by AI dress up. The PFP_OUTFIT_OVERLAY_ENABLED env var set to off always wins.',
  }),
  'jobs.verifyPosts': boolSetting({
    key: 'jobs.verifyPosts',
    area: 'economy',
    label: 'Verify daily job posts',
    help: 'On: a daily job that names a channel only pays once the bot finds the member\'s post in that channel today (with the people, roles and media the job asks for). Off: every job pays on click. The JOBS_VERIFY_POSTS env var set to off always wins.',
    default: true,
  }),
  'jobs.unverifiableJobsPayOnClick': boolSetting({
    key: 'jobs.unverifiableJobsPayOnClick',
    area: 'economy',
    label: 'Pay jobs with no channel on click',
    help: 'Daily jobs that name no channel cannot be checked. On: they pay when the member taps Complete. Off: they never pay. The JOBS_UNVERIFIABLE_PAY_ON_CLICK env var set to off always wins.',
    default: true,
  }),
  'tickets.discoveryTerms': textSetting({
    key: 'tickets.discoveryTerms',
    area: 'features',
    label: 'Pizza ticket discovery terms',
    help: 'One per line. Any Unlock lock whose name contains one of these (case-insensitive) is added to the ticket list, enabled. Run discovery from /admin/tickets; disable any lock there.',
    maxLength: 500,
    multiline: true,
    default: 'pizza\npizzadao\npizza party\nbitcoin pizza day',
  }),
  'tickets.scanIntervalHours': intSetting({
    key: 'tickets.scanIntervalHours',
    area: 'features',
    label: 'Ticket rescan interval',
    help: 'A profile viewed after this long since its last ticket scan is refreshed in the background (the nightly cron scans everyone regardless).',
    min: 1,
    max: 720,
    default: 24,
    unit: 'hours',
  }),
  'tickets.rescanCooldownMinutes': intSetting({
    key: 'tickets.rescanCooldownMinutes',
    area: 'features',
    label: 'Ticket Rescan button cooldown',
    help: 'Minimum time between a member pressing Rescan on their profile.',
    min: 1,
    max: 1440,
    default: 10,
    unit: 'minutes',
  }),
  'shop.itemGrantsEnabled': boolSetting({
    key: 'shop.itemGrantsEnabled',
    area: 'features',
    label: 'Item grants on login',
    help: 'Credit pending shop items when a member signs in. On unless switched off. The ITEM_GRANT_CLAIMS env var set to 0 always pauses it.',
    default: true,
  }),
  'shop.sheetSyncEnabled': boolSetting({
    key: 'shop.sheetSyncEnabled',
    area: 'features',
    label: 'Shop sheet sync',
    help: 'Accept pushes from the old shop sheet script (the shop is managed at /admin/shop). The SHOP_SHEET_SYNC_ENABLED env var set to off always wins.',
  }),

  // ---- Phase 3: Discord channels and roles (resolved against the server when saved) ----
  'discord.missionReviewChannelId': channelSetting({
    key: 'discord.missionReviewChannelId',
    label: 'Mission review channel',
    help: 'Where review cards, the daily digest and the nightly summary are posted.',
  }),
  'discord.missionsAnnounceChannelId': channelSetting({
    key: 'discord.missionsAnnounceChannelId',
    label: 'Level-up announcement channel',
    help: 'Where level-up posts go.',
  }),
  'discord.announceChannelId': channelSetting({
    key: 'discord.announceChannelId',
    label: 'Announcement and recap channel',
    help: 'Where announcements and call recaps go.',
  }),
  'discord.callVoiceChannelId': channelSetting({
    key: 'discord.callVoiceChannelId',
    label: 'Call voice channel',
    help: 'Scheduled events in this voice channel get an agenda post.',
    kind: 'voice',
  }),
  'discord.educationChannelId': channelSetting({
    key: 'discord.educationChannelId',
    label: 'Education sessions: announcement channel',
    help: 'Where a scheduled education session is announced, with its flyer. Empty: the session is not announced.',
  }),
  'discord.educationEventChannelId': channelSetting({
    key: 'discord.educationEventChannelId',
    label: 'Education sessions: event voice or stage channel',
    help: 'The voice or stage channel the Discord event for a session is created in. Empty: no event is created.',
    kind: 'voice',
  }),
  'discord.educationGeneralChannelId': channelSetting({
    key: 'discord.educationGeneralChannelId',
    label: 'Education sessions: general announcements channel (optional)',
    help: 'Also post the announcement here. Empty: only the education channel.',
  }),
  'discord.dstFixChannelId': channelSetting({
    key: 'discord.dstFixChannelId',
    label: 'Crew call time fix: report channel',
    help: 'Where a short summary is posted when the crew call time fix changes, skips or fails an event. Empty posts nothing (the log on /admin/calls still has everything).',
  }),
  'discord.proposalsChannelId': channelSetting({
    key: 'discord.proposalsChannelId',
    label: 'Proposals channel',
    help: 'Where each new proposal and its result are posted, with a link to vote and the proposal\'s voting-key fingerprint. There is no voting in Discord (votes are secret). Empty uses the PROPOSALS_CHANNEL_ID environment value, then the channel named "proposals". Checked against the server when saved.',
  }),
  'discord.proposalsOpsChannelId': {
    ...channelSetting({ key: 'discord.proposalsOpsChannelId', label: 'Proposals ops channel', help: '' }),
    help: 'Where a short alert is posted (once) when a proposal has waited more than 2 hours to open for voting. Counts only, no titles. Empty posts nothing (the stuck proposals are always listed on /admin/proposals). Checked against the server when saved.',
  },
  'discord.supportChannelId': channelSetting({
    key: 'discord.supportChannelId',
    label: 'Support ticket channel',
    help: 'Where new support tickets are announced (subject only). Empty falls back to the old Discord webhook sheet row.',
  }),
  'discord.spotlightChannelId': channelSetting({
    key: 'discord.spotlightChannelId',
    label: 'Mafia Spotlight channel',
    help: 'Where new Mafia Spotlight submissions are announced. Empty falls back to the old Discord webhook sheet row.',
  }),
  'discord.suggestionsChannelId': channelSetting({
    key: 'discord.suggestionsChannelId',
    label: 'Site suggestions channel',
    help: 'Where new site suggestions are posted. Empty falls back to the old Discord webhook sheet row.',
  }),
  'discord.welcomeChannelId': channelSetting({
    key: 'discord.welcomeChannelId',
    label: 'Welcome channel',
    help: 'Where welcome and profile-update posts go. Empty falls back to the old Discord webhook sheet row.',
  }),
  'discord.traineeWelcomeChannelId': channelSetting({
    key: 'discord.traineeWelcomeChannelId',
    label: 'New member welcome channel',
    help: 'Where the "Welcome to PizzaDAO" post for each new member goes. Empty falls back to the server\'s system channel. The TRAINEE_WELCOME_CHANNEL_ID env var, when set, wins.',
  }),
  'discord.proposalsPingRoleId': proposalsPingRole,
  'missions.slaPingRoleId': slaPingRole,
  'missions.reviewerRoleIds': reviewerRoles,
  'announce.roleIds': roleListSetting({
    key: 'announce.roleIds',
    area: 'discord',
    label: 'Announcement roles',
    help: 'Roles allowed to send announcements to the whole server. Dread Pizza Roberts is always included.',
    // Authority over a server-wide post: every change (including a reset) is confirmed.
    confirm: () => 'This changes who can send announcements to the whole server.',
  }),
  'articles.authorRoleIds': roleListSetting({
    key: 'articles.authorRoleIds',
    area: 'discord',
    label: 'Article author roles',
    help: 'Roles allowed to publish articles on the site. Dread Pizza Roberts is always included.',
    confirm: (from, to) => (to.some((id) => !from.includes(id)) ? 'More roles will be able to publish articles.' : null),
  }),
  // ---- Proposals and voting (plans/proposals-voting.md). Tiers reuse payments.voteAyes* / voteMidMaxUsd. ----
  'proposals.enabled': boolSetting({
    key: 'proposals.enabled',
    area: 'proposals',
    label: 'Proposals and voting',
    help: 'The whole feature: proposal pages, secret ballots, the Discord posts, and the payments link to a passed proposal. Off: every page answers as if it does not exist and payments behave as before. While the pilot list below is set, only the listed members see it and payments are NOT affected. The PROPOSALS_ENABLED env var set to off always wins.',
    confirmOn: 'Proposals go live: payment requests above the on-approval cap will need a passed in-app proposal. Sesh links stop being accepted for polls posted after go-live (polls posted before it keep working until the Sesh grace date). While the pilot list is set, payments are not affected.',
  }),
  'proposals.voterRoleId': {
    key: 'proposals.voterRoleId',
    area: 'proposals',
    label: 'Voter role',
    help: 'Members holding this role when a proposal opens can vote on it, and can submit proposals. Empty uses the Box Mafia role (assigned by the holder-verification bot, which checks a wallet signature). Applies to proposals opened from now on. Checked against the server when saved.',
    schema: optionalSnowflake,
    default: '',
    onReadFailure: 'lastKnownGood',
    input: { type: 'role' },
    // This decides who can pass spending: every change is confirmed.
    confirm: (from: string, to: string) => (to !== from ? 'This changes who can vote on proposals that approve spending.' : null),
  } as SettingDef<string>,
  'proposals.windowDays': intSetting({
    key: 'proposals.windowDays',
    area: 'proposals',
    label: 'Voting window',
    help: 'How long a proposal stays open for votes. Fixed: there is no early close. Can only be lengthened here; shortening below 7 days needs a code change. Applies to proposals opened from now on.',
    min: 7,
    max: 14,
    default: 7,
    unit: 'days',
    onReadFailure: { value: 14 },
    stricterOnly: true,
    looserWhen: 'lower',
  }),
  'proposals.generalAyes': intSetting({
    key: 'proposals.generalAyes',
    area: 'proposals',
    label: 'Ayes needed for a general proposal',
    help: 'Ayes plus abstains needed (and more ayes than nays) for a proposal that asks for no money. Funding proposals use the payments tiers. Can only be raised here. Applies to proposals opened from now on.',
    min: 15,
    max: 200,
    default: 15,
    stricterOnly: true,
    looserWhen: 'lower',
  }),
  'proposals.pilotDiscordIds': {
    key: 'proposals.pilotDiscordIds',
    area: 'proposals',
    label: 'Pilot testers (Discord ids)',
    help: 'While this list is not empty the proposals feature is a pilot: only these members see the voting pages, can submit and get ballot tokens; the voter snapshot is limited to them; the payments gate stays OFF; and proposals submitted are test proposals (short window below, 1 aye needed, never shown in lists, totals or the payments picker). Point the proposals channel at a private test channel and leave the ping role empty while testing. Clearing the list (with the switch on) is the real go-live and records the go-live moment.',
    schema: z.array(snowflake).max(20),
    default: [] as string[],
    onReadFailure: { value: [] as string[] },
    input: { type: 'stringList', maxItems: 20, maxLength: 25 },
    confirm: (from: string[], to: string[]) => (from.length > 0 && to.length === 0 ? 'Clearing the pilot list ends the pilot: the feature goes live for every voter and, with the switch on, payments start requiring in-app proposals.' : null),
  } as SettingDef<string[]>,
  'proposals.pilotWindowMinutes': intSetting({
    key: 'proposals.pilotWindowMinutes',
    area: 'proposals',
    label: 'Pilot voting window',
    help: 'How long a pilot (test) proposal stays open. Only applies to proposals submitted while the pilot list is set; real proposals always use the voting window above.',
    min: 30,
    max: 1440,
    default: 60,
    unit: 'minutes',
    onReadFailure: { value: 60 },
  }),
  'proposals.voteDelayMinSeconds': intSetting({
    key: 'proposals.voteDelayMinSeconds',
    area: 'proposals',
    label: 'Vote send delay, minimum',
    help: 'When a member taps Aye, Nay or Abstain the browser waits a random time between this minimum and the maximum below before sending the vote, so the vote cannot be matched to the ballot-token request by server logs. Never past the close of voting. Keep this at or below the maximum (if not, the maximum is used for both).',
    min: 0,
    max: 3600,
    default: 60,
    unit: 'seconds',
  }),
  'proposals.voteDelayMaxSeconds': intSetting({
    key: 'proposals.voteDelayMaxSeconds',
    area: 'proposals',
    label: 'Vote send delay, maximum',
    help: 'The longest random wait before a vote is sent (see the minimum above). At most 3600 seconds.',
    min: 0,
    max: 3600,
    default: 600,
    unit: 'seconds',
  }),
  'proposals.liveSince': {
    ...textSetting({
    key: 'proposals.liveSince',
    area: 'proposals',
    label: 'Go-live moment',
    help: 'ISO time (for example 2026-12-01T18:00:00Z). Written automatically the first time the switch is ON with an empty pilot list, in production. Discord polls posted before it may still back a payment request during the Sesh grace window; polls posted after it never can. Empty means go-live has not happened, and Sesh links are not accepted. Once set it can only be moved EARLIER (each edit is confirmed), and it ends any pilot: a tester list saved later is ignored. If proposals are switched on only through the PROPOSALS_ENABLED env var, nothing records it: save the switch in Settings (or set this by hand).',
    maxLength: 40,
    check: isoInstantValid,
    checkMessage: 'Use an ISO time such as 2026-12-01T18:00:00Z, or leave empty',
    }),
    // Once set it is a stricter-only value: every edit is confirmed (and the store refuses a later time or a clear).
    confirm: (from: string, to: string) => (from && to !== from ? 'The go-live moment is already set. Moving it earlier shortens the Sesh grace window; it can never be moved later.' : null),
  } as SettingDef<string>,
  'proposals.seshLinksUntil': dateSetting({
    key: 'proposals.seshLinksUntil',
    area: 'proposals',
    label: 'Sesh grace window ends',
    help: 'Last day (UTC, inclusive) a payment request above the on-approval cap may still use a Sesh poll link plus the reviewer-confirmed ayes, for polls posted before the go-live moment. The window can never run longer than 30 days after the go-live moment: this date can only shorten it. Empty means the full 30 days. To close the window early, set a past date.',
  }),
  'proposals.maxOpenPerProposer': intSetting({
    key: 'proposals.maxOpenPerProposer',
    area: 'proposals',
    label: 'Open proposals per member',
    help: 'Most proposals one member may have waiting or open at once. Can only be lowered here; raising it needs a code change.',
    min: 1,
    max: 3,
    default: 3,
    unit: 'proposals',
    onReadFailure: { value: 1 },
    stricterOnly: true,
    looserWhen: 'higher',
  }),
  // ---- Proposals history (plans/proposals-history-import.md): display only, no rule changes. ----
  'proposals.historyEnabled': boolSetting({
    key: 'proposals.historyEnabled',
    area: 'proposals',
    label: 'Show imported proposal history',
    help: 'Shows the imported past proposals (read-only records with their links and payments) in the history section of the proposals page. Off hides imported rows; proposals run in the app always stay visible.',
  }),
  'proposals.pageSize': intSetting({
    key: 'proposals.pageSize',
    area: 'proposals',
    label: 'History page size',
    help: 'How many past proposals the history list shows per page.',
    min: 10,
    max: 200,
    default: 50,
    unit: 'proposals',
    onReadFailure: { value: 50 },
  }),
  'proposals.explorers': textSetting({
    key: 'proposals.explorers',
    area: 'proposals',
    label: 'Block explorer links',
    help: 'JSON object: chain key to an https link containing {tx}, for example {"ethereum": "https://etherscan.io/tx/{tx}"}. Chains listed here replace the built-in defaults (ethereum, base, optimism, polygon, arbitrum). Empty uses the defaults. A payment on a chain with no link shows its hash without a link.',
    maxLength: 2000,
    multiline: true,
    check: explorersTextValid,
    checkMessage: 'Use a JSON object of chain keys to https links that contain {tx}, or leave empty',
  }),
  // Payments group (plans/host-fast-track.md): defined in ./payments-settings.
  ...PAYMENT_SETTINGS,
  // Economy numbers and spend caps (phase 4): ./economy-settings.
  ...ECONOMY_SETTINGS,
  // Content, caps, lists and the private call post filter (phase 5): ./content-settings.
  ...CONTENT_SETTINGS,
  // Telegram city group mirrors (PR P3): the switches here, the data and pacing in ./telegram-settings.
  'telegram.cityPostsEnabled': boolSetting({
    key: 'telegram.cityPostsEnabled',
    area: 'telegram',
    label: 'Mirror posts to city Telegram groups',
    help: 'Master switch for every mirror below: nothing is queued or sent while it is off. Posts go through the rsv.pizza bot to the groups chosen below. The TELEGRAM_CITY_POSTS_ENABLED env var set to off (or TELEGRAM_SENDS_ENABLED set to off) always wins; previews never send.',
    confirmOn: 'Mirrors that are switched on will start posting into city Telegram groups.',
  }),
  'telegram.recapMirrorEnabled': boolSetting({
    key: 'telegram.recapMirrorEnabled',
    area: 'telegram',
    label: 'Mirror call recaps to city groups',
    help: 'When a recap is posted to Discord, also queue it for the city groups mapped to the crew. Needs the master switch and the recap switch (Calls).',
    confirmOn: 'Published call recaps will also post to the mapped city Telegram groups.',
  }),
  'telegram.agendaMirrorEnabled': boolSetting({
    key: 'telegram.agendaMirrorEnabled',
    area: 'telegram',
    label: 'Mirror pre-call agendas to city groups',
    help: 'When an agenda is posted to Discord, also queue it for the city groups mapped to the crew. Needs the master switch and the agenda switch (Calls).',
    confirmOn: 'Pre-call agendas will also post to the mapped city Telegram groups.',
  }),
  'telegram.announceMirrorEnabled': boolSetting({
    key: 'telegram.announceMirrorEnabled',
    area: 'telegram',
    label: 'Mirror the Community Call announcement to city groups',
    help: 'When the announcement goes out on Discord, also queue it for the announcement city groups below. Needs the master switch.',
    confirmOn: 'The Community Call announcement will also post to the chosen city Telegram groups.',
  }),
  'telegram.sessionMirrorEnabled': boolSetting({
    key: 'telegram.sessionMirrorEnabled',
    area: 'telegram',
    label: 'Mirror crew session announcements to city groups',
    help: 'When a crew session (education talks) is announced on Discord, also queue it for the city groups mapped to that crew in "Crew to city groups" below (the same mapping crew recaps use; no mapping, no post). Needs the master switch.',
    confirmOn: 'Crew session announcements will also post to the city Telegram groups mapped to that crew.',
  }),
  // Optional host matching (PR P4): the switch here, the mode and pacing in ./telegram-settings.
  'telegram.hostMatchEnabled': boolSetting({
    key: 'telegram.hostMatchEnabled',
    area: 'telegram',
    label: 'Match members to Telegram accounts hosts already linked on rsv.pizza',
    help: 'Once a day, members with a verified email are matched (by hash only) against hosts who linked Telegram on rsv.pizza. A match is only a suggestion: the member must confirm in the app and on Telegram before any follow-up goes there. Also needs the rsv.pizza side switched on. The TELEGRAM_HOST_MATCH_ENABLED env var set to off (or TELEGRAM_SENDS_ENABLED set to off) always wins; previews never run it.',
    confirmOn: 'Verified member emails will be sent to rsv.pizza as hashes, and members with a match will be asked to confirm it.',
  }),
  'telegram.hostMatchDiscordLine': textSetting({
    key: 'telegram.hostMatchDiscordLine',
    area: 'telegram',
    label: 'Line added to Discord follow-ups for a member with a Telegram match',
    help: 'Added once per follow-up to members who have a suggested Telegram match they have not answered. {link} is replaced with the profile link. Empty adds nothing.',
    maxLength: 200,
    default: 'Prefer Telegram? Confirm here: {link}',
    check: (v) => v === '' || v.includes('{link}'),
    checkMessage: 'Include {link} where the profile link should go',
    onReadFailure: { value: '' },
  }),
  'telegram.hostMatchConfirmText': textSetting({
    key: 'telegram.hostMatchConfirmText',
    area: 'telegram',
    label: 'Telegram confirmation message (member asked)',
    help: 'Sent by the shared bot to the suggested Telegram account after the member says it is theirs. The English default is translated to Spanish and French automatically; an edited text is sent as written. Keep it free of names and follow-up content.',
    maxLength: 500,
    default: 'Confirm this Telegram for your PizzaDAO account. Only tap the button if you just asked for this in the PizzaDAO app.',
    check: (v) => v.length > 0,
    checkMessage: 'This cannot be empty',
  }),
  'telegram.hostMatchConfirmButton': textSetting({
    key: 'telegram.hostMatchConfirmButton',
    area: 'telegram',
    label: 'Telegram confirmation button label',
    help: 'The label of the confirm link button.',
    maxLength: 40,
    default: 'Confirm',
    check: (v) => v.length > 0,
    checkMessage: 'This cannot be empty',
  }),
  'telegram.hostMatchInviteText': textSetting({
    key: 'telegram.hostMatchInviteText',
    area: 'telegram',
    label: 'Telegram invitation message (mode 2)',
    help: 'The one invitation sent in mode 2. The English default is translated automatically; an edited text is sent as written.',
    maxLength: 500,
    default: 'PizzaDAO would like to send you call follow-ups here. Tap the button to confirm, or ignore this message.',
    check: (v) => v.length > 0,
    checkMessage: 'This cannot be empty',
  }),
  'telegram.hostMatchInviteButton': textSetting({
    key: 'telegram.hostMatchInviteButton',
    area: 'telegram',
    label: 'Telegram invitation button label',
    help: 'The label of the invitation link button.',
    maxLength: 40,
    default: 'Confirm',
    check: (v) => v.length > 0,
    checkMessage: 'This cannot be empty',
  }),
  ...TELEGRAM_SETTINGS,
  ...CALL_TIME_SETTINGS,
  ...SHEETS_SETTINGS,
  ...MAP_LEVELS_SETTINGS,
  ...REMINDERS_SETTINGS,
  ...CREWS_SETTINGS,
  ...SITE_SETTINGS,
  ...CALL_UPDATES_SETTINGS,
  ...MEMBERS_SETTINGS,
  ...MARKETING_SETTINGS,
  // The Work Payment responses sheet. Empty = form ingest does nothing. Never committed to the repo, and
  // never sent anywhere except this admin settings page (private: true) and the ingest job.
  'payments.formSheetId': {
    ...textSetting({
      key: 'payments.formSheetId',
      area: 'payments',
      label: 'Work payment responses sheet id',
      help: 'The id of the Google Sheet that holds the Work Payment form responses (the part of its address between /d/ and /edit). It must be shared with the service account. Empty turns form ingest off.',
      maxLength: 120,
      check: (v) => v === '' || isValidSheetId(v),
      checkMessage: 'That does not look like a sheet id',
      onReadFailure: { value: '' },
    }),
    private: true,
  },
} as const satisfies Record<string, SettingDef>

export type SettingKey = keyof typeof SETTINGS
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[]

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key)
}

/** Validate a candidate value for a key against its schema. */
export function parseSetting(key: SettingKey, value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const r = (SETTINGS[key].schema as z.ZodType<unknown>).safeParse(value)
  if (r.success) return { ok: true, value: r.data }
  return { ok: false, error: r.error.issues.map((i) => i.message).join('; ') || 'Invalid value' }
}
