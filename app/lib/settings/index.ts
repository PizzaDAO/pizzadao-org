/**
 * Cached, fail-safe read path for admin settings (plans/app-settings.md 4.3).
 *
 *   const s = await loadSettings()      // one query for all rows, cached ~30s per instance
 *   s.get('missions.maxAttempts')       // typed
 *   await getSetting('disavow.minLevel')
 *
 * Never throws for a bad row or an unreachable database (except keys whose failure mode is
 * 'throw'): a missing row gives the code default; an unreadable or invalid value gives the
 * key's onReadFailure value (see registry.ts). A failed read is cached only briefly.
 */
import { prisma } from '@/app/lib/db'
import { SETTINGS, SETTING_KEYS, isSettingKey, type SettingKey, type SettingValue } from './registry'

export const SETTINGS_CACHE_MS = 30_000
const FAILURE_CACHE_MS = 5_000

export interface Settings {
  get<K extends SettingKey>(key: K): SettingValue<K>
  /** True when the whole read failed (database unreachable). */
  readFailed: boolean
  /** Keys whose stored value failed validation (treated as a read failure for that key). */
  invalidKeys: readonly SettingKey[]
}

const lastKnownGood = new Map<SettingKey, unknown>()
const warned = new Set<string>()
let cached: { at: number; ttl: number; settings: Settings } | null = null
let inflight: Promise<Settings> | null = null

/** Test hook / after saving: forget the cached snapshot (and optionally the last-known-good values). */
export function clearSettingsCache(opts: { all?: boolean } = {}): void {
  cached = null
  inflight = null
  if (opts.all) {
    lastKnownGood.clear()
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

function snapshot(values: Map<SettingKey, unknown>, readFailed: boolean, invalidKeys: SettingKey[]): Settings {
  return {
    readFailed,
    invalidKeys,
    get<K extends SettingKey>(key: K): SettingValue<K> {
      if (values.has(key)) return values.get(key) as SettingValue<K>
      return failureValue(key) as SettingValue<K>
    },
  }
}

async function readAll(): Promise<{ settings: Settings; ttl: number }> {
  let rows: Array<{ key: string; value: unknown }>
  try {
    const r = await prisma.appSetting.findMany({ select: { key: true, value: true } })
    rows = Array.isArray(r) ? r : []
  } catch (e) {
    warnOnce('db', `could not read AppSetting (${e instanceof Error ? e.message : String(e)}); using each setting's failure mode`)
    // No values: every get() resolves through its failure mode.
    return { settings: snapshot(new Map(), true, []), ttl: FAILURE_CACHE_MS }
  }

  const stored = new Map<string, unknown>(rows.map((r) => [r.key, r.value]))
  const values = new Map<SettingKey, unknown>()
  const invalid: SettingKey[] = []
  for (const key of SETTING_KEYS) {
    if (!stored.has(key)) {
      values.set(key, SETTINGS[key].default)
      lastKnownGood.set(key, SETTINGS[key].default)
      continue
    }
    const parsed = (SETTINGS[key].schema as { safeParse(v: unknown): { success: boolean; data?: unknown } }).safeParse(stored.get(key))
    if (parsed.success) {
      values.set(key, parsed.data)
      lastKnownGood.set(key, parsed.data)
    } else {
      invalid.push(key)
      warnOnce(`invalid:${key}`, `stored value for ${key} is invalid; using its failure mode`)
    }
  }
  // Unknown keys (e.g. written by a newer deploy sharing this database) are ignored.
  for (const k of stored.keys()) if (!isSettingKey(k)) warnOnce(`unknown:${k}`, `ignoring unknown setting key ${k}`)
  return { settings: snapshot(values, false, invalid), ttl: SETTINGS_CACHE_MS }
}

/** All settings (cached ~30s). Never rejects. */
export async function loadSettings(now: number = Date.now()): Promise<Settings> {
  if (cached && now - cached.at < cached.ttl) return cached.settings
  if (!inflight) {
    inflight = readAll()
      .then(({ settings, ttl }) => {
        cached = { at: now, ttl, settings }
        return settings
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** One setting. Throws only for a key whose failure mode is 'throw' and could not be read. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  return (await loadSettings()).get(key)
}
