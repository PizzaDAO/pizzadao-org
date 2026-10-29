/**
 * Writes for the admin settings page: validate, store and audit in one transaction, then clear
 * the local cache (other instances catch up within ~30s). The audit row records who/when/old/new.
 */
import { prisma } from '@/app/lib/db'
import { clearSettingsCache, loadSettings } from './index'
import { jsonOrDbNull } from './json'
import { AREA_LABELS, SETTINGS, SETTING_KEYS, isSettingKey, parseSetting, type SettingKey } from './registry'
import { checkTargets, targetNames, TargetError } from './targets'
import { baselineInt, combineSaved, legacyEnvName } from './numbers'
import { describeToggle, isToggleKey } from './toggles'
import { roleIncomeBaseline } from '@/app/lib/pep-earn/income-defaults'

export class SettingError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message)
  }
}

export interface SettingChangeRow {
  id: number
  key: string
  oldValue: unknown
  newValue: unknown
  changedBy: string
  changedAt: Date
  note: string | null
}

const MAX_NOTE = 300
const cleanNote = (note: unknown): string | null =>
  typeof note === 'string' && note.trim() ? note.trim().slice(0, MAX_NOTE) : null

/** Pairs of settings that must stay in order: `low` may not exceed `high`. */
const PAIRS: ReadonlyArray<{ low: SettingKey; high: SettingKey; what: (low: number, high: number) => string }> = [
  {
    low: 'disavow.decisionDays',
    high: 'disavow.windowDays',
    what: (low, high) => `the voting window (${high} days) cannot be shorter than the decision time (${low} days)`,
  },
  { low: 'games.minBet', high: 'games.maxBet', what: (low, high) => `the smallest bet (${low}) cannot be above the largest bet (${high})` },
  { low: 'crime.minPep', high: 'crime.maxPep', what: (low, high) => `the smallest crime payout (${low}) cannot be above the largest (${high})` },
  {
    low: 'crime.fineMinPercent',
    high: 'crime.fineMaxPercent',
    what: (low, high) => `the smallest fine (${low}%) cannot be above the largest fine (${high}%)`,
  },
  { low: 'work.minPep', high: 'work.maxPep', what: (low, high) => `the smallest work payout (${low}) cannot be above the largest (${high})` },
]

/**
 * Settings that depend on each other are checked together (see PAIRS), on the values that would be in
 * force: a saved value is combined with the env value like the app does, so a stricter env cap counts.
 * `value` undefined means the key is being reset (its baseline applies).
 */
async function checkTogether(key: SettingKey, value: unknown): Promise<void> {
  const pairs = PAIRS.filter((p) => p.low === key || p.high === key)
  if (pairs.length === 0) return
  const rows = (await prisma.appSetting.findMany()) as Array<{ key: string; value: unknown }>
  const effective = (k: SettingKey): number => {
    const base = baselineInt(k)
    let row: number | undefined
    if (k === key) row = value as number | undefined
    else {
      const stored = rows.find((r) => r.key === k)
      const parsed = stored ? parseSetting(k, stored.value) : null
      row = parsed?.ok ? (parsed.value as number) : undefined
    }
    return row === undefined ? base : combineSaved(k, base, row)
  }
  for (const p of pairs) {
    const low = effective(p.low)
    const high = effective(p.high)
    if (low > high) throw new SettingError(400, `${key}: ${p.what(low, high)}`)
  }
}

/** What is in force for a setting when nothing is saved: the env value or table, else the code default. */
export function baselineValue(key: SettingKey): unknown {
  if (key === 'economy.roleIncome') return roleIncomeBaseline().map((r) => ({ ...r }))
  if (legacyEnvName(key)) return baselineInt(key)
  return SETTINGS[key].default
}

