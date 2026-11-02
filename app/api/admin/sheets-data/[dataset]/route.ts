import { requireAdmin } from '@/app/lib/auth-guards'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { EDITORS } from '@/app/lib/sheets-import/datasets'
import { cleanRows, EditorError } from '@/app/lib/sheets-import/editor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ dataset: string }> }

/**
 * GET / PUT /api/admin/sheets-data/<dataset>
 * Admins only. The website editor for a data set that moved off Google Sheets. PUT {rows} sends the
 * whole list: rows are matched by natural key, missing rows are marked inactive (never deleted).
 */
export async function GET(_request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const { dataset } = await params
  const load = EDITORS[dataset]
  if (!load) return json({ error: 'Unknown data set' }, 404)
  const spec = await load()
  try {
    return json({ dataset, label: spec.label, help: spec.help, columns: spec.columns, maxRows: spec.maxRows, rows: await spec.list() })
  } catch (e) {
    console.error('[sheets-data] list failed', dataset, e instanceof Error ? e.message : e)
    return json({ error: 'Could not load the rows' }, 500)
  }
}

export async function PUT(request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const { dataset } = await params
  const load = EDITORS[dataset]
  if (!load) return json({ error: 'Unknown data set' }, 404)
  const spec = await load()
  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null
  let rows
  try {
    rows = cleanRows(spec, body?.rows)
  } catch (e) {
    if (e instanceof EditorError) return json({ error: e.message }, 400)
    throw e
  }
  try {
    return json({ ok: true, counts: await spec.save(rows, auth.session.discordId) })
  } catch (e) {
    if (e instanceof EditorError) return json({ error: e.message }, 400)
    console.error('[sheets-data] save failed', dataset, e instanceof Error ? e.message : e)
    return json({ error: 'Could not save' }, 500)
  }
}
