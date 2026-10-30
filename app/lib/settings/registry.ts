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
import { CONTENT_SETTINGS } from './content-settings'
import { ECONOMY_SETTINGS } from './economy-settings'
import { isValidSheetId, PAYMENT_SETTINGS } from './payments-settings'
import { ADMIN_ROLE_IDS, DREAD_PIZZA_ROBERTS_ROLE_ID, MISSION_REVIEWER_ROLE_IDS } from '@/app/ui/constants'

export type SettingArea = 'missions' | 'calls' | 'disavow' | 'passport' | 'guide' | 'followups' | 'discord' | 'features' | 'payments' | 'proposals' | 'economy' | 'mafia' | 'telegram'

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

const FOOTER_TELEGRAM_DEFAULT = "Replies to this bot aren't read. Use the buttons above to answer, snooze or stop these messages."

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

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
  help: 'Optional role tagged when a new proposal is posted in the proposals channel. Empty tags nobody. Checked against the server when saved.',
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
  'calls.agendaPostEnabled': boolSetting({
    key: 'calls.agendaPostEnabled',
    area: 'calls',
    label: 'Post call agendas',
    help: 'Post the pre-call agenda to Discord. The CALL_AGENDA_POST_ENABLED env var set to off always wins.',
    confirmOn: 'Upcoming calls will get an agenda post in Discord.',
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
  'discord.proposalsChannelId': channelSetting({
    key: 'discord.proposalsChannelId',
    label: 'Proposals channel',
    help: 'Where each new proposal and its result are posted, with a link to vote and the proposal\'s voting-key fingerprint. There is no voting in Discord (votes are secret). Empty uses the PROPOSALS_CHANNEL_ID environment value, then the channel named "proposals". Checked against the server when saved.',
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
    help: 'The whole feature: proposal pages, secret ballots, the Discord posts, and the payments link to a passed proposal. Off: every page answers as if it does not exist and payments behave as before. The PROPOSALS_ENABLED env var set to off always wins.',
    confirmOn: 'Proposals go live: payment requests above the on-approval cap will need a passed in-app proposal, and Sesh links stop being accepted.',
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
  // Payments group (plans/host-fast-track.md): defined in ./payments-settings.
  ...PAYMENT_SETTINGS,
  // Economy numbers and spend caps (phase 4): ./economy-settings.
  ...ECONOMY_SETTINGS,
  // Content, caps, lists and the private call post filter (phase 5): ./content-settings.
  ...CONTENT_SETTINGS,
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
