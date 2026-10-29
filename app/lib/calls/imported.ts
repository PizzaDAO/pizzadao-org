/**
 * Imported calls (source != DISCORD): the guards that keep an old X broadcast from behaving like a
 * live Discord call. Every behaviour is a feature switch (`calls.imported*`, default OFF; see
 * settings/toggles.ts for the rules: an env var set to off always wins, unreadable or invalid settings
 * mean off, and previews ignore saved values because they share the production database).
 */
import { loadSettings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import type { SettingKey } from '@/app/lib/settings/registry'

/** Where-fragment for readers that must only ever see Discord-recorded calls. */
export const DISCORD_ONLY = { source: 'DISCORD' } as const

export type ImportedSettingKey = Extract<
  SettingKey,
  'calls.importedRecapPostEnabled' | 'calls.importedFollowupsEnabled' | 'calls.importedAgendaContext' | 'calls.importedAutoSummarize'
>

export const isImportedSource = (source: string | null | undefined): boolean => !!source && source !== 'DISCORD'

type Env = Record<string, string | undefined>

/** Whether imported calls may do the thing `key` guards. Never throws. */
export async function importedAllowed(key: ImportedSettingKey, env: Env = process.env): Promise<boolean> {
  try {
    return resolveToggle(key, await loadSettings(), env) === true
  } catch {
    return false
  }
}
