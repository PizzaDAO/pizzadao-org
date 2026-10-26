import { requireDisavowViewer, disavowNotFound } from '@/app/lib/disavow/access'
import { out, safe } from '@/app/lib/disavow/http'
import { withdrawSubmission } from '@/app/lib/disavow/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/disavow/submissions/[sid]/withdraw — withdraw your own submission.
 * Works on the caller's submission id, so a duplicate submitter (who never
 * learns the entry) can withdraw too. Someone else's id is a plain 404.
 */
export const POST = safe('withdraw', async (_request: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const g = await requireDisavowViewer()
  if (!g.ok) return g.response
  const { sid } = await ctx.params
  const r = await withdrawSubmission(sid, g.session.discordId)
  if (r === 'not_found') return disavowNotFound()
  return out({ ok: true })
})