/** Set an override. `expectedUpdatedAt` (ISO) guards against editing a value changed since it was loaded. */
export async function saveSetting(
  key: SettingKey,
  value: unknown,
  actor: string,
  opts: { note?: unknown; expectedUpdatedAt?: string | null } = {},
): Promise<{ updatedAt: Date }> {
  const parsed = parseSetting(key, value)
  if (!parsed.ok) throw new SettingError(400, `${key}: ${parsed.error}`)
  const note = cleanNote(opts.note)
  await checkTogether(key, parsed.value)
  // Channels and roles must exist in our server (rejected, not stored, when Discord cannot confirm).
  try {
    await checkTargets(key, parsed.value)
  } catch (e) {
    if (e instanceof TargetError) throw new SettingError(400, `${key}: ${e.message}`)
    throw e
  }

  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.appSetting.findUnique({ where: { key } })
    if (opts.expectedUpdatedAt !== undefined) {
      const have = existing ? existing.updatedAt.toISOString() : null
      if (have !== (opts.expectedUpdatedAt ?? null)) throw new SettingError(409, `${key} changed since you loaded it; reload and retry`)
    }
    const saved = await tx.appSetting.upsert({
      where: { key },
      create: { key, value: parsed.value as never, updatedBy: actor },
      update: { value: parsed.value as never, updatedBy: actor },
    })
    await tx.appSettingChange.create({
      data: { key, oldValue: jsonOrDbNull(existing ? existing.value : null), newValue: jsonOrDbNull(parsed.value), changedBy: actor, note },
    })
    return saved
  })
  clearSettingsCache()
  return { updatedAt: row.updatedAt }
}

/** Remove the override (back to the code default). No-op, and no audit row, when there is none. */
export async function resetSetting(key: SettingKey, actor: string, opts: { note?: unknown } = {}): Promise<boolean> {
  const note = cleanNote(opts.note)
  // Going back to the default must not break a rule that depends on another setting.
  await checkTogether(key, undefined)
  const removed = await prisma.$transaction(async (tx) => {
    const existing = await tx.appSetting.findUnique({ where: { key } })
    if (!existing) return false
    await tx.appSetting.delete({ where: { key } })
    await tx.appSettingChange.create({ data: { key, oldValue: jsonOrDbNull(existing.value), newValue: jsonOrDbNull(null), changedBy: actor, note } })
    return true
  })
  clearSettingsCache()
  return removed
}

/** Recent audit rows, newest first (all keys, or one). */
export async function listChanges(opts: { key?: string; limit?: number } = {}): Promise<SettingChangeRow[]> {
  const rows = await prisma.appSettingChange.findMany({
    where: opts.key ? { key: opts.key } : undefined,
    orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
  })
  // Values of private settings (for example the responses sheet id) are never echoed back.
  return (rows as SettingChangeRow[]).map((r) => {
    const def = isSettingKey(r.key) ? SETTINGS[r.key] : null
    return def?.private ? { ...r, oldValue: maskPrivate(r.oldValue), newValue: maskPrivate(r.newValue) } : r
  })
}

/** What the admin page may show for a private setting: whether it is set, never the value. */
export function maskPrivate(v: unknown): 'set' | 'not set' | null {
  if (v === null || v === undefined) return null
  return (Array.isArray(v) ? v.length > 0 : v !== '' && v !== false) ? 'set' : 'not set'
}

export interface SettingView {
  key: SettingKey
  area: string
  areaLabel: string
  label: string
  help: string
  input: (typeof SETTINGS)[SettingKey]['input']
  stricterOnly: boolean
  default: unknown
  /** What is in force with no saved row: the env value or table if set, else the code default. */
  baseline: unknown
  /** The env var that supplies the baseline, if this setting has one. */
  legacyEnv?: string
  /** The effective value (override if valid, else the failure mode / default). */
  value: unknown
  /** The stored override, if any. */
  override: unknown
  modified: boolean
  /** Stored value fails its schema: flagged red. */
  invalid: boolean
  updatedAt: string | null
  updatedBy: string | null
  /** Feature switches: the env var, whether it kills the switch, and what is in force right now. */
  toggle?: { env: string; envKill: boolean; envOn: boolean; effective: boolean }
  /** Channel and role settings: display names for the ids (best effort). */
  names?: Record<string, string>
}

