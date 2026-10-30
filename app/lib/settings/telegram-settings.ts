/**
 * Telegram city group mirror settings (plans/telegram-shared-bot.md, PR P3). The on/off switches
 * live in registry.ts + toggles.ts; this file holds the data and pacing:
 *
 * - telegram.crewCityGroups: which city groups get a crew's recap and agenda. There is no "all
 *   cities" wildcard: a row lists explicit city keys.
 * - telegram.announceCityKeys: the groups that get the Community Call announcement.
 * - pacing numbers for the outbox.
 *
 * City keys are checked against the rsv.pizza directory on the /admin/telegram page (unknown
 * keys and groups without a chat are flagged there). Everything defaults to empty / off.
 *
 * This file imports only types from ./registry (no runtime cycle).
 */
import { z } from 'zod'
import { num } from './economy-settings'
import type { SettingDef } from './registry'

/** A city key as rsv.pizza stores it: lowercase letters, digits, spaces, dots, apostrophes, hyphens. */
export const CITY_KEY_RE = /^[a-z0-9 .'-]{2,80}$/
export const MAX_CITY_KEYS_PER_CREW = 20

/** Split a comma-separated list of city keys: trimmed, lowercased, de-duplicated, blanks dropped. */
export function parseCityKeys(raw: string | undefined | null): string[] {
  return [...new Set(String(raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))]
}

const cityKey = z.string().trim().toLowerCase().regex(CITY_KEY_RE, 'City keys use lowercase letters, digits, spaces, dots, apostrophes and hyphens')

const crewCityRow = z.object({
  crewId: z.string().trim().min(1).max(64),
  cityKeys: z
    .string()
    .trim()
    .max(500)
    .superRefine((v, ctx) => {
      const keys = parseCityKeys(v)
      if (keys.length === 0) ctx.addIssue({ code: 'custom', message: 'List at least one city key' })
      if (keys.length > MAX_CITY_KEYS_PER_CREW) ctx.addIssue({ code: 'custom', message: `At most ${MAX_CITY_KEYS_PER_CREW} city keys per crew` })
      for (const k of keys) if (!CITY_KEY_RE.test(k)) ctx.addIssue({ code: 'custom', message: `"${k}" is not a valid city key` })
    }),
})

const crewCityGroups: SettingDef<Array<{ crewId: string; cityKeys: string }>> = {
  key: 'telegram.crewCityGroups',
  area: 'telegram',
  label: 'Crew to city Telegram groups',
  help: 'Which city groups get a crew\'s call recap and pre-call agenda. Crew id is the crew slug (for example from the Crews sheet); city keys are comma-separated, exactly as in the city directory. No wildcards: list each city. The /admin/telegram page flags keys that are not in the directory or have no group yet. A crew with no row is never mirrored.',
  schema: z
    .array(crewCityRow)
    .max(50)
    .superRefine((rows, ctx) => {
      const seen = new Set<string>()
      rows.forEach((r, i) => {
        const id = r.crewId.toLowerCase()
        if (seen.has(id)) ctx.addIssue({ code: 'custom', path: [i], message: `${r.crewId} is listed twice` })
        seen.add(id)
      })
    }),
  default: [],
  onReadFailure: 'lastKnownGood',
  input: {
    type: 'table',
    columns: [
      { key: 'crewId', label: 'Crew id', kind: 'text', maxLength: 64 },
      { key: 'cityKeys', label: 'City keys (comma-separated)', kind: 'text', maxLength: 500 },
    ],
    maxRows: 50,
  },
}

const announceCityKeys: SettingDef<string[]> = {
  key: 'telegram.announceCityKeys',
  area: 'telegram',
  label: 'Community Call announcement city groups',
  help: 'City keys (one per line) whose Telegram groups also get the Community Call announcement. Empty means none. The /admin/telegram page flags keys that are not in the directory or have no group yet.',
  schema: z.array(cityKey).max(20),
  default: [],
  onReadFailure: 'lastKnownGood',
  input: { type: 'stringList', maxItems: 20, maxLength: 80 },
}

export const TELEGRAM_SETTINGS = {
  'telegram.crewCityGroups': crewCityGroups,
  'telegram.announceCityKeys': announceCityKeys,
  'telegram.maxSendsPerRun': num({
    key: 'telegram.maxSendsPerRun', area: 'telegram', label: 'Telegram: most group posts per run', help: 'The outbox runs every 5 minutes and sends at most this many posts each time.',
    min: 1, max: 25, default: 25, looserWhen: 'higher',
  }),
  'telegram.groupGapSeconds': num({
    key: 'telegram.groupGapSeconds', area: 'telegram', label: 'Telegram: seconds between posts to one group', help: 'Posts to the same city group are sent one at a time with at least this gap. The lowest value is above the rsv.pizza per-city limit (one post per 5 seconds).',
    min: 6, max: 60, default: 10, unit: 's',
  }),
  'telegram.postMaxAgeHours': num({
    key: 'telegram.postMaxAgeHours', area: 'telegram', label: 'Telegram: hours before a queued recap or announcement is dropped', help: 'A recap or announcement still waiting after this long is skipped, not sent late. (Agendas are dropped when the call starts.)',
    min: 1, max: 72, default: 12, unit: 'h',
  }),
} as const satisfies Record<string, SettingDef>
