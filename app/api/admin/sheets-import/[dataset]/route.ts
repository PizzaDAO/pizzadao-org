import { requireDpr, rejectUnsafeWrite, json } from '@/app/lib/admin-guard'
import { findDataset } from '@/app/lib/sheets-import/datasets'
import { runImport, type ImportMode } from '@/app/lib/sheets-import/framework'
import { getSource } from '@/app/lib/sheets-import/source'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Crew sheets are read one by one through the Sheets API.
export const maxDuration = 300

type Params = { params: Promise<{ dataset: string }> }

/**
 * POST /api/admin/sheets-import/<dataset>   body: { mode?: "dry-run" | "apply" }
 * Dread Pizza Roberts only. "dry-run" (the default) changes nothing and returns counts only.
 * "apply" upserts by natural key (running it twice changes nothing) and never deletes. Both are
 * logged as a SheetImportRun row.
 */
export async function POST(request: Request, { params }: Params) {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const { dataset } = await params
  const info = findDataset(dataset)
  if (!info) return json({ error: 'Unknown data set' }, 404)
  const body = (await request.json().catch(() => null)) as { mode?: unknown } | null
  const mode = body?.mode ?? 'dry-run'
  if (mode !== 'dry-run' && mode !== 'apply') return json({ error: 'mode must be "dry-run" or "apply"' }, 400)
  // Once a data set reads from the database, the website is where it is edited: an apply would
  // overwrite those edits with the (stale) sheet. Switch the source back to "sheet" first.
  // (A per-crew pilot is fine: the importer skips the crews already on the database.)
  const current = info.source ? await getSource(info.source) : null
  if (mode === 'apply' && current?.kind === 'db' && !current.crews) {
    return json({ error: 'This data set reads from the database now; switch its source back to "sheet" before applying an import' }, 409)
  }
  const importer = await info.importer()
  const report = await runImport(importer, mode as ImportMode, auth.session.discordId)
  return json(report, report.ok ? 200 : 502)
}
