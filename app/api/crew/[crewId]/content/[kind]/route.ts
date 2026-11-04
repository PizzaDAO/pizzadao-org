import { isAdminDiscordId, requireSession } from '@/app/lib/auth-guards'
import { isLeadStatus } from '@/app/lib/crew-lead-status'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { canManageCrew } from '@/app/lib/crew-leads'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { usesDb } from '@/app/lib/sheets-import/source'
import { cleanRows, EditorConflict, EditorError } from '@/app/lib/sheets-import/editor'
import { CREW_EDITORS, type CrewEditorKind } from '@/app/lib/sheets-import/crew-content'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ crewId: string; kind: string }> }

/**
 * GET / PUT /api/crew/<crewId>/content/<tasks|agenda|goals|roster>
 * The crew-lead editor for a crew's tasks, meeting agenda and goals (plans/sheets-cutover.md PR 4).
 * Leads of the crew and guild admins only (fails closed). Only once the crew's tasks read from the
 * database (`sheets.source.crewTasks`); before that the crew sheet is still the place to edit.
 */
async function guard(params: Params['params']) {
  const auth = await requireSession()
  if (!auth.ok) return { error: auth.response }
  const { crewId: raw, kind } = await params
  const crewId = normalizeCrewId(raw)
  const editor = Object.prototype.hasOwnProperty.call(CREW_EDITORS, kind) ? CREW_EDITORS[kind as CrewEditorKind] : null
  if (!crewId || !editor) return { error: json({ error: 'Not found' }, 404) }
  if (!(await canManageCrew(auth.session.discordId, crewId))) return { error: json({ error: 'Only crew leads can edit this' }, 403) }
  if (!(await usesDb(editor.source, crewId))) return { error: json({ error: "This is still edited in the crew's Google Sheet" }, 409) }
  return { auth, crewId, spec: await editor.make(crewId) }
}

export async function GET(_request: Request, { params }: Params) {
  const g = await guard(params)
  if ('error' in g) return g.error
  try {
    return json({ dataset: g.spec.dataset, label: g.spec.label, help: g.spec.help, columns: g.spec.columns, maxRows: g.spec.maxRows, rows: await g.spec.list(), loadedAt: new Date(Date.now() - 5_000).toISOString() })
  } catch (e) {
    console.error('[crew-content] list failed', e instanceof Error ? e.message : e)
    return json({ error: 'Could not load' }, 500)
  }
}

export async function PUT(request: Request, { params }: Params) {
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const g = await guard(params)
  if ('error' in g) return g.error
  const body = (await request.json().catch(() => null)) as { rows?: unknown; loadedAt?: unknown } | null
  const loadedAt = typeof body?.loadedAt === 'string' && !Number.isNaN(Date.parse(body.loadedAt)) ? new Date(body.loadedAt) : null
  let rows
  try {
    rows = cleanRows(g.spec, body?.rows)
  } catch (e) {
    if (e instanceof EditorError) return json({ error: e.message }, 400)
    throw e
  }
  // Who is a crew lead grants permissions: only guild admins may change that set from here.
  if (g.spec.dataset.startsWith('crewRoster:')) {
    const leadsOf = (list: Array<{ memberId?: unknown; status?: unknown }>) =>
      list.filter((r) => String(r.memberId ?? '').trim() && isLeadStatus(String(r.status ?? ''))).map((r) => String(r.memberId).trim()).sort().join(',')
    const before = leadsOf((await g.spec.list()) as Array<{ memberId?: unknown; status?: unknown }>)
    const after = leadsOf(rows as Array<{ memberId?: unknown; status?: unknown }>)
    if (before !== after && !(await isAdminDiscordId(g.auth.session.discordId))) {
      return json({ error: 'Only admins can change who leads the crew' }, 403)
    }
  }
  try {
    const counts = await g.spec.save(rows, g.auth.session.discordId, { loadedAt })
    return json({ ok: true, counts, rows: await g.spec.list(), loadedAt: new Date(Date.now() - 5_000).toISOString() })
  } catch (e) {
    if (e instanceof EditorConflict) return json({ error: e.message, code: 'conflict' }, 409)
    console.error('[crew-content] save failed', e instanceof Error ? e.message : e)
    return json({ error: 'Could not save' }, 500)
  }
}
