import { requireDisavowDPR, disavowNotFound } from '@/app/lib/disavow/access'
import { out, safe, type Ctx } from '@/app/lib/disavow/http'
import { openRemoveRound } from '@/app/lib/disavow/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/disavow/[id]/rounds — DPR opens a REMOVE round. */
export const POST = safe('rounds', async (_request: Request, ctx: Ctx) => {
  const g = await requireDisavowDPR()
  if (!g.ok) return g.response
  const { id } = await ctx.params
  const r = await openRemoveRound(id, g.session.discordId)
  if (r === 'not_found') return disavowNotFound()
  if (r === 'ok') return out({ ok: true }, 201)
  return out({ error: r === 'already_open' ? 'A vote is already open' : 'Not currently listed' }, 409)
})
