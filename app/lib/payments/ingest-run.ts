/**
 * Wires the pure ingest (ingest.ts) to the real Sheets client and database. Read-only on the
 * sheet: it uses the service account's readonly scope and only reads values.
 *
 * It reads the NEWEST rows (header + the last WINDOW rows) so a long-lived sheet never hides new
 * responses behind old ones; when older rows are left out, the run reports `truncated` and the
 * queue shows a warning. Values are read unformatted with dates as serial numbers, so a change of
 * display format or locale cannot change a response's identity.
 */
import { sheetsClient } from '@/app/api/lib/google-sheets'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { DEFAULT_MAX_NEW, runIngest, type Cell, type IngestResult } from './ingest'
import { loadPaymentPolicy } from './policy'
import { createPaymentRequest, findExistingRefs } from './store'
import { getFormSheetId, getIngestFrom, saveIngestStatus, setIngestFrom } from './text-settings'

/** Newest rows read per run (plus the header). */
export const READ_WINDOW = 2000
const COLS = 'A1:Z'

const quote = (title: string) => `'${title.replace(/'/g, "''")}'`

export async function readNewestRows(spreadsheetId: string): Promise<{ values: Cell[][]; truncated: boolean }> {
  const meta = await sheetsClient.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' })
  const title = meta.data.sheets?.[0]?.properties?.title
  if (!title) throw new Error('no sheet')
  // Column A runs to the last filled row (trailing blank rows are not returned), so this is the real row count.
  const colA = await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${quote(title)}!A:A`, majorDimension: 'COLUMNS' })
  const last = colA.data.values?.[0]?.length ?? 0
  const opts = { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' } as const
  if (last <= READ_WINDOW + 1) {
    const r = await sheetsClient.spreadsheets.values.get({ spreadsheetId, range: `${quote(title)}!${COLS}${Math.max(last, 1)}`, ...opts })
    return { values: (r.data.values ?? []) as Cell[][], truncated: false }
  }
  const start = last - READ_WINDOW + 1
  const r = await sheetsClient.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [`${quote(title)}!A1:Z1`, `${quote(title)}!A${start}:Z${last}`],
    ...opts,
  })
  const [head, tail] = r.data.valueRanges ?? []
  return { values: [...((head?.values ?? []) as Cell[][]), ...((tail?.values ?? []) as Cell[][])], truncated: true }
}

export async function runFormIngest(): Promise<IngestResult> {
  const policy = await loadPaymentPolicy()
  return runIngest({
    getSheetId: getFormSheetId,
    readValues: readNewestRows,
    getIngestFrom,
    setIngestFrom: (d) => setIngestFrom(d, 'cron'),
    findExistingRefs,
    create: async (data) => {
      await createPaymentRequest(data, policy)
    },
    matchMember: (discordId) => fetchMemberIdByDiscordId(discordId),
    saveStatus: saveIngestStatus,
    maxNew: DEFAULT_MAX_NEW,
  })
}
