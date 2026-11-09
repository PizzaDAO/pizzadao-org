import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { repostRecap } from '@/app/lib/calls/recap'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/calls/[id]/recap  (JSON body, e.g. {})
 * Re-render the recap of a published call and edit the Discord message already posted (never posts a
 * new one). Reviewers only. Answers { success, result }; a refusal is a 409 (502 when Discord failed).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const { id } = await ctx.params
  const result = await repostRecap(id, { edit: true }).catch((err) => {
    console.error('[calls/recap] update failed:', err instanceof Error ? err.message : err)
    return 'failed' as const
  })
  return json({ success: result === 'updated', result }, result === 'updated' ? 200 : result === 'failed' ? 502 : 409)
}
