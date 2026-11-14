/**
 * Manuals freshness markers (plans/training-manual-on-site.md, phase 2): "reviewed" date, stale chip,
 * draft and replaced-by marks on the /manuals index. Off by default. Own file so the registry only
 * carries one spread line. Imports only types from ./registry.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

const bool = (key: string, label: string, help: string, confirmOn?: string): SettingDef<boolean> => ({
  key,
  area: 'manuals',
  label,
  help,
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: confirmOn ? (from, to) => (to && !from ? confirmOn : null) : undefined,
})

const staleAfterDays: SettingDef<number> = {
  key: 'manuals.staleAfterDays',
  area: 'manuals',
  label: 'Manual is stale after (days)',
  help: 'A manual whose reviewed date is older than this gets a "Stale" chip. A manual with no reviewed date shows "Not yet reviewed".',
  schema: z.number().int().min(30).max(3650),
  default: 365,
  onReadFailure: { value: 365 },
  input: { type: 'int', min: 30, max: 3650, unit: 'days' },
}

export const MANUALS_SETTINGS = {
  'manuals.freshnessEnabled': bool(
    'manuals.freshnessEnabled',
    'Show review markers on the manuals page',
    "Shows each manual's reviewed date, a Stale chip, Draft marks and a link to the page that replaces it. Off, the manuals page is unchanged.",
    'The manuals page will start showing review dates and stale, draft and replaced marks.',
  ),
  'manuals.staleAfterDays': staleAfterDays,
  'manuals.hideDrafts': bool(
    'manuals.hideDrafts',
    'Hide draft manuals',
    'Needs the review markers switch. On, manuals with the status Draft are left off the manuals page. Off, they are shown with a Draft mark.',
  ),
  'manuals.hideReplaced': bool(
    'manuals.hideReplaced',
    'Hide replaced manuals',
    'Needs the review markers switch. On, manuals that name a replacement page are left off the manuals page. Off, they are shown last with a "Replaced by" link.',
  ),
} as const satisfies Record<string, SettingDef>
