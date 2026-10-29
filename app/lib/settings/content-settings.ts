/**
 * Content and cleanup settings (plans/app-settings.md, phase 5): call recap and agenda sizes, the
 * summary model and its private prompt addendum, re-engagement email pacing, abuse caps, roster
 * audit levels, mafia points and ranks, the /work replies and the private call post filter.
 *
 * Rules for this group:
 * - Every default equals the constant or env value it replaced, so deploying changes nothing
 *   (content-settings.test.ts locks each one).
 * - Everything is bounded (numbers have min/max, lists have a length and per-entry limits).
 * - Only the re-engagement batch size can loosen a send rate, so it is stricter-only (a ceiling
 *   over the legacy value, like the phase 4 spend caps). Content sizes and abuse caps take their
 *   full range: nothing is paid, approved or spent through them.
 * - Private values (the prompt addendum, the call post filter) are masked in every admin view and
 *   audit row, and fail closed: unreadable means the caller skips (see each key).
 *
 * This file imports only types from ./registry (no runtime cycle).
 */
import { z } from 'zod'
import { MAFIA_POINT_SOURCES, MAFIA_RANKS } from '@/app/lib/mafia-points/config'
import { DEFAULT_WORK_PROMPTS } from '@/app/lib/pep-earn/work-prompts'
import { MAX_FILTER_ENTRIES, MAX_FILTER_ENTRY_CHARS, cleanList } from '@/app/lib/calls/post-filter-lists'
import { num } from './economy-settings'
import type { SettingDef } from './registry'

const SOURCE_IDS = MAFIA_POINT_SOURCES.map((s) => s.id) as [string, ...string[]]

/** gateway model ids: `provider/model`, providers limited to ones the gateway routes to. */
const MODEL_ID = /^(anthropic|openai|google|xai|mistral|meta|deepseek)\/[A-Za-z0-9._-]{1,60}$/

const summaryModel: SettingDef<string> = {
  key: 'calls.summaryModel',
  area: 'calls',
  label: 'Call summary model',
  help: 'The AI model that writes call summaries, as provider/model (for example anthropic/claude-sonnet-5.5). Empty uses the CALL_SUMMARY_MODEL env var, else the built-in model. A wrong id makes summaries fail (they are retried), so check the next summary after changing it. Only anthropic, openai, google, xai, mistral, meta and deepseek models are accepted.',
  schema: z.string().trim().max(80).refine((v) => v === '' || MODEL_ID.test(v), 'Use provider/model, for example anthropic/claude-sonnet-5.5'),
  default: '',
  onReadFailure: { value: '' },
  input: { type: 'text', maxLength: 80, placeholder: 'provider/model' },
}

/**
 * Editorial text appended to the summary instructions. Private: masked in views and audit. If it cannot
 * be read, the summary fails (and is retried) rather than being written without it.
 */
const summaryPromptExtra: SettingDef<string> = {
  key: 'calls.summaryPromptExtra',
  area: 'calls',
  label: 'Call summary instructions (private)',
  help: 'Extra instructions added after the built-in summary rules. Never shown again after saving (the page only says set or not set); saving replaces it, reset clears it. Empty adds nothing.',
  schema: z.string().trim().max(2000),
  default: '',
  onReadFailure: 'throw',
  input: { type: 'text', maxLength: 2000, multiline: true },
  private: true,
}

const stringEntry = z.string().trim().min(1).max(MAX_FILTER_ENTRY_CHARS)
const filterList = z.array(stringEntry).max(MAX_FILTER_ENTRIES).transform((l) => cleanList(l))

/** The three call post filter lists. Private. Unreadable or invalid means the callers skip posting. */
const postFilter: SettingDef<{ excludedCrewIds: string[]; excludedCrewLabelTerms: string[]; blockedTerms: string[] }> = {
  key: 'calls.postFilter',
  area: 'calls',
  label: 'Call post filter (private)',
  help: 'Crews and terms left out of the automated agenda and recap posts. Edited on the call review page; this page only shows whether it is set.',
  schema: z.object({ excludedCrewIds: filterList, excludedCrewLabelTerms: filterList, blockedTerms: filterList }),
  default: { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [] },
  onReadFailure: 'throw',
  input: { type: 'managed', href: '/admin/calls' },
  private: true,
}

