import { requireDisavowDPR, disavowNotFound } from '@/app/lib/disavow/access'
import { out, safe, type Ctx } from '@/app/lib/disavow/http'
import { suspend } from '@/app/lib/disavow/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/disavow/[id]/suspend — any single DPR hides a listing and opens a REMOVE vote. */
export const POST = safe('suspend', async (_request: Request, ctx: Ctx) => {
  const g = await requireDisavowDPR()
  if (!g.ok) return g.response
  const { id } = await ctx.params
  const r = await suspend(id, g.session.discordId)
  if (r === 'not_found') return disavowNotFound()
  if (r === 'bad_state') return out({ error: 'Not currently listed' }, 409)
  return out({ ok: true })
})
