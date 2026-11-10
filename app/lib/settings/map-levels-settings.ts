/**
 * Reach map levels (plans/map-city-levels.md): the member score weights, the privacy minimums, the
 * tiers, the place aliases and the on/off switch for GET /api/public/map-levels.
 *
 * Everything defaults to the safe state: the switch is off (the endpoint answers 404 and the
 * site shows its plain map). The weights and thresholds are placeholders to calibrate on the
 * real data before the switch goes on.
 *
 * This file imports only types from ./registry (no runtime cycle).
 */
import { z } from 'zod'
import mapCities from '@/app/lib/map-levels/map-cities.json'
import { isIso2 } from '@/app/lib/map-levels/countries'
import { normalizeAliasMatch } from '@/app/lib/map-levels/places'
import type { PlaceAlias, Tier } from '@/app/lib/map-levels/types'
import { num } from './economy-settings'
import type { SettingDef } from './registry'

const CITY_KEYS = new Set((mapCities as { cities: Array<{ key: string }> }).cities.map((c) => c.key))

export const DEFAULT_TIERS: Tier[] = [
  { name: 'Dough', cityMin: 0, countryMin: 0 },
  { name: 'Sauce', cityMin: 100, countryMin: 250 },
  { name: 'Cheese', cityMin: 300, countryMin: 750 },
  { name: 'Whole Pie', cityMin: 750, countryMin: 2000 },
]

const LOWER_MIN_CONFIRM = (from: number, to: number) =>
  to < 3 && to < from ? 'Below 3 members, a place can describe one or two people on the public map. Continue?' : null

const SCORE_MAX = 10_000_000

const levelsEnabled: SettingDef<boolean> = {
  key: 'map.levelsEnabled',
  area: 'map',
  label: 'Show levels on the pizzadao.org map',
  help: 'Serve GET /api/public/map-levels so the public reach map can show a level for each city and country. Off, the endpoint answers 404 and the map looks as it always did. The MAP_LEVELS_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? 'The public map will show a level and a rounded member count for each city and country with enough members.' : null),
}

const tiers: SettingDef<Tier[]> = {
  key: 'map.tiers',
  area: 'map',
  label: 'Map tiers',
  help: 'The level names, lowest first. A city reaches a tier at its "City starts at" summed member score; a country at "Country starts at" (country sums are larger). The first tier must start at 0, and both columns must rise from row to row.',
  schema: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(30),
        cityMin: z.number().int().min(0).max(SCORE_MAX),
        countryMin: z.number().int().min(0).max(SCORE_MAX),
      }),
    )
    .min(1)
    .max(8)
    .superRefine((rows, ctx) => {
      const names = new Set<string>()
      rows.forEach((r, i) => {
        if (names.has(r.name.toLowerCase())) ctx.addIssue({ code: 'custom', path: [i], message: `${r.name} is listed twice` })
        names.add(r.name.toLowerCase())
        if (i === 0 && (r.cityMin !== 0 || r.countryMin !== 0)) ctx.addIssue({ code: 'custom', path: [i], message: 'the first tier must start at 0' })
        if (i > 0 && (r.cityMin <= rows[i - 1].cityMin || r.countryMin <= rows[i - 1].countryMin)) {
          ctx.addIssue({ code: 'custom', path: [i], message: 'each tier must start higher than the one before' })
        }
      })
    }),
  default: DEFAULT_TIERS,
  onReadFailure: 'lastKnownGood',
  input: {
    type: 'table',
    columns: [
      { key: 'name', label: 'Tier', kind: 'text', maxLength: 30 },
      { key: 'cityMin', label: 'City starts at', kind: 'int', min: 0, max: SCORE_MAX },
      { key: 'countryMin', label: 'Country starts at', kind: 'int', min: 0, max: SCORE_MAX },
    ],
    maxRows: 8,
  },
}

const buckets: SettingDef<string[]> = {
  key: 'map.memberCountBuckets',
  area: 'map',
  label: 'Public member count steps',
  help: 'One whole number per line, ascending. The public map shows the largest step at or below the real count, as "10+". A place below the first step shows no count. Empty shows no counts at all.',
  schema: z
    .array(z.string().trim().regex(/^\d{1,5}$/, 'Whole numbers only'))
    .max(12)
    .superRefine((rows, ctx) => {
      rows.forEach((r, i) => {
        if (Number(r) < 1) ctx.addIssue({ code: 'custom', path: [i], message: 'Steps start at 1' })
        if (i > 0 && Number(r) <= Number(rows[i - 1])) ctx.addIssue({ code: 'custom', path: [i], message: 'Steps must rise' })
      })
    }),
  default: ['3', '5', '10', '25', '50', '100'],
  onReadFailure: 'lastKnownGood',
  input: { type: 'stringList', maxItems: 12, maxLength: 5 },
}

