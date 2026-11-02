/**
 * Every data set that can be imported from Google Sheets (plans/sheets-cutover.md 5). Importers are
 * loaded lazily so the admin listing stays light.
 */
import type { DatasetInfo, Importer } from './framework'
import type { EditorSpec } from './editor'

const configs = () => import('./configs')

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
]

export function findDataset(key: string): DatasetInfo | undefined {
  return DATASETS.find((d) => d.key === key)
}

/** Admin editors for the data sets people used to edit in the sheet. */
export const EDITORS: Record<string, () => Promise<EditorSpec>> = {
  poapWhitelist: async () => (await configs()).poapEditor,
  nftCollections: async () => (await configs()).nftEditor,
  manuals: async () => (await configs()).manualsEditor,
}
