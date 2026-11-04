import { requireCallReviewer } from '@/app/lib/calls/access'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { proposeTasksForRecording } from '@/app/lib/call-tasks/run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const lastRun = new Map<string, number>()

/**
 * POST /api/admin/calls/[id]/task-proposals: propose (or re-propose, e.g. after editing the
 * summary) crew task updates for one call. Idempotent per item: existing rows are never changed,
 * only new items are added. Proposals only, no task changes. Dread Pizza Roberts only; still
 * needs the calls.taskProposalsEnabled switch and the crew in the allowlist.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const { id } = await ctx.params
  const now = Date.now()
  if (now - (lastRun.get(id) ?? 0) < 20_000) return json({ error: 'Please wait a few seconds before trying again' }, 409)
  lastRun.set(id, now)
  const r = await proposeTasksForRecording(id, { force: true, actorId: auth.session.discordId })
  if (r.result === 'not-found') return json({ error: 'Not found' }, 404)
  if (r.result === 'not-ready') return json({ error: 'The call needs a summary first' }, 409)
  if (r.result === 'disabled') return json({ error: 'Task proposals are off for this crew' }, 409)
  if (r.result === 'crew-excluded') return json({ error: 'This crew is excluded' }, 409)
  if (r.result === 'not-db-crew') return json({ error: "This crew's tasks are still on its Google Sheet" }, 409)
  if (r.result === 'failed') return json({ error: 'Proposing failed; try again in a minute' }, 502)
  return json({ ok: true, created: r.created })
}
