import { requireDisavowViewer, disavowNotFound } from '@/app/lib/disavow/access'
import { getDisavowDetail } from '@/app/lib/disavow/detail'
import { out, safe, type Ctx } from '@/app/lib/disavow/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/disavow/[id] — detail; DPR-only fields are stripped for everyone else. */
export const GET = safe('detail', async (_request: Request, ctx: Ctx) => {
  const g = await requireDisavowViewer()
  if (!g.ok) return g.response
  const { id } = await ctx.params
  const d = await getDisavowDetail(id, { discordId: g.session.discordId, isDPR: g.isDPR })
  if (!d) return disavowNotFound()
  return out(d)
})
