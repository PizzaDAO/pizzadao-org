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

export type SettingArea = 'missions' | 'calls' | 'disavow'

/** Admin-only English group names (kept out of messages/*.json: the disavow feature must not leak into them). */
export const AREA_LABELS: Record<SettingArea, string> = { missions: 'Missions', calls: 'Calls', disavow: 'Disavow list' }

/** What a reader gets when the stored value cannot be used (DB down, row fails its schema). */
export type FailureMode<T> = { value: T } | 'lastKnownGood' | 'throw'

export interface SettingDef<T> {
  key: string
  area: SettingArea
  /** Admin-only English label and help (the admin page is not translated per setting). */
  label: string
  help: string
  schema: z.ZodType<T>
  default: T
  onReadFailure: FailureMode<T>
  /** Shown in the UI (number inputs); the schema is the authority. */
  input: { type: 'int'; min: number; max: number; unit?: string }
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
} as const satisfies Record<string, SettingDef<number>>

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
