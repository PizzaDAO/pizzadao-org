/**
 * Imported calls (source != DISCORD): the guards that keep an old X broadcast from behaving like a
 * live Discord call. Every behaviour is gated by a `calls.imported*` setting that defaults to OFF
 * (plans/x-call-import.md). Fail-safe: if the settings cannot be read or hold an invalid value the answer
 * is "no", and on any deploy that is not production the answer is always "no", because previews share
 * the production database and a saved ON must never reach them.
 */
import { loadSettings } from '@/app/lib/settings'
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
    if (env.VERCEL_ENV !== 'production') return false
    const settings = await loadSettings()
    if (settings.readFailed || settings.invalidKeys.includes(key)) return false
    return settings.get(key) === 1
  } catch {
    return false
  }
}
