/**
 * The last saved value each setting was read with (never a code default). Lives apart from the
 * loader so pure readers (numbers.ts) can use it without importing the database client.
 */
import type { SettingKey } from './registry'

const lastKnownOverride = new Map<SettingKey, unknown>()

export function rememberOverride(key: SettingKey, value: unknown): void {
  lastKnownOverride.set(key, value)
}

export function forgetOverride(key: SettingKey): void {
  lastKnownOverride.delete(key)
}

export function clearKnownOverrides(): void {
  lastKnownOverride.clear()
}

/** The last saved value this instance read for a key (undefined when it never saw a row). */
export function knownOverride(key: SettingKey): { value: unknown } | undefined {
  return lastKnownOverride.has(key) ? { value: lastKnownOverride.get(key) } : undefined
}
