/**
 * Economy and spend numbers that used to be env reads or constants (plans/app-settings.md, phase 4).
 *
 * Resolution for one number, in order:
 *   1. a saved setting (a row), if it can be read;
 *   2. unreadable settings (database down, stored value invalid): the last saved value this
 *      instance saw, if any;
 *   3. the env var as before (the legacy value), so deploying changes nothing;
 *   4. the code default.
 *
 * "Stricter-only" settings (every spend cap and payout limit) are a CEILING: the saved value can
 * only tighten the legacy value, never loosen it. The effective value is min(legacy, saved) when
 * higher is looser, and max(legacy, saved) when lower is looser. So an env value that is already
 * stricter than a saved row still wins, and loosening past today's values needs a code change.
 *
 * The functions are pure over an already-loaded snapshot, so they stay synchronous; entry points
 * call `loadSettings()` once. With no snapshot, only the legacy value and the default are used.
 */
import { knownOverride } from './known'
import type { Settings } from './index'
import { SETTINGS, type SettingKey } from './registry'

/** A whole number from an env var, or undefined when unset or not a number. */
export function envNumber(raw: string | undefined): number | undefined {
  const v = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(v) ? v : undefined
}

/** The saved value for a key if one can be used right now; undefined means "no override applies". */
export function storedOverride(key: SettingKey, settings: Settings | undefined): { value: unknown } | undefined {
  if (!settings) return undefined
  if (settings.isSet(key)) return { value: settings.get(key) }
  if (settings.readFailed || settings.invalidKeys.includes(key)) return knownOverride(key)
  return undefined
}

/** The effective whole number for an int setting. `legacy` is the env value, when the env var is set. */
export function effectiveInt(key: SettingKey, settings: Settings | undefined, legacy?: number): number {
  const def = SETTINGS[key]
  const base = legacy ?? (def.default as number)
  const saved = storedOverride(key, settings)
  if (!saved) return base
  const value = saved.value as number
  if (!def.stricterOnly) return value
  return def.looserWhen === 'lower' ? Math.max(base, value) : Math.min(base, value)
}
