/**
 * Cached, fail-safe read path for admin settings (plans/app-settings.md 4.3).
 *
 *   const s = await loadSettings()      // one query for all rows, cached ~60s per instance
 *   s.get('missions.maxAttempts')       // typed
 *   await getSetting('disavow.minLevel')
 *
 * Never throws for a bad row or an unreachable database (except keys whose failure mode is
 * 'throw'): a missing row gives the code default; an unreadable or invalid value gives the
 * key's onReadFailure value (see registry.ts). A failed read is cached only briefly.
 *
 * When the cached snapshot expires, a fingerprint of the table (db-fingerprint.ts, 32 bytes) is
 * checked first: unchanged rows are not read again, so the minute-by-minute refresh is nearly free.
 */
import { prisma } from '@/app/lib/db'
import { tableFingerprint } from '@/app/lib/db-fingerprint'
import { clearKnownOverrides, forgetOverride, rememberOverride } from './known'
import { SETTINGS, SETTING_KEYS, isSettingKey, type SettingKey, type SettingValue } from './registry'

/**
 * How long one bulk read of AppSetting is reused in this instance (every key shares it). Saving a
 * setting clears it here at once; other instances pick the change up within this window. Kept at a
 * minute because settings are read on almost every request and each read returns every row.
 */
export const SETTINGS_CACHE_MS = 60_000
const FAILURE_CACHE_MS = 5_000

export interface Settings {
  get<K extends SettingKey>(key: K): SettingValue<K>
  /** True when a valid override row exists for the key (false: the code default, or env for a switch, applies). */
  isSet(key: SettingKey): boolean
  /** True when the whole read failed (database unreachable). */
  readFailed: boolean
  /** Keys whose stored value failed validation (treated as a read failure for that key). */
  invalidKeys: readonly SettingKey[]
}

const lastKnownGood = new Map<SettingKey, unknown>()
const warned = new Set<string>()
/** `fp`: the table's fingerprint taken before the read (null: unknown, so the next refresh re-reads). */
let cached: { at: number; ttl: number; settings: Settings; fp: string | null } | null = null
let inflight: Promise<Settings> | null = null

/** Test hook / after saving: forget the cached snapshot (and optionally the last-known-good values). */
export function clearSettingsCache(opts: { all?: boolean } = {}): void {
  cached = null
  inflight = null
  if (opts.all) {
    lastKnownGood.clear()
    clearKnownOverrides()
    warned.clear()
  }
}

function warnOnce(id: string, msg: string): void {
  if (warned.has(id)) return
  warned.add(id)
  console.warn(`[settings] ${msg}`)
}

function failureValue(key: SettingKey): unknown {
  const mode = SETTINGS[key].onReadFailure
  if (mode === 'throw') throw new Error(`Setting ${key} could not be read`)
  if (mode === 'lastKnownGood') return lastKnownGood.has(key) ? lastKnownGood.get(key) : SETTINGS[key].default
  return mode.value
}

function snapshot(
  values: Map<SettingKey, unknown>,
  readFailed: boolean,
  invalidKeys: SettingKey[],
  overrides: ReadonlySet<SettingKey> = new Set(),
): Settings {
  return {
    readFailed,
    invalidKeys,
    isSet: (key) => overrides.has(key),
    get<K extends SettingKey>(key: K): SettingValue<K> {
      if (values.has(key)) return values.get(key) as SettingValue<K>
      return failureValue(key) as SettingValue<K>
    },
  }
}

/** The database could not be read: no values, so every get() resolves through its failure mode. */
function failedRead(e: unknown): { settings: Settings; ttl: number } {
  warnOnce('db', `could not read AppSetting (${e instanceof Error ? e.message : String(e)}); using each setting's failure mode`)
  return { settings: snapshot(new Map(), true, []), ttl: FAILURE_CACHE_MS }
}

async function readAll(): Promise<{ settings: Settings; ttl: number }> {
  let rows: Array<{ key: string; value: unknown }>
  try {
    const r = await prisma.appSetting.findMany({ select: { key: true, value: true } })
    rows = Array.isArray(r) ? r : []
  } catch (e) {
    return failedRead(e)
  }

  const stored = new Map<string, unknown>(rows.map((r) => [r.key, r.value]))
  const values = new Map<SettingKey, unknown>()
  const invalid: SettingKey[] = []
  const overrides = new Set<SettingKey>()
  for (const key of SETTING_KEYS) {
    if (!stored.has(key)) {
      values.set(key, SETTINGS[key].default)
      lastKnownGood.set(key, SETTINGS[key].default)
      forgetOverride(key)
      continue
    }
    const parsed = (SETTINGS[key].schema as { safeParse(v: unknown): { success: boolean; data?: unknown } }).safeParse(stored.get(key))
    if (parsed.success) {
      values.set(key, parsed.data)
      overrides.add(key)
      lastKnownGood.set(key, parsed.data)
      rememberOverride(key, parsed.data)
    } else {
      invalid.push(key)
      warnOnce(`invalid:${key}`, `stored value for ${key} is invalid; using its failure mode`)
    }
  }
  // Unknown keys (e.g. written by a newer deploy sharing this database) are ignored.
  for (const k of stored.keys()) if (!isSettingKey(k)) warnOnce(`unknown:${k}`, `ignoring unknown setting key ${k}`)
  return { settings: snapshot(values, false, invalid, overrides), ttl: SETTINGS_CACHE_MS }
}

/**
 * Reuse the expired snapshot when the table's fingerprint is unchanged, else read every row. The
 * fingerprint is taken before the read, so a change landing during the read is caught next time.
 */
async function refresh(prev: typeof cached): Promise<{ settings: Settings; ttl: number; fp: string | null }> {
  let fp: string | null
  try {
    fp = await tableFingerprint('AppSetting')
  } catch (e) {
    // The database is unreachable: fail now (cached briefly) rather than wait for a second query.
    return { ...failedRead(e), fp: null }
  }
  if (fp && prev?.fp === fp && !prev.settings.readFailed) return { settings: prev.settings, ttl: SETTINGS_CACHE_MS, fp }
  const { settings, ttl } = await readAll()
  return { settings, ttl, fp: settings.readFailed ? null : fp }
}

/** All settings (cached ~60s). Never rejects. */
export async function loadSettings(now: number = Date.now()): Promise<Settings> {
  if (cached && now - cached.at < cached.ttl) return cached.settings
  if (!inflight) {
    const prev = cached
    const p: Promise<Settings> = refresh(prev)
      .then(({ settings, ttl, fp }) => {
        // A read that started before a save (clearSettingsCache) must not cache the old rows.
        if (inflight === p) cached = { at: now, ttl, settings, fp }
        return settings
      })
      .finally(() => {
        if (inflight === p) inflight = null
      })
    inflight = p
  }
  return inflight
}

/** One setting. Throws only for a key whose failure mode is 'throw' and could not be read. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  return (await loadSettings()).get(key)
}

export { knownOverride } from './known'