const workPrompts: SettingDef<string[]> = {
  key: 'work.prompts',
  area: 'economy',
  label: 'Work replies',
  help: 'The replies /work picks from, one per line. Put {amount} where the payout should appear. Empty is not allowed; reset restores the WORK_PROMPTS_JSON env replies if set, else the built-in ones.',
  schema: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  default: [...DEFAULT_WORK_PROMPTS],
  onReadFailure: 'lastKnownGood',
  input: { type: 'stringList', maxItems: 20, maxLength: 500 },
}

const mafiaSourcePoints: SettingDef<Array<{ id: string; points: number }>> = {
  key: 'mafia.sourcePoints',
  area: 'mafia',
  label: 'Mafia points per source',
  help: 'Points each source is worth. Which sources exist stays in code; a source left out keeps its built-in value. Rank results are cached for a few hours, so changes show up gradually.',
  schema: z
    .array(z.object({ id: z.enum(SOURCE_IDS), points: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(SOURCE_IDS.length)
    .superRefine((rows, ctx) => {
      const seen = new Set<string>()
      rows.forEach((r, i) => {
        if (seen.has(r.id)) ctx.addIssue({ code: 'custom', path: [i], message: `${r.id} is listed twice` })
        seen.add(r.id)
      })
    }),
  default: MAFIA_POINT_SOURCES.map((s) => ({ id: s.id, points: s.points })),
  onReadFailure: 'lastKnownGood',
  input: {
    type: 'table',
    columns: [
      { key: 'id', label: 'Source', kind: 'text', fixed: true },
      { key: 'points', label: 'Points', kind: 'int', min: 0, max: 1_000_000 },
    ],
    maxRows: SOURCE_IDS.length,
    fixedRows: true,
  },
}

const mafiaRanks: SettingDef<Array<{ name: string; minPoints: number }>> = {
  key: 'mafia.ranks',
  area: 'mafia',
  label: 'Mafia rank tiers',
  help: 'Rank names and the points each starts at. There must be a tier starting at 0, and no two tiers may start at the same points or share a name. Shown on profiles.',
  schema: z
    .array(z.object({ name: z.string().trim().min(1).max(30), minPoints: z.number().int().min(0).max(10_000_000) }))
    .min(1)
    .max(12)
    .superRefine((rows, ctx) => {
      if (!rows.some((r) => r.minPoints === 0)) ctx.addIssue({ code: 'custom', message: 'one tier must start at 0 points' })
      const points = new Set<number>()
      const names = new Set<string>()
      rows.forEach((r, i) => {
        if (points.has(r.minPoints)) ctx.addIssue({ code: 'custom', path: [i], message: `two tiers start at ${r.minPoints}` })
        if (names.has(r.name.toLowerCase())) ctx.addIssue({ code: 'custom', path: [i], message: `${r.name} is listed twice` })
        points.add(r.minPoints)
        names.add(r.name.toLowerCase())
      })
    }),
  default: MAFIA_RANKS.map((r) => ({ name: r.name, minPoints: r.minPoints })),
  onReadFailure: 'lastKnownGood',
  input: {
    type: 'table',
    columns: [
      { key: 'name', label: 'Rank', kind: 'text', maxLength: 30 },
      { key: 'minPoints', label: 'Starts at', kind: 'int', min: 0, max: 10_000_000 },
    ],
    maxRows: 12,
  },
}

export const CONTENT_SETTINGS = {
  // ---- Call recap ----
  'calls.recapMaxBullets': num({
    key: 'calls.recapMaxBullets', area: 'calls', label: 'Recap: most summary bullets', help: 'Bullets from the summary in a Discord recap. Discord\'s message length limit still applies.',
    min: 1, max: 10, default: 5,
  }),
  'calls.recapMaxActions': num({
    key: 'calls.recapMaxActions', area: 'calls', label: 'Recap: most action items', help: 'Action items listed in a Discord recap.',
    min: 1, max: 10, default: 5,
  }),
  'calls.recapBulletChars': num({
    key: 'calls.recapBulletChars', area: 'calls', label: 'Recap: characters per bullet', help: 'Longer bullets and action items are cut here.',
    min: 80, max: 400, default: 220, unit: 'chars',
  }),
  // ---- Call summary ----
  'calls.summaryModel': summaryModel,
  'calls.summaryPromptExtra': summaryPromptExtra,
  'calls.postFilter': postFilter,
  // ---- Call agenda ----
  'calls.agendaLeadMinutes': num({
    key: 'calls.agendaLeadMinutes', area: 'calls', label: 'Agenda: minutes before the call', help: 'An agenda is posted when the call starts within this long. The agenda job runs every 10 minutes, so it lands up to 10 minutes later than this.',
    min: 10, max: 120, default: 30, unit: 'min',
  }),
  'calls.agendaMaxBullets': num({
    key: 'calls.agendaMaxBullets', area: 'calls', label: 'Agenda: most bullets', help: 'Bullets in one agenda.',
    min: 1, max: 10, default: 7,
  }),
  'calls.agendaMaxTasks': num({
    key: 'calls.agendaMaxTasks', area: 'calls', label: 'Agenda: most crew tasks', help: 'Overdue or high-priority tasks listed in one agenda.',
    min: 1, max: 10, default: 5,
  }),
  'calls.agendaMaxFollowups': num({
    key: 'calls.agendaMaxFollowups', area: 'calls', label: 'Agenda: most items from the last call', help: 'Action items from the previous call listed in one agenda.',
    min: 0, max: 5, default: 2,
  }),
  'calls.agendaItemChars': num({
    key: 'calls.agendaItemChars', area: 'calls', label: 'Agenda: characters per item', help: 'Longer task and action item text is cut here.',
    min: 40, max: 200, default: 110, unit: 'chars',
  }),

  // ---- Re-engagement email ----
  'reengage.batchSize': num({
    key: 'reengage.batchSize', area: 'features', label: 'Re-engagement: emails per run', help: 'Most members emailed in one run. The REENGAGE_BATCH_SIZE env var is used until this is saved. The saved value can only lower it; raising it needs a code change.',
    min: 1, max: 60, default: 60, looserWhen: 'higher',
  }),
  'reengage.callWindowDays': num({
    key: 'reengage.callWindowDays', area: 'features', label: 'Re-engagement: days of upcoming calls', help: 'The email lists a member\'s crew calls that start within this many days.',
    min: 1, max: 30, default: 7, unit: 'days',
  }),
  'reengage.sendWeekday': num({
    key: 'reengage.sendWeekday', area: 'features', label: 'Re-engagement: send day (UTC)', help: 'Day of the week the email goes out: 0 = Sunday, 1 = Monday ... 6 = Saturday, in UTC. The job runs daily between 16:00 and 21:00 UTC and does nothing on other days.',
    min: 0, max: 6, default: 2,
  }),

  // ---- Abuse caps ----
  'spotlight.maxPerDay': num({
    key: 'spotlight.maxPerDay', area: 'features', label: 'Spotlight: submissions per member per day', help: 'Spotlight submissions one member can send in a day.',
    min: 1, max: 10, default: 3,
  }),
  'spotlight.maxPending': num({
    key: 'spotlight.maxPending', area: 'features', label: 'Spotlight: unreviewed submissions per member', help: 'A member cannot submit more while this many wait for review.',
    min: 1, max: 20, default: 5,
  }),
  'support.maxTicketsPerDay': num({
    key: 'support.maxTicketsPerDay', area: 'features', label: 'Support: tickets per member per day', help: 'Support tickets one member can open in a day.',
    min: 1, max: 20, default: 5,
  }),
  'support.maxOpenTickets': num({
    key: 'support.maxOpenTickets', area: 'features', label: 'Support: unresolved tickets per member', help: 'A member cannot open more while this many are unresolved.',
    min: 1, max: 50, default: 10,
  }),

  // ---- Roster audit and celebrations ----
  'roster.minCallsForSuggestion': num({
    key: 'roster.minCallsForSuggestion', area: 'features', label: 'Roster audit: calls before suggesting a crew', help: 'A member who attended a crew\'s calls this many times but is not on its roster is suggested for it. Advisory only.',
    min: 1, max: 20, default: 3,
  }),
  'roster.inactiveMonths': num({
    key: 'roster.inactiveMonths', area: 'features', label: 'Roster audit: months without attending', help: 'A rostered member who has not attended for this long is listed as inactive. Advisory only.',
    min: 1, max: 24, default: 6, unit: 'months',
  }),
  'missions.celebrationMinLevel': num({
    key: 'missions.celebrationMinLevel', area: 'missions', label: 'First level that gets a celebration', help: 'Reaching this level or higher shows the level-up celebration. 10 turns it off (finishing the last level counts as level 9). Cosmetic.',
    min: 1, max: 10, default: 2,
  }),

  // ---- Lists ----
  'work.prompts': workPrompts,
  'mafia.sourcePoints': mafiaSourcePoints,
  'mafia.ranks': mafiaRanks,
} as const satisfies Record<string, SettingDef>
