import { requireSession } from '@/app/lib/auth-guards'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { prisma } from '@/app/lib/db'
import { applyProposal, dismissProposal } from '@/app/lib/call-tasks/apply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/crew/<crewId>/proposals/<id>  { action: 'apply' | 'dismiss', edits?, force? }
 * Decide on one proposed task update. Leads of the crew and guild admins only (re-checked in
 * apply.ts, fails closed). `force` re-confirms an apply after a conflict (the task changed since).
 */
export async function POST(request: Request, { params }: { params: Promise<{ crewId: string; id: string }> }) {
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  const { crewId: rawCrew, id } = await params
  const crewId = normalizeCrewId(rawCrew)
  const body = (await request.json().catch(() => null)) as { action?: unknown; edits?: unknown; force?: unknown } | null
  if (!crewId || !body || (body.action !== 'apply' && body.action !== 'dismiss')) return json({ error: 'Bad request' }, 400)
  // The proposal must belong to the crew in the URL.
  const row = await prisma.crewTaskProposal.findUnique({ where: { id }, select: { crewId: true } })
  if (!row || row.crewId !== crewId) return json({ error: 'Not found' }, 404)
  const actor = auth.session.discordId

  if (body.action === 'dismiss') {
    const r = await dismissProposal(id, actor)
    if (r === 'forbidden') return json({ error: 'Only crew leads can decide on this' }, 403)
    if (r === 'not-pending') return json({ error: 'Already decided' }, 409)
    if (r === 'not-found') return json({ error: 'Not found' }, 404)
    return json({ ok: true })
  }

  const r = await applyProposal(id, actor, { edits: body.edits, force: body.force === true })
  switch (r.result) {
    case 'applied':
      return json({ ok: true, taskId: r.taskId })
    case 'forbidden':
      return json({ error: 'Only crew leads can decide on this' }, 403)
    case 'not-found':
      return json({ error: 'Not found' }, 404)
    case 'not-pending':
      return json({ error: 'Already decided' }, 409)
    case 'not-db-crew':
      return json({ error: "This is still edited in the crew's Google Sheet" }, 409)
    case 'needs-lead':
      return json({ error: 'Pick who leads it first', code: 'needs-lead' }, 409)
    case 'missing-task':
      return json({ error: 'The task no longer exists', code: 'missing-task' }, 409)
    case 'conflict':
      return json({ error: 'The task changed since this was proposed', code: 'conflict', current: r.current }, 409)
    case 'bad-edits':
      return json({ error: 'Check the edited values' }, 400)
    default:
      return json({ error: 'Could not apply' }, 500)
  }
}
