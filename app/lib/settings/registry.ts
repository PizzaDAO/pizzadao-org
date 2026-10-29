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

export type SettingArea = 'missions' | 'calls' | 'disavow' | 'passport' | 'guide' | 'followups'

/** Admin-only English group names (kept out of messages/*.json: the disavow feature must not leak into them). */
export const AREA_LABELS: Record<SettingArea, string> = {
  missions: 'Missions',
  calls: 'Calls',
  disavow: 'Disavow list',
  passport: 'Pizza Passport',
  guide: 'Handbook facts',
  followups: 'Follow-ups',
}

/** What a reader gets when the stored value cannot be used (DB down, row fails its schema). */
export type FailureMode<T> = { value: T } | 'lastKnownGood' | 'throw'

/** How the admin page edits a value. Text-like inputs allow an empty string (= unset). */
export type SettingInput =
  | { type: 'int'; min: number; max: number; unit?: string }
  | { type: 'text'; maxLength: number; multiline?: boolean; placeholder?: string }
  | { type: 'date' }
  | { type: 'url'; maxLength: number }

export interface SettingDef<T> {
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
  looserWhen?: 'higher' | 'lower'
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
    help: 'Added under every follow-up sent on Telegram so people know how to opt out.',
    maxLength: 200,
    default: 'Reply STOP to stop these messages.',
    check: (v) => v.length > 0,
    checkMessage: 'The footer cannot be empty',
    onReadFailure: 'lastKnownGood',
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
  // ---- END follow-ups block ----
} as const satisfies Record<string, SettingDef<number> | SettingDef<string>>

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
