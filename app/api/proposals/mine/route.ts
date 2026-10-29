import { proposalsEnabled } from '@/app/lib/proposals/constants'
import { out, requireProposalsSession, safe } from '@/app/lib/proposals/http'
import { openForViewer } from '@/app/lib/proposals/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/proposals/mine — open proposals the signed-in member can vote on, and whether a token was issued.
 * The site-wide ballot preparer calls this on any page: `{ enabled: false }` while the feature is off, 401 when logged out.
 */
export const GET = safe('mine', async () => {
  if (!(await proposalsEnabled())) return out({ enabled: false, proposals: [] })
  const auth = await requireProposalsSession()
  if (!auth.ok) return auth.response
  return out({ enabled: true, proposals: await openForViewer(auth.session.discordId) })
})
