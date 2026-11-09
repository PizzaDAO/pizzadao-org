import { requireDpr, rejectUnsafeWrite, json } from '@/app/lib/admin-guard'
import { mergeMembers, MergeError } from '@/app/lib/members/merge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/admin/members/merge   { keepId, removeId, apply?: boolean }
 * Dread Pizza Roberts only. Without `apply` it is a dry run: the full per-table report, nothing written.
 */
export async function POST(request: Request) {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe

  let body: { keepId?: unknown; removeId?: unknown; apply?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const keepId = typeof body.keepId === 'string' ? body.keepId.trim() : ''
  const removeId = typeof body.removeId === 'string' ? body.removeId.trim() : ''
  if (!keepId || !removeId) return json({ error: 'keepId and removeId are required' }, 400)

  try {
    const report = await mergeMembers({
      keepId,
      removeId,
      dryRun: body.apply !== true,
      actor: auth.session.discordId,
    })
    return json({ report })
  } catch (e) {
    if (e instanceof MergeError) return json({ error: e.message }, 400)
    console.error('[members-merge] failed', e instanceof Error ? e.message : e)
    return json({ error: 'Merge failed' }, 500)
  }
}
