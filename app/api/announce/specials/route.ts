import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { requireAnnouncer } from '@/app/lib/announce/access'
import { announceFromDb } from '@/app/lib/announce/db'
import { cleanRows, EditorError } from '@/app/lib/sheets-import/editor'
import { announceEditor } from '@/app/lib/sheets-import/announce'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET / PUT /api/announce/specials
 * The specials of the Community Call announcement, edited on the website once
 * `sheets.source.announce` is "db" (plans/sheets-cutover.md). Announcers only (same check as
 * firing the announcement).
 */
async function guard() {
  const auth = await requireAnnouncer()
  if (!auth.ok) return { error: auth.response }
  if (!(await announceFromDb())) return { error: json({ error: 'The announcement is still edited in its Google Sheet' }, 409) }
  return { auth }
}

export async function GET() {
  const g = await guard()
  if ('error' in g) return g.error
  const spec = announceEditor
  return json({ dataset: spec.dataset, label: spec.label, help: spec.help, columns: spec.columns, maxRows: spec.maxRows, rows: await spec.list() })
}

export async function PUT(request: Request) {
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const g = await guard()
  if ('error' in g) return g.error
  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null
  let rows
  try {
    rows = cleanRows(announceEditor, body?.rows)
  } catch (e) {
    if (e instanceof EditorError) return json({ error: e.message }, 400)
    throw e
  }
  try {
    return json({ ok: true, counts: await announceEditor.save(rows, g.auth.session.discordId) })
  } catch (e) {
    console.error('[announce] specials save failed', e instanceof Error ? e.message : e)
    return json({ error: 'Could not save' }, 500)
  }
}
