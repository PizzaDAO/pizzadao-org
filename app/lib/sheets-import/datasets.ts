/**
 * Every data set that can be imported from Google Sheets (plans/sheets-cutover.md 5). Importers are
 * loaded lazily so the admin listing stays light.
 */
import type { DatasetInfo } from './framework'

export const DATASETS: DatasetInfo[] = []

export function findDataset(key: string): DatasetInfo | undefined {
  return DATASETS.find((d) => d.key === key)
}