/** The admin page's data. Reads rows directly (not the cache) so the page is never stale. */
export async function listSettingViews(): Promise<SettingView[]> {
  const rows = await prisma.appSetting.findMany()
  const byKey = new Map<string, { value: unknown; updatedAt: Date; updatedBy: string }>(
    (rows as Array<{ key: string; value: unknown; updatedAt: Date; updatedBy: string }>).map((r) => [r.key, r]),
  )
  // What is in force for switches: the same resolution the app uses, over these rows.
  const snap = await loadSettings()
  const ids = new Set<string>()
  const collect = (v: unknown) => {
    if (typeof v === 'string' && v) ids.add(v)
    else if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && ids.add(x))
  }
  for (const key of SETTING_KEYS) {
    const t = SETTINGS[key].input.type
    if (t === 'channel' || t === 'role' || t === 'roleList') {
      collect(byKey.get(key)?.value)
      collect(SETTINGS[key].default)
    }
  }
  const names = await targetNames([...ids])
  return SETTING_KEYS.map((key) => {
    const def = SETTINGS[key]
    const row = byKey.get(key)
    const parsed = row ? parseSetting(key, row.value) : null
    const valid = !!parsed?.ok
    const shownIds: string[] = []
    const t = def.input.type
    // Private values (the responses sheet id) are masked to "set" / "not set" in every view.
    const shown = (v: unknown) => (def.private ? (maskPrivate(v) ?? 'not set') : v)
    if (t === 'channel' || t === 'role' || t === 'roleList') {
      const v = valid ? parsed.value : def.default
      if (typeof v === 'string' && v) shownIds.push(v)
      if (Array.isArray(v)) shownIds.push(...(v as string[]))
    }
    return {
      key,
      area: def.area,
      areaLabel: AREA_LABELS[def.area],
      label: def.label,
      help: def.help,
      input: def.input,
      stricterOnly: !!def.stricterOnly,
      default: def.private ? maskPrivate(def.default) ?? 'not set' : def.default,
      // For a switch, the value is what is in force (env fallback, kill switch and failures included).
      value: shown(
        isToggleKey(key)
          ? describeToggle(key, snap).effective
          : valid
            ? typeof parsed.value === 'number' && legacyEnvName(key) && def.stricterOnly
              ? combineSaved(key, baselineInt(key), parsed.value)
              : parsed.value
            : row && typeof def.onReadFailure === 'object'
              ? def.onReadFailure.value
              : baselineValue(key),
      ),
      baseline: def.private ? maskPrivate(def.default) ?? 'not set' : baselineValue(key),
      ...(legacyEnvName(key) ? { legacyEnv: legacyEnvName(key) } : key === 'economy.roleIncome' ? { legacyEnv: 'ROLE_INCOME_JSON' } : {}),
      override: row ? shown(row.value) : null,
      modified: !!row,
      invalid: !!row && !valid,
      updatedAt: row ? row.updatedAt.toISOString() : null,
      updatedBy: row ? row.updatedBy : null,
      ...(isToggleKey(key) ? { toggle: describeToggle(key, snap) } : {}),
      ...(shownIds.length ? { names: Object.fromEntries(shownIds.filter((id) => names[id]).map((id) => [id, names[id]])) } : {}),
    }
  })
}

/** The confirmation text for a change (null = save without asking). */
export function confirmationFor(key: SettingKey, from: unknown, to: unknown): string | null {
  const def = SETTINGS[key]
  if (def.stricterOnly && def.looserWhen === 'larger' && Array.isArray(from) && Array.isArray(to)) {
    // An empty list means the whole built-in list.
    const all = def.input.type === 'roleList' ? (def.input.allowed?.length ?? 0) : 0
    const size = (l: unknown[]) => (l.length === 0 ? all : l.length)
    if (size(to) > size(from)) return 'This loosens a stricter rule back toward its code default. Anything held back by it will no longer be.'
  }
  if (def.stricterOnly && typeof from === 'number' && typeof to === 'number') {
    const loosened = def.looserWhen === 'lower' ? to < from : to > from
    if (loosened) return 'This loosens a stricter rule back toward its code default. Anything held back by it will no longer be.'
  }
  const c = def.confirm as ((a: unknown, b: unknown) => string | null) | undefined
  return c ? c(from, to) : null
}
