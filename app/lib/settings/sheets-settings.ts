/**
 * Google Sheets cutover switches (plans/sheets-cutover.md). One setting per data set says where the
 * app reads it from: `sheet` (the old Google Sheet, the default) or `db` (the website's own tables,
 * filled by the importer on /admin/sheets). How a value is resolved, including the env kill
 * switch and previews, is in app/lib/sheets-import/source.ts.
 *
 * Every default is `sheet`, so deploying this changes nothing. Flipping back to `sheet` is the
 * rollback for that data set.
 *
 * This file imports only types from ./registry (no runtime cycle).
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

/** Data sets that can move off Google Sheets, with the env var that overrides each. */
export const SHEET_SOURCES = {
  poapWhitelist: { label: 'POAP event whitelist', env: 'SHEETS_SOURCE_POAP_WHITELIST', crewList: false },
  nftCollections: { label: 'NFT collections', env: 'SHEETS_SOURCE_NFT_COLLECTIONS', crewList: false },
  manuals: { label: 'Manuals index', env: 'SHEETS_SOURCE_MANUALS', crewList: false },
  crews: { label: 'Crew registry (crew mappings)', env: 'SHEETS_SOURCE_CREWS', crewList: false },
  crewTasks: { label: 'Crew tasks, agenda steps and goals', env: 'SHEETS_SOURCE_CREW_TASKS', crewList: true },
  crewRoles: { label: 'Crew rosters and roles', env: 'SHEETS_SOURCE_CREW_ROLES', crewList: false },
  members: { label: 'Members', env: 'SHEETS_SOURCE_MEMBERS', crewList: false },
  announce: { label: 'Community Call announcement', env: 'SHEETS_SOURCE_ANNOUNCE', crewList: false },
} as const

export type SheetSourceKey = keyof typeof SHEET_SOURCES
export const SHEET_SOURCE_KEYS = Object.keys(SHEET_SOURCES) as SheetSourceKey[]

/** Crew ids as used in URLs (slugs). */
const CREW_SLUG = /^[a-z0-9_-]{1,64}$/

/**
 * `sheet`, `db`, or (only where `crewList` is set) `db:` followed by a comma-separated list of crew
 * ids: only those crews read from the database, every other crew from its sheet (a per-crew pilot).
 */
export function isValidSourceValue(v: string, crewList: boolean): boolean {
  const s = v.trim()
  if (s === 'sheet' || s === 'db') return true
  if (!crewList || !s.startsWith('db:')) return false
  const ids = s.slice(3).split(',').map((x) => x.trim()).filter(Boolean)
  return ids.length > 0 && ids.length <= 50 && ids.every((id) => CREW_SLUG.test(id))
}

function sourceSetting(key: SheetSourceKey): SettingDef<string> {
  const def = SHEET_SOURCES[key]
  const choices = def.crewList ? '"sheet", "db", or "db:crew-a,crew-b" (only those crews from the database)' : '"sheet" or "db"'
  return {
    key: `sheets.source.${key}`,
    area: 'sheets',
    label: `${def.label}: read from`,
    help: `Where the app reads this data: ${choices}. Run the import on /admin/sheets (dry run, then apply) before switching to "db". "sheet" is the rollback. The ${def.env} env var set to "sheet" always wins; on previews only that env var decides.`,
    schema: z
      .string()
      .trim()
      .refine((v) => isValidSourceValue(v, def.crewList), `Use ${choices}`),
    default: 'sheet',
    // A brief read failure keeps the last value in force (never silently flips writes back to a sheet).
    onReadFailure: 'lastKnownGood',
    input: { type: 'text', maxLength: 600, placeholder: def.crewList ? 'sheet | db | db:crew-a,crew-b' : 'sheet | db' },
    confirm: (from, to) =>
      from !== to ? `The app will read ${def.label.toLowerCase()} from ${to.startsWith('db') ? 'the database' : 'the Google Sheet'} from now on.` : null,
  }
}

export const SHEETS_SETTINGS = {
  'sheets.source.poapWhitelist': sourceSetting('poapWhitelist'),
  'sheets.source.nftCollections': sourceSetting('nftCollections'),
  'sheets.source.manuals': sourceSetting('manuals'),
  'sheets.source.crews': sourceSetting('crews'),
  'sheets.source.crewTasks': sourceSetting('crewTasks'),
  'sheets.source.crewRoles': sourceSetting('crewRoles'),
  'sheets.source.members': sourceSetting('members'),
  'sheets.source.announce': sourceSetting('announce'),
  'sheets.mirror.members': mirrorSetting(),
} as const satisfies Record<string, SettingDef>

function mirrorSetting(): SettingDef<boolean> {
  return {
    key: 'sheets.mirror.members',
    area: 'sheets',
    label: 'Members: also copy website edits to the sheet',
    help: 'Only while members read from the database: after each member write the website also sends the change to the old members sheet, so switching back to "sheet" loses nothing. Turn off at the freeze. The SHEETS_MIRROR_MEMBERS env var set to off always wins.',
    schema: z.boolean(),
    default: true,
    onReadFailure: { value: false },
    input: { type: 'bool' },
  }
}
