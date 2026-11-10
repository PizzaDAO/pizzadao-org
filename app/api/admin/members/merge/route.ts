import { requireDpr, rejectUnsafeWrite, json } from '@/app/lib/admin-guard'
import { mergeMembers, unmergeMembers, MergeError } from '@/app/lib/members/merge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/admin/members/merge   { keepId, removeId, apply?: boolean }  or  { unmergeId, apply?: boolean }
 * Dread Pizza Roberts only. Without `apply` it is a dry run: the full per-table report, nothing written.
 */
export async function POST(request: Request) {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe

  let body: { keepId?: unknown; removeId?: unknown; apply?: unknown; unmergeId?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  if (body.unmergeId !== undefined) {
    const mergeId = Number(body.unmergeId)
    if (!Number.isInteger(mergeId) || mergeId <= 0) return json({ error: 'unmergeId must be a merge id' }, 400)
    try {
      return json({ unmerge: await unmergeMembers(mergeId, { dryRun: body.apply !== true, actor: auth.session.discordId }) })
    } catch (e) {
      if (e instanceof MergeError) return json({ error: e.message }, 400)
      if (e instanceof Error && e.message === 'Insufficient funds') return json({ error: 'The kept account no longer has the merged PEP, so the merge cannot be undone.' }, 400)
      console.error('[members-merge] unmerge failed', e instanceof Error ? e.message : e)
      return json({ error: 'Unmerge failed' }, 500)
    }
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
    // The undo data (row ids and snapshots) stays in the audit row; it is not sent to the browser.
    const { undo: _undo, ...rest } = report
    void _undo
    return json({ report: rest })
  } catch (e) {
    if (e instanceof MergeError) return json({ error: e.message }, 400)
    console.error('[members-merge] failed', e instanceof Error ? e.message : e)
    return json({ error: 'Merge failed' }, 500)
  }
}
