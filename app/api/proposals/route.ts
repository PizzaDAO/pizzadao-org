import { after } from 'next/server'
import { rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { checkKeyedRateLimit } from '@/app/lib/rate-limit'
import { openAndAnnounce } from '@/app/lib/proposals/lifecycle'
import { out, requireProposalsSession, safe } from '@/app/lib/proposals/http'
import { canSubmitProposal } from '@/app/lib/proposals/proposer'
import { createProposal } from '@/app/lib/proposals/store'
import { parseNewProposal } from '@/app/lib/proposals/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Opening a proposal takes the eligibility snapshot (one chain lookup per member with a wallet), after the response.
export const maxDuration = 300

/** POST /api/proposals — submit a proposal. Box holders only. Voting opens right after the response. */
export const POST = safe('create', async (request: Request) => {
  const auth = await requireProposalsSession()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const discordId = auth.session.discordId

  const limited = await checkKeyedRateLimit('proposals-create', discordId)
  if (!limited.success) return out({ error: 'rate_limited' }, 429)

  const parsed = parseNewProposal(await request.json().catch(() => null))
  if (!parsed.ok) return out({ error: parsed.error }, 400)
  if (!(await canSubmitProposal(discordId))) return out({ error: 'not_holder' }, 403)

  const { id } = await createProposal({ ...parsed.data, proposerDiscordId: discordId })
  after(() => openAndAnnounce(id))
  return out({ ok: true, id }, 201)
})
