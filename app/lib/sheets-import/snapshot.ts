/**
 * Raw frozen copy of every tab of every sheet the app uses (plans/sheets-cutover.md 3.3): the
 * in-database archive. Admin-only, never exposed publicly. Values are what a person sees in the
 * sheet (formatted), one SheetSnapshot row per tab, grouped by batchId.
 *
 * Not included: the Discord webhooks sheet (its cells are secrets) and the payment form responses
 * (already copied to the database by the payments ingest).
 */
import { prisma } from '@/app/lib/db'
import { SHEET_IDS, type SheetKey } from '@/app/lib/sheets/config'

const EXCLUDED: ReadonlySet<SheetKey> = new Set<SheetKey>(['discordWebhooks'])

export interface SnapshotTarget {
  sheetKey: string
  sheetId: string
}

export interface SnapshotResult {
  batchId: string
  sheets: number
  tabs: number
  rows: number
  /** Sheets that could not be read (by key; no contents). */
  failed: string[]
}

export interface SheetReader {
  tabs(sheetId: string): Promise<string[]>
  values(sheetId: string, tabs: string[]): Promise<Array<{ tab: string; rows: unknown[][] }>>
}

function extractSheetId(url: string): string | null {
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

/** Every sheet to archive, de-duplicated by spreadsheet id. */
export function snapshotTargets(crewSheets: Array<{ id: string; sheet?: string }>, env: Record<string, string | undefined> = process.env): SnapshotTarget[] {
  const out: SnapshotTarget[] = []
  const seen = new Set<string>()
  const add = (sheetKey: string, sheetId: string | null | undefined) => {
    if (!sheetId || seen.has(sheetId)) return
    seen.add(sheetId)
    out.push({ sheetKey, sheetId })
  }
  for (const [key, id] of Object.entries(SHEET_IDS) as Array<[SheetKey, string]>) if (!EXCLUDED.has(key)) add(key, id)
  if (env.JOBS_SHEET_ID?.trim()) add('jobs', env.JOBS_SHEET_ID.trim())
  for (const c of crewSheets) if (c.sheet) add(`crew:${c.id}`, extractSheetId(c.sheet))
  return out
}

async function defaultReader(): Promise<SheetReader> {
  const { sheetsClient } = await import('@/app/api/lib/google-sheets')
  return {
    async tabs(sheetId) {
      const res = await sheetsClient.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties.title' })
      return (res.data.sheets ?? []).map((s) => s.properties?.title ?? '').filter(Boolean)
    },
    async values(sheetId, tabs) {
      const res = await sheetsClient.spreadsheets.values.batchGet({
        spreadsheetId: sheetId,
        ranges: tabs.map((t) => `'${t.replace(/'/g, "''")}'`),
        valueRenderOption: 'FORMATTED_VALUE',
      })
      return (res.data.valueRanges ?? []).map((vr, i) => ({ tab: tabs[i], rows: (vr.values ?? []) as unknown[][] }))
    },
  }
}

export async function takeSnapshot(actor: string, deps: { reader?: SheetReader; targets?: SnapshotTarget[] } = {}): Promise<SnapshotResult> {
  let targets = deps.targets
  if (!targets) {
    const { getCrewMappings } = await import('@/app/lib/crew-mappings')
    const { crews } = await getCrewMappings().catch(() => ({ crews: [] as Array<{ id: string; sheet?: string }> }))
    targets = snapshotTargets(crews)
  }
  const reader = deps.reader ?? (await defaultReader())
  const batchId = `snap-${new Date().toISOString()}`
  const result: SnapshotResult = { batchId, sheets: 0, tabs: 0, rows: 0, failed: [] }
  for (const t of targets) {
    try {
      const tabs = await reader.tabs(t.sheetId)
      const values = tabs.length ? await reader.values(t.sheetId, tabs) : []
      if (values.length) {
        await prisma.sheetSnapshot.createMany({
          data: values.map((v) => ({
            batchId,
            sheetKey: t.sheetKey,
            sheetId: t.sheetId,
            tab: v.tab,
            rowCount: v.rows.length,
            data: v.rows as never,
            takenBy: actor,
          })),
        })
      }
      result.sheets++
      result.tabs += values.length
      result.rows += values.reduce((n, v) => n + v.rows.length, 0)
    } catch {
      result.failed.push(t.sheetKey)
    }
  }
  return result
}
