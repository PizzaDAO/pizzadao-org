import { requireCallReviewer } from '@/app/lib/calls/access'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { draftFollowUpsForRecording } from '@/app/lib/followups/draft'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const lastRun = new Map<string, number>()

/**
 * POST /api/admin/calls/[id]/followups: draft (or re-draft, e.g. after editing the summary) the
 * follow-ups of one call. Idempotent per item: existing rows are never changed, only new items are
 * added. Drafts only, nothing is sent. Dread Pizza Roberts only.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const { id } = await ctx.params
  const now = Date.now()
  if (now - (lastRun.get(id) ?? 0) < 20_000) return json({ error: 'Please wait a few seconds before drafting again' }, 409)
  lastRun.set(id, now)
  const r = await draftFollowUpsForRecording(id, { force: true, actorId: auth.session.discordId })
  if (r.result === 'not-found') return json({ error: 'Not found' }, 404)
  if (r.result === 'not-ready') return json({ error: 'The call needs a summary first' }, 409)
  if (r.result === 'failed') return json({ error: 'Drafting failed; try again in a minute' }, 502)
  return json({ ok: true, created: r.created })
}
