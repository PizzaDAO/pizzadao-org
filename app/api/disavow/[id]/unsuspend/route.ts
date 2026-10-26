import { requireDisavowDPR, disavowNotFound } from '@/app/lib/disavow/access'
import { out, safe, type Ctx } from '@/app/lib/disavow/http'
import { unsuspend } from '@/app/lib/disavow/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/disavow/[id]/unsuspend — DPR restores a suspended listing. */
export const POST = safe('unsuspend', async (_request: Request, ctx: Ctx) => {
  const g = await requireDisavowDPR()
  if (!g.ok) return g.response
  const { id } = await ctx.params
  const r = await unsuspend(id, g.session.discordId)
  if (r === 'not_found') return disavowNotFound()
  if (r === 'bad_state') return out({ error: 'Not suspended' }, 409)
  return out({ ok: true })
})
