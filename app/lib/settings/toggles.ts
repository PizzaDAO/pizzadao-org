/**
 * Feature switches that used to be env-only (plans/app-settings.md 4.6).
 *
 * The effective value, in order:
 *   1. the env var set to off (0 / false / off / no) -> OFF. A hard kill switch for whoever runs
 *      the infrastructure; no setting can override it.
 *   2. the settings cannot be read (database down, stored value invalid) -> OFF. Anything that
 *      posts, pays or emails stays quiet until the settings read again.
 *   3. a saved setting -> that value.
 *   4. otherwise the env var as before (the legacy default), so deploying changes nothing.
 *
 * Previews share this database, so on any deploy that is not production (VERCEL_ENV !== "production")
 * saved rows are ignored and only the env var decides (after step 1): a saved ON never reaches a preview.
 *
 * Slices arming and the one-time migration flags are deliberately NOT here: they stay env-only
 * (previews share this database, so a database switch would arm them on previews too).
 */
import { loadSettings, type Settings } from './index'
import type { SettingKey } from './registry'

type Env = Record<string, string | undefined>

const ON_WORDS = (raw: string | undefined) => ['1', 'true', 'on', 'yes'].includes((raw ?? '').trim().toLowerCase())

export interface ToggleDef {
  /** The env var that used to be the only switch. */
  env: string
  /** Whether the env value alone turned it on before this existed (today's behaviour). */
  legacy: (raw: string | undefined) => boolean
}

export const TOGGLES = {
  'missions.verifiersEnabled': { env: 'MISSION_VERIFIERS_ENABLED', legacy: ON_WORDS },
  'missions.reviewCardsEnabled': { env: 'MISSION_REVIEW_CARDS_ENABLED', legacy: ON_WORDS },
  'calls.recapPostEnabled': { env: 'CALL_RECAP_POST_ENABLED', legacy: ON_WORDS },
  'calls.agendaPostEnabled': {
    env: 'CALL_AGENDA_POST_ENABLED',
    legacy: (raw) => ['true', '1'].includes((raw ?? '').trim().toLowerCase()),
  },
  'calls.importedRecapPostEnabled': { env: 'CALL_IMPORT_RECAP_ENABLED', legacy: ON_WORDS },
  'calls.importedFollowupsEnabled': { env: 'CALL_IMPORT_FOLLOWUPS_ENABLED', legacy: ON_WORDS },
  'calls.importedAgendaContext': { env: 'CALL_IMPORT_AGENDA_ENABLED', legacy: ON_WORDS },
  'calls.importedAutoSummarize': { env: 'CALL_IMPORT_AUTOSUMMARY_ENABLED', legacy: ON_WORDS },
  'disavow.enabled': {
    env: 'DISAVOW_ENABLED',
    legacy: (raw) => ['true', '1'].includes((raw ?? '').trim().toLowerCase()),
  },
  'telegram.dmEnabled': { env: 'TELEGRAM_DM_ENABLED', legacy: ON_WORDS },
  'proposals.enabled': {
    env: 'PROPOSALS_ENABLED',
    legacy: (raw) => ['true', '1'].includes((raw ?? '').trim().toLowerCase()),
  },
  'reengage.enabled': { env: 'REENGAGE_EMAIL_ENABLED', legacy: (raw) => (raw ?? '').trim().toLowerCase() === 'true' },
  'onboarding.traineeNickEnabled': { env: 'TRAINEE_NICK_ENABLED', legacy: (raw) => raw === 'true' },
  'games.enabled': { env: 'PEP_GAMES_ENABLED', legacy: (raw) => raw === '1' },
  'crime.enabled': { env: 'PEP_CRIME_ENABLED', legacy: (raw) => raw === '1' },
  'portrait.enabled': { env: 'MAFIA_PORTRAIT_ENABLED', legacy: (raw) => raw === '1' },
  // On unless the env var is exactly "0" (independent of the one-time migration flag).
  'shop.itemGrantsEnabled': { env: 'ITEM_GRANT_CLAIMS', legacy: (raw) => raw !== '0' },
  'shop.sheetSyncEnabled': { env: 'SHOP_SHEET_SYNC_ENABLED', legacy: (raw) => raw?.trim() === '1' },
  'telegram.cityPostsEnabled': { env: 'TELEGRAM_CITY_POSTS_ENABLED', legacy: ON_WORDS },
  'telegram.recapMirrorEnabled': { env: 'TELEGRAM_RECAP_MIRROR_ENABLED', legacy: ON_WORDS },
  'telegram.agendaMirrorEnabled': { env: 'TELEGRAM_AGENDA_MIRROR_ENABLED', legacy: ON_WORDS },
  'telegram.announceMirrorEnabled': { env: 'TELEGRAM_ANNOUNCE_MIRROR_ENABLED', legacy: ON_WORDS },
} as const satisfies Partial<Record<SettingKey, ToggleDef>>

export type ToggleKey = keyof typeof TOGGLES

export function isToggleKey(key: string): key is ToggleKey {
  return Object.prototype.hasOwnProperty.call(TOGGLES, key)
}

/** The env var is set to an explicit "off": the kill switch. */
export function envKillsToggle(raw: string | undefined): boolean {
  return ['0', 'false', 'off', 'no'].includes((raw ?? '').trim().toLowerCase())
}

/** Pure resolution against an already-loaded snapshot (bulk runs load once). */
export function resolveToggle(key: ToggleKey, settings: Settings, env: Env = process.env): boolean {
  const def: ToggleDef = TOGGLES[key]
  const raw = env[def.env]
  if (envKillsToggle(raw)) return false
  // Previews share the production database: a saved ON must never reach them.
  if (env.VERCEL_ENV !== 'production') return def.legacy(raw)
  if (settings.readFailed || settings.invalidKeys.includes(key)) return false
  if (settings.isSet(key)) return settings.get(key) as boolean
  return def.legacy(raw)
}

/** Whether a switch is on right now (settings cached ~30s). Never throws. */
export async function toggleEnabled(key: ToggleKey, env: Env = process.env): Promise<boolean> {
  return resolveToggle(key, await loadSettings(), env)
}

/** Admin page detail for a switch: what the env says and what is in force. */
export function describeToggle(key: ToggleKey, settings: Settings, env: Env = process.env) {
  const def: ToggleDef = TOGGLES[key]
  const raw = env[def.env]
  return {
    env: def.env,
    envKill: envKillsToggle(raw),
    envOn: def.legacy(raw),
    effective: resolveToggle(key, settings, env),
  }
}
