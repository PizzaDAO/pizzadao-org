/**
 * Where each data set is read from during the Google Sheets cutover (plans/sheets-cutover.md 3.1).
 *
 * The effective source, in order:
 *   1. the env var (SHEETS_SOURCE_<X>) set to "sheet" -> sheet. A hard kill switch: no setting
 *      can override it.
 *   2. the env var set to "db" (or "db:crew-a,crew-b") -> that value. This is how a preview is
 *      flipped, since previews ignore saved rows.
 *   3. on any deploy that is not production -> sheet (previews share the production database, so
 *      a saved "db" must never reach them).
 *   4. the saved setting `sheets.source.<x>` (a brief read failure keeps the last value in force).
 *   5. otherwise sheet.
 *
 * Read paths branch in one place (the existing repository module of each data set), so callers do
 * not change.
 */
import { loadSettings, type Settings } from '@/app/lib/settings'
import type { SettingKey } from '@/app/lib/settings/registry'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { isValidSourceValue, SHEET_SOURCES, type SheetSourceKey } from '@/app/lib/settings/sheets-settings'

type Env = Record<string, string | undefined>

export type SourceKind = 'sheet' | 'db'

export interface ResolvedSource {
  kind: SourceKind
  /** For a per-crew pilot (`db:crew-a,crew-b`): the crews that read from the database. Null = all. */
  crews: ReadonlySet<string> | null
  /** What decided it, for the admin page. */
  reason: 'env-kill' | 'env' | 'preview' | 'setting' | 'default'
  raw: string
}

const SHEET: Omit<ResolvedSource, 'reason'> = { kind: 'sheet', crews: null, raw: 'sheet' }

export function sourceSettingKey(key: SheetSourceKey): SettingKey {
  return `sheets.source.${key}` as SettingKey
}

/** Parse a stored or env value. Invalid -> null. */
export function parseSourceValue(raw: string, crewList: boolean): Omit<ResolvedSource, 'reason'> | null {
  const s = raw.trim()
  if (!isValidSourceValue(s, crewList)) return null
  if (s === 'sheet') return SHEET
  if (s === 'db') return { kind: 'db', crews: null, raw: s }
  const ids = s.slice(3).split(',').map((x) => x.trim()).filter(Boolean)
  return { kind: 'db', crews: new Set(ids), raw: s }
}

/** Pure resolution against an already-loaded settings snapshot. */
export function resolveSource(key: SheetSourceKey, settings: Settings, env: Env = process.env): ResolvedSource {
  const def = SHEET_SOURCES[key]
  const envRaw = (env[def.env] ?? '').trim()
  if (envRaw.toLowerCase() === 'sheet') return { ...SHEET, reason: 'env-kill' }
  if (envRaw) {
    const parsed = parseSourceValue(envRaw, def.crewList)
    // An unreadable env value is treated as the kill switch: fail toward the sheet.
    return parsed ? { ...parsed, reason: 'env' } : { ...SHEET, reason: 'env-kill' }
  }
  if (env.VERCEL_ENV !== 'production') return { ...SHEET, reason: 'preview' }
  const settingKey = sourceSettingKey(key)
  if (!settings.isSet(settingKey) && !settings.readFailed) return { ...SHEET, reason: 'default' }
  // A failed read gives the last value in force (registry onReadFailure: lastKnownGood).
  const parsed = parseSourceValue(String(settings.get(settingKey) ?? 'sheet'), def.crewList)
  return parsed ? { ...parsed, reason: 'setting' } : { ...SHEET, reason: 'default' }
}

/** The effective source for a data set right now (settings cached ~30s). Never throws. */
export async function getSource(key: SheetSourceKey, env: Env = process.env): Promise<ResolvedSource> {
  // The env var or a preview decides without reading settings (no database round trip).
  if ((env[SHEET_SOURCES[key].env] ?? '').trim() || env.VERCEL_ENV !== 'production') return resolveSource(key, NO_SETTINGS, env)
  return resolveSource(key, await loadSettings(), env)
}

/** Never consulted: resolveSource returns before reading settings when env or a preview decides. */
const NO_SETTINGS: Settings = {
  get: (() => 'sheet') as Settings['get'],
  isSet: () => false,
  readFailed: false,
  invalidKeys: [],
}

/** True when this data set (and, for a per-crew pilot, this crew) reads from the database. */
export function readsFromDb(source: ResolvedSource, crewId?: string | null): boolean {
  if (source.kind !== 'db') return false
  if (!source.crews) return true
  return !!crewId && source.crews.has(crewId)
}

/** Shorthand: does this data set read from the database right now? */
export async function usesDb(key: SheetSourceKey, crewId?: string | null): Promise<boolean> {
  return readsFromDb(await getSource(key), crewId)
}

/** Whether member writes are also copied to the old sheet (only meaningful while members read from the DB). */
export async function membersMirrorEnabled(env: Env = process.env): Promise<boolean> {
  return toggleEnabled('sheets.mirror.members', env)
}
