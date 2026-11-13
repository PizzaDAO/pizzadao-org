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
  // On unless the env var is an explicit off (the kill switch): recap mentions notify the people they name.
  'calls.recapMentionPing': { env: 'CALL_RECAP_MENTION_PING_ENABLED', legacy: (raw) => !envKillsToggle(raw) },
  'calls.agendaPostEnabled': {
    env: 'CALL_AGENDA_POST_ENABLED',
    legacy: (raw) => ['true', '1'].includes((raw ?? '').trim().toLowerCase()),
  },
  'education.sessionAnnounceEnabled': { env: 'EDUCATION_SESSION_ANNOUNCE_ENABLED', legacy: ON_WORDS },
  'calls.dstFixEnabled': { env: 'CALL_DST_FIX_ENABLED', legacy: ON_WORDS },
  'calls.endSongTriggerEnabled': { env: 'CALL_END_SONG_ENABLED', legacy: ON_WORDS },
  'calls.playOutCommandEnabled': { env: 'CALL_PLAY_OUT_COMMAND_ENABLED', legacy: ON_WORDS },
  'calls.playOutAnyMember': { env: 'CALL_PLAY_OUT_ANY_MEMBER', legacy: ON_WORDS },
  'calls.startBandEnabled': { env: 'CALL_START_BAND_ENABLED', legacy: ON_WORDS },
  'calls.progressReportEnabled': { env: 'CALL_PROGRESS_ENABLED', legacy: ON_WORDS },
  'calls.liveAnnounceCommandEnabled': { env: 'CALL_LIVE_ANNOUNCE_COMMAND_ENABLED', legacy: ON_WORDS },
  'calls.liveAnnounceAutoEnabled': { env: 'CALL_LIVE_ANNOUNCE_AUTO_ENABLED', legacy: ON_WORDS },
  'calls.liveReminderEnabled': { env: 'CALL_LIVE_REMINDER_ENABLED', legacy: ON_WORDS },
  'calls.progressShowFollowups': { env: 'CALL_PROGRESS_FOLLOWUPS_ENABLED', legacy: ON_WORDS },
  // Off unless turned on: spoken call updates and their /metalhead command (plans/metalhead-reads-updates.md).
  'calls.updatesEnabled': { env: 'CALL_UPDATES_ENABLED', legacy: ON_WORDS },
  'calls.updatesControlAnyMember': { env: 'CALL_UPDATES_CONTROL_ANY_MEMBER', legacy: ON_WORDS },
  'discord.metalheadCommandEnabled': { env: 'METALHEAD_COMMAND_ENABLED', legacy: ON_WORDS },
  'vouches.requestsEnabled': { env: 'VOUCH_REQUESTS_ENABLED', legacy: ON_WORDS },
  'vouches.quickVouchEnabled': { env: 'VOUCH_QUICK_ENABLED', legacy: ON_WORDS },
  'vouches.showVouchersEnabled': { env: 'VOUCH_SHOW_VOUCHERS_ENABLED', legacy: ON_WORDS },
  'dashboard.levelCardEnabled': { env: 'DASHBOARD_LEVEL_CARD_ENABLED', legacy: ON_WORDS },
  'discord.vouchCommandEnabled': { env: 'VOUCH_COMMAND_ENABLED', legacy: ON_WORDS },
  'discord.levelCommandEnabled': { env: 'LEVEL_COMMAND_ENABLED', legacy: ON_WORDS },
  'discord.profileCommandEnabled': { env: 'PROFILE_COMMAND_ENABLED', legacy: ON_WORDS },
  'calls.welcomeEnabled': { env: 'CALL_WELCOME_ENABLED', legacy: ON_WORDS },
  'calls.liveActionItemsEnabled': { env: 'CALL_LIVE_ACTION_ITEMS_ENABLED', legacy: ON_WORDS },
  'calls.chatActionItemsEnabled': { env: 'CALL_CHAT_ACTION_ITEMS_ENABLED', legacy: ON_WORDS },
  'calls.liveViewEnabled': { env: 'CALL_LIVE_VIEW_ENABLED', legacy: ON_WORDS },
  'calls.taskProposalsEnabled': { env: 'CALL_TASK_PROPOSALS_ENABLED', legacy: ON_WORDS },
  'calls.taskProposalsNudgeEnabled': { env: 'CALL_TASK_PROPOSALS_NUDGE_ENABLED', legacy: ON_WORDS },
  'calls.importedRecapPostEnabled': { env: 'CALL_IMPORT_RECAP_ENABLED', legacy: ON_WORDS },
  'calls.importedFollowupsEnabled': { env: 'CALL_IMPORT_FOLLOWUPS_ENABLED', legacy: ON_WORDS },
  'calls.importedAgendaContext': { env: 'CALL_IMPORT_AGENDA_ENABLED', legacy: ON_WORDS },
  'calls.importedAutoSummarize': { env: 'CALL_IMPORT_AUTOSUMMARY_ENABLED', legacy: ON_WORDS },
  'calls.attendanceFromRecordings': { env: 'CALL_ATTENDANCE_FROM_RECORDINGS_ENABLED', legacy: ON_WORDS },
  'disavow.enabled': {
    env: 'DISAVOW_ENABLED',
    legacy: (raw) => ['true', '1'].includes((raw ?? '').trim().toLowerCase()),
  },
  'names.requireThemed': { env: 'REQUIRE_THEMED_NAMES', legacy: ON_WORDS },
  'telegram.dmEnabled': { env: 'TELEGRAM_DM_ENABLED', legacy: ON_WORDS },
  'proposals.historyEnabled': {
    env: 'PROPOSALS_HISTORY_ENABLED',
    legacy: (raw) => ['true', '1'].includes((raw ?? '').trim().toLowerCase()),
  },
  'proposals.enabled': {
    env: 'PROPOSALS_ENABLED',
    legacy: (raw) => ['true', '1'].includes((raw ?? '').trim().toLowerCase()),
  },
  'reengage.enabled': { env: 'REENGAGE_EMAIL_ENABLED', legacy: (raw) => (raw ?? '').trim().toLowerCase() === 'true' },
  'onboarding.traineeNickHealEnabled': { env: 'TRAINEE_NICK_HEAL_ENABLED', legacy: ON_WORDS },
  'onboarding.traineeNickEnabled': { env: 'TRAINEE_NICK_ENABLED', legacy: (raw) => raw === 'true' },
  'games.enabled': { env: 'PEP_GAMES_ENABLED', legacy: (raw) => raw === '1' },
  'crime.enabled': { env: 'PEP_CRIME_ENABLED', legacy: (raw) => raw === '1' },
  'pfp.restyleEnabled': { env: 'PFP_RESTYLE_ENABLED', legacy: ON_WORDS },
  'pfp.outfitOverlayEnabled': { env: 'PFP_OUTFIT_OVERLAY_ENABLED', legacy: ON_WORDS },
  'portrait.enabled': { env: 'MAFIA_PORTRAIT_ENABLED', legacy: (raw) => raw === '1' },
  // Both on unless the env var is an explicit off (the kill switch).
  'jobs.verifyPosts': { env: 'JOBS_VERIFY_POSTS', legacy: (raw) => !envKillsToggle(raw) },
  'jobs.unverifiableJobsPayOnClick': { env: 'JOBS_UNVERIFIABLE_PAY_ON_CLICK', legacy: (raw) => !envKillsToggle(raw) },
  // On unless the env var is exactly "0" (independent of the one-time migration flag).
  'shop.itemGrantsEnabled': { env: 'ITEM_GRANT_CLAIMS', legacy: (raw) => raw !== '0' },
  'shop.sheetSyncEnabled': { env: 'SHOP_SHEET_SYNC_ENABLED', legacy: (raw) => raw?.trim() === '1' },
  'telegram.cityPostsEnabled': { env: 'TELEGRAM_CITY_POSTS_ENABLED', legacy: ON_WORDS },
  'telegram.recapMirrorEnabled': { env: 'TELEGRAM_RECAP_MIRROR_ENABLED', legacy: ON_WORDS },
  'telegram.agendaMirrorEnabled': { env: 'TELEGRAM_AGENDA_MIRROR_ENABLED', legacy: ON_WORDS },
  'telegram.announceMirrorEnabled': { env: 'TELEGRAM_ANNOUNCE_MIRROR_ENABLED', legacy: ON_WORDS },
  'telegram.sessionMirrorEnabled': { env: 'TELEGRAM_SESSION_MIRROR_ENABLED', legacy: ON_WORDS },
  'telegram.hostMatchEnabled': { env: 'TELEGRAM_HOST_MATCH_ENABLED', legacy: ON_WORDS },
  // On unless the env var is an explicit off (plans/sheets-cutover.md: keep the archive current until the freeze).
  'sheets.mirror.members': { env: 'SHEETS_MIRROR_MEMBERS', legacy: (raw) => !envKillsToggle(raw) },
  // Off unless turned on. The public reach map shows nothing and the endpoint answers 404 until then.
  'map.levelsEnabled': { env: 'MAP_LEVELS_ENABLED', legacy: ON_WORDS },
  // Off unless turned on: opt-in call reminders by Discord DM (plans/voting-golive-and-reminders.md, B1).
  'reminders.callsEnabled': { env: 'REMINDERS_CALLS_ENABLED', legacy: ON_WORDS },
  // Off unless turned on: opt-in proposal reminders by Discord DM (B2). Also needs proposals.enabled.
  'reminders.proposalsEnabled': { env: 'REMINDERS_PROPOSALS_ENABLED', legacy: ON_WORDS },
  // Off unless turned on: the nightly crew roster auto-add from call attendance (counts only while off).
  'crews.rosterAutoAddEnabled': { env: 'CREWS_ROSTER_AUTOADD_ENABLED', legacy: ON_WORDS },
  // Off unless turned on: digest of website crew task changes in the crew's Discord channel.
  'crews.taskUpdatePostsEnabled': { env: 'CREWS_TASK_UPDATE_POSTS_ENABLED', legacy: ON_WORDS },
  // Off unless turned on: past attendees as Cold bench rows on the crew page.
  'crews.rosterBenchEnabled': { env: 'CREWS_ROSTER_BENCH_ENABLED', legacy: ON_WORDS },
  // Off unless turned on: the marketing pages' forms and calendar (plans/pizzadao-org-to-vercel.md, Phase 2).
  'marketing.newsletterEnabled': { env: 'MARKETING_NEWSLETTER_ENABLED', legacy: ON_WORDS },
  'marketing.contactEnabled': { env: 'MARKETING_CONTACT_ENABLED', legacy: ON_WORDS },
  'marketing.calendarEnabled': { env: 'MARKETING_CALENDAR_ENABLED', legacy: ON_WORDS },
  // Off unless turned on: redirect page requests on the old app host to the main site, and carry the login across.
  'site.hostRedirectEnabled': { env: 'SITE_HOST_REDIRECT_ENABLED', legacy: ON_WORDS },
  'site.sessionBridgeEnabled': { env: 'SITE_SESSION_BRIDGE_ENABLED', legacy: ON_WORDS },
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
