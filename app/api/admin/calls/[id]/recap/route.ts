import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { repostRecap } from '@/app/lib/calls/recap'
import { withErrorHandling } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/calls/[id]/recap
 * Re-render the recap of a published call and edit the Discord message already posted (never posts a
 * new one). Reviewers only.
 */
export const POST = withErrorHandling(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response
  const { id } = await ctx.params
  const result = await repostRecap(id, { edit: true }).catch((err) => {
    console.error('[calls/recap] update failed:', err instanceof Error ? err.message : err)
    return 'failed' as const
  })
  return NextResponse.json({ success: result === 'updated', result }, { status: result === 'updated' ? 200 : 409 })
})
