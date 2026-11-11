import { checkKeyedRateLimit } from '@/app/lib/rate-limit'
import { searchMembers } from '@/app/lib/followups/admin'
import { out, requireProposalsSession, safe } from '@/app/lib/proposals/http'
import { canSubmitProposal } from '@/app/lib/proposals/proposer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/proposals/members?q=<name> — member search for naming a beneficiary on a new proposal. Signed-in voters
 * only (404 while the feature is off); name and Discord id of at most 8 members who have a Discord account linked.
 */
export const GET = safe('members', async (request: Request) => {
  const auth = await requireProposalsSession()
  if (!auth.ok) return auth.response
  // Only people who can submit a proposal need the search (the picker is on the new-proposal form).
  if (!(await canSubmitProposal(auth.session.discordId))) return out({ error: 'not_holder' }, 403)
  const limited = await checkKeyedRateLimit('proposals-member-search', auth.session.discordId)
  if (!limited.success) return out({ error: 'rate_limited' }, 429)
  const q = (new URL(request.url).searchParams.get('q') ?? '').slice(0, 80)
  try {
    const found = await searchMembers(q)
    return out({ members: found.map((m) => ({ name: m.name, discordId: m.discordId })) })
  } catch {
    return out({ error: 'unavailable' }, 502)
  }
})