const aliases: SettingDef<PlaceAlias[]> = {
  key: 'map.placeAliases',
  area: 'map',
  label: 'Map place aliases',
  help: 'Fix what members typed in City. "Typed as" is the text (case and accents do not matter; a Google-style "City, State, Country" matches whole, then by its first part). "Counts as" is a map city key (for example new-york-840), country:XX (a two-letter country code), or ignore (not a place, such as "nomadic").',
  schema: z
    .array(
      z.object({
        match: z.string().trim().min(1).max(120),
        target: z
          .string()
          .trim()
          .max(60)
          .refine(
            (t) => t === 'ignore' || CITY_KEYS.has(t) || (t.startsWith('country:') && isIso2(t.slice(8).toUpperCase())),
            'Use a map city key, country:XX with a real country code, or ignore',
          ),
      }),
    )
    .max(1000)
    .transform((rows) => rows.map((r) => ({ match: normalizeAliasMatch(r.match), target: r.target.startsWith('country:') ? `country:${r.target.slice(8).toUpperCase()}` : r.target })))
    .superRefine((rows, ctx) => {
      const seen = new Set<string>()
      rows.forEach((r, i) => {
        if (!r.match) ctx.addIssue({ code: 'custom', path: [i], message: 'Typed-as text is empty' })
        if (seen.has(r.match)) ctx.addIssue({ code: 'custom', path: [i], message: `${r.match} is listed twice` })
        seen.add(r.match)
      })
    }),
  default: [],
  onReadFailure: 'lastKnownGood',
  input: {
    type: 'table',
    columns: [
      { key: 'match', label: 'Typed as', kind: 'text', maxLength: 120 },
      { key: 'target', label: 'Counts as (city key, country:XX, ignore)', kind: 'text', maxLength: 60 },
    ],
    maxRows: 1000,
  },
}

export const MAP_LEVELS_SETTINGS = {
  'map.levelsEnabled': levelsEnabled,
  'map.weightLevel': num({ key: 'map.weightLevel', area: 'map', label: 'Score: points per completed level', help: 'The main signal: a member at level 4 has completed 3 levels.', min: 0, max: 1000, default: 10 }),
  'map.weightMission': num({ key: 'map.weightMission', area: 'map', label: 'Score: points per approved mission', help: 'Counts every approved mission, bonus ones included, up to the cap below.', min: 0, max: 1000, default: 2 }),
  'map.missionCap': num({ key: 'map.missionCap', area: 'map', label: 'Score: most missions counted', help: 'Stops grinding past the ladder from adding more.', min: 1, max: 1000, default: 40 }),
  'map.weightPep': num({ key: 'map.weightPep', area: 'map', label: 'Score: points per tenfold of PEP', help: 'PEP is damped: a wallet of 10 adds about 1x this, 100 about 2x, 1,000 about 3x, 10,000 about 4x.', min: 0, max: 1000, default: 5 }),
  'map.pepCap': num({ key: 'map.pepCap', area: 'map', label: 'Score: PEP counted at most', help: 'A wallet above this counts as this, so one whale cannot carry a city.', min: 1, max: 100_000_000, default: 10_000, unit: 'PEP' }),
  'map.scoreCap': num({ key: 'map.scoreCap', area: 'map', label: 'Score: most per member', help: 'A hard ceiling on one member\'s score. 0 turns the ceiling off.', min: 0, max: 100_000, default: 150 }),
  'map.minMembersCity': num({
    key: 'map.minMembersCity',
    area: 'map',
    label: 'Fewest members to show a city',
    help: 'A city with fewer members is left off the public map entirely. Members without a Discord account count here. Keep at 3 or more so no place describes one person.',
    min: 1,
    max: 50,
    default: 3,
    confirm: LOWER_MIN_CONFIRM,
  }),
  'map.minMembersCountry': num({
    key: 'map.minMembersCountry',
    area: 'map',
    label: 'Fewest members to show a country',
    help: 'A country with fewer members is left off the public map entirely (its members in small cities still count toward it).',
    min: 1,
    max: 50,
    default: 3,
    confirm: LOWER_MIN_CONFIRM,
  }),
  'map.tiers': tiers,
  'map.memberCountBuckets': buckets,
  'map.cacheSeconds': num({ key: 'map.cacheSeconds', area: 'map', label: 'Public map data: cache time', help: 'How long the CDN may serve the public endpoint before it is recomputed. Capped at 300 seconds so that turning the switch off or raising a minimum reaches the public map within minutes; this can only shorten it.', min: 60, max: 300, default: 300, unit: 'seconds' }),
  'map.placeAliases': aliases,
} as const satisfies Record<string, SettingDef>
