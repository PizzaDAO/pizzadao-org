/**
 * Every data set that can be imported from Google Sheets (plans/sheets-cutover.md 5). Importers are
 * loaded lazily so the admin listing stays light.
 */
import type { DatasetInfo, Importer } from './framework'
import type { EditorSpec } from './editor'

const configs = () => import('./configs')
const crews = () => import('./crews')
const crewContent = () => import('./crew-content')
const crewRoles = () => import('./crew-roles')
const members = () => import('./members')

export const DATASETS: DatasetInfo[] = [
  {
    key: 'poapWhitelist',
    label: 'POAP event whitelist',
    source: 'poapWhitelist',
    description: 'Event ids from the POAP whitelist sheet. Key: event id.',
    importer: async () => (await configs()).poapImporter as Importer<unknown>,
    parity: async () => (await configs()).poapParity(),
  },
  {
    key: 'nftCollections',
    label: 'NFT collections',
    source: 'nftCollections',
    description: 'Chain, contract, name, order and details from the NFT contracts sheet. Key: chain + contract.',
    importer: async () => (await configs()).nftImporter as Importer<unknown>,
    parity: async () => (await configs()).nftParity(),
  },
  {
    key: 'manuals',
    label: 'Manuals index',
    source: 'manuals',
    description: 'The manuals list (title, link, crew, status, author, notes). Manual content stays in the linked documents. Key: title.',
    importer: async () => (await configs()).manualsImporter as Importer<unknown>,
    parity: async () => (await configs()).manualsParity(),
  },
  {
    key: 'crews',
    label: 'Crew registry',
    source: 'crews',
    description: 'The Crew Mappings sheet: crew, emoji, turtles, role, channel, event, call time and link, call length, type, script, crew sheet. Duplicate rows merge as before. Key: crew id (slug).',
    importer: async () => (await crews()).crewsImporter as Importer<unknown>,
    parity: async () => (await crews()).crewsParity(),
  },
  {
    key: 'crewContent',
    label: 'Crew tasks, agenda steps and goals',
    source: 'crewTasks',
    description: 'The Tasks, Meeting Agenda and Goals sections of every crew sheet, with links. Done and skipped tasks are kept (marked by stage). Reports unreadable sheets and lead ids that are not member ids. Key: crew + section + label.',
    importer: async () => (await crewContent()).crewContentImporter as Importer<unknown>,
    parity: async () => (await crewContent()).crewContentParity(),
  },
  {
    key: 'crewRoles',
    label: 'Crew rosters and roles',
    source: 'crewRoles',
    description: 'The roster section of every crew sheet (name, status, city, org, skills, turtles, telegram, attendance, notes). Lead/capo rights need a member id, exactly as before: lead rows without one are reported and must be fixed before switching. Key: crew + member id (or name).',
    importer: async () => (await crewRoles()).crewRolesImporter as Importer<unknown>,
    parity: async () => (await crewRoles()).crewRolesParity(),
  },
  {
    key: 'members',
    label: 'Members',
    source: 'members',
    description: 'Every row of the members sheet, stored as the app reads it (every column, private ones included; never shown publicly). Reports rows without an id, repeated ids and repeated Discord ids by row number. Key: member id.',
    importer: async () => (await members()).membersImporter as Importer<unknown>,
    parity: async () => (await members()).membersParity(),
  },
]

export function findDataset(key: string): DatasetInfo | undefined {
  return DATASETS.find((d) => d.key === key)
}

/** Admin editors for the data sets people used to edit in the sheet. */
export const EDITORS: Record<string, () => Promise<EditorSpec>> = {
  poapWhitelist: async () => (await configs()).poapEditor,
  nftCollections: async () => (await configs()).nftEditor,
  manuals: async () => (await configs()).manualsEditor,
  crews: async () => (await crews()).crewsEditor,
}
