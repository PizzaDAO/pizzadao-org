import { out, requireProposalsSession, safe } from '@/app/lib/proposals/http'
import { passedFundingProposalsFor } from '@/app/lib/proposals/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/proposals/passed — the signed-in member's passed funding proposals (the payment form's picker). 404 while off. */
export const GET = safe('passed', async () => {
  const auth = await requireProposalsSession()
  if (!auth.ok) return auth.response
  return out({ proposals: await passedFundingProposalsFor(auth.session.discordId) })
})
