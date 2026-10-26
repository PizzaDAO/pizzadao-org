import { requireDisavowDPR, disavowNotFound } from '@/app/lib/disavow/access'
import { enforceRateLimit } from '@/app/lib/rate-limit'
import { out, safe, type Ctx } from '@/app/lib/disavow/http'
import { castVote } from '@/app/lib/disavow/store'
import { parseVote, readJson } from '@/app/lib/disavow/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/disavow/[id]/vote { roundId, choice, comment? } — DPR only. */
export const POST = safe('vote', async (request: Request, ctx: Ctx) => {
  const g = await requireDisavowDPR()
  if (!g.ok) return g.response
  const limited = await enforceRateLimit(request, 'disavow-vote')
  if (limited) return limited
  const parsed = parseVote(await readJson(request))
  if (!parsed.ok) return out({ error: parsed.error }, 400)
  const { id } = await ctx.params
  const r = await castVote({ disavowalId: id, voterDiscordId: g.session.discordId, ...parsed.value })
  if (r.ok) return out({ outcome: r.outcome })
  if (r.code === 'not_found') return disavowNotFound()
  if (r.code === 'conflict') return out({ error: 'You cannot vote on this one' }, 403)
  return out({ error: 'Voting is closed' }, 409)
})
