import { requireDisavowViewer } from '@/app/lib/disavow/access'
import { enforceRateLimit } from '@/app/lib/rate-limit'
import { out, safe } from '@/app/lib/disavow/http'
import { findActiveListingFor } from '@/app/lib/disavow/match'
import { normalizeMemberId } from '@/app/lib/disavow/identity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/disavow/check?memberId= — is this member listed? Answers eligible
 * viewers only; everyone else gets the standard 404 (no hint of the feature).
 */
export const GET = safe('check', async (request: Request) => {
  const g = await requireDisavowViewer()
  if (!g.ok) return g.response
  const limited = await enforceRateLimit(request, 'disavow-check')
  if (limited) return limited
  const memberId = normalizeMemberId(new URL(request.url).searchParams.get('memberId') ?? '')
  if (!memberId) return out({ error: 'Invalid member' }, 400)
  const hit = await findActiveListingFor(memberId)
  return out(hit ? { listed: true, id: hit.id } : { listed: false })
})
