import { requireDisavowViewer, disavowNotFound } from '@/app/lib/disavow/access'
import { out, safe, type Ctx } from '@/app/lib/disavow/http'
import { withdraw } from '@/app/lib/disavow/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/disavow/[id]/withdraw — the nominator, while still NOMINATED. */
export const POST = safe('withdraw', async (_request: Request, ctx: Ctx) => {
  const g = await requireDisavowViewer()
  if (!g.ok) return g.response
  const { id } = await ctx.params
  const r = await withdraw(id, g.session.discordId)
  if (r === 'not_found') return disavowNotFound()
  if (r === 'forbidden') return out({ error: 'Only the nominator can withdraw' }, 403)
  if (r === 'bad_state') return out({ error: 'Cannot withdraw now' }, 409)
  return out({ ok: true })
})
