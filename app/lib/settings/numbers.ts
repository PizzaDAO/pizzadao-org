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

/** Combine the value in force without a saved row (`base`) with a saved one, per the setting's direction. */
export function combineSaved(key: SettingKey, base: number, saved: number): number {
  const def = SETTINGS[key]
  if (!def.stricterOnly) return saved
  return def.looserWhen === 'lower' ? Math.max(base, saved) : Math.min(base, saved)
}

/** The effective number for an int setting. `legacy` is the env value, when the env var is set. */
export function effectiveInt(key: SettingKey, settings: Settings | undefined, legacy?: number): number {
  const base = legacy ?? (SETTINGS[key].default as number)
  const saved = storedOverride(key, settings)
  return saved ? combineSaved(key, base, saved.value as number) : base
}

/**
 * A plain (two-way) number setting: the saved value, else the code default. With no snapshot, the
 * default. An unreadable snapshot gives the last value this instance saw, then the default (the
 * registry's lastKnownGood failure mode).
 */
export function settingInt(key: SettingKey, settings?: Settings): number {
  return settings ? (settings.get(key) as number) : (SETTINGS[key].default as number)
}

type Env = Record<string, string | undefined>

/**
 * The env var behind each number that had one, and how it was read before settings existed
 * (so the admin page and the cross-field checks see the same legacy value the app uses).
 * `unit` scales a decimal env value into the setting's whole units.
 */
const LEGACY: Partial<Record<SettingKey, { env: string; read: 'int' | 'posInt' | 'grant' | 'posFloor' | 'scaled' | 'batch'; unit?: number }>> = {
  'games.minBet': { env: 'GAME_MIN_BET', read: 'int' },
  'games.maxBet': { env: 'GAME_MAX_BET', read: 'int' },
  'games.cooldownSeconds': { env: 'GAME_COOLDOWN_SECONDS', read: 'int' },
  'games.blackjackTimeoutSeconds': { env: 'BLACKJACK_TIMEOUT_SECONDS', read: 'int' },
  'crime.minPep': { env: 'CRIME_MIN_PEP', read: 'int' },
  'crime.maxPep': { env: 'CRIME_MAX_PEP', read: 'int' },
  'crime.failPercent': { env: 'CRIME_FAIL_PERCENT', read: 'int' },
  'crime.fineMinPercent': { env: 'CRIME_FINE_MIN_PERCENT', read: 'int' },
  'crime.fineMaxPercent': { env: 'CRIME_FINE_MAX_PERCENT', read: 'int' },
  'crime.cooldownSeconds': { env: 'CRIME_COOLDOWN_SECONDS', read: 'int' },
  'work.minPep': { env: 'WORK_MIN_PEP', read: 'int' },
  'work.maxPep': { env: 'WORK_MAX_PEP', read: 'int' },
  'work.cooldownSeconds': { env: 'WORK_COOLDOWN_SECONDS', read: 'int' },
  'economy.jobRewardAmount': { env: 'JOB_REWARD_AMOUNT', read: 'int' },
  'economy.adminGrantMax': { env: 'ADMIN_GRANT_MAX', read: 'grant' },
  'missions.runPepAlert': { env: 'MISSIONS_RUN_PEP_ALERT', read: 'int' },
  'slices.dailyCap': { env: 'SLICES_DAILY_CAP', read: 'posFloor' },
  'slices.maxGasMilliGwei': { env: 'SLICES_MAX_GAS_GWEI', read: 'scaled', unit: 1000 },
  'slices.minBalanceMilliEth': { env: 'SLICES_MIN_BALANCE_ETH', read: 'scaled', unit: 1000 },
  'portrait.dailyCap': { env: 'MAFIA_PORTRAIT_DAILY_CAP', read: 'posInt' },
  'reengage.batchSize': { env: 'REENGAGE_BATCH_SIZE', read: 'batch' },
  'portrait.publicDailyCap': { env: 'MAFIA_PORTRAIT_PUBLIC_DAILY_CAP', read: 'posInt' },
}

/** The env var that is the legacy value for a setting, if it has one. */
export function legacyEnvName(key: SettingKey): string | undefined {
  return LEGACY[key]?.env
}

/** The legacy (env) value for a setting in the setting's own units, or undefined when unset/unusable. */
export function legacyValue(key: SettingKey, env: Env = process.env): number | undefined {
  const l = LEGACY[key]
  if (!l) return undefined
  const raw = env[l.env]
  switch (l.read) {
    case 'int':
      return envNumber(raw)
    case 'posInt': {
      const v = envNumber(raw)
      return v !== undefined && v > 0 ? v : undefined
    }
    case 'grant': {
      const v = Number(raw)
      return Number.isInteger(v) && v > 0 && v <= 2_147_483_647 ? v : undefined
    }
    case 'posFloor': {
      const v = Number(raw?.trim())
      return Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined
    }
    case 'batch': {
      // How the re-engagement run always read it: a positive number, whole, never above the code ceiling.
      const v = Number(raw)
      return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 300) : undefined
    }
    case 'scaled': {
      const v = Number(raw?.trim())
      return Number.isFinite(v) && v > 0 ? v * (l.unit ?? 1) : undefined
    }
  }
}

/** What is in force for an int setting when nothing is saved: the legacy value, else the code default. */
export function baselineInt(key: SettingKey, env: Env = process.env): number {
  return legacyValue(key, env) ?? (SETTINGS[key].default as number)
}
