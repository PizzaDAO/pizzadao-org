import { after } from 'next/server'
import { rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { checkKeyedRateLimit } from '@/app/lib/rate-limit'
import { getSetting } from '@/app/lib/settings'
import { fetchMemberByDiscordId } from '@/app/lib/sheets/member-repository'
import { openAndAnnounce } from '@/app/lib/proposals/lifecycle'
import { out, requireProposalsSession, safe } from '@/app/lib/proposals/http'
import { loadPilotState } from '@/app/lib/proposals/pilot'
import { canSubmitProposal } from '@/app/lib/proposals/proposer'
import { countActiveFor, createProposal } from '@/app/lib/proposals/store'
import { parseNewProposal } from '@/app/lib/proposals/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Opening a proposal lists the voter-role holders (a full guild listing) after the response.
export const maxDuration = 300

/** Waiting-or-open proposals per member. Unreadable settings give the strictest value. */
async function maxActivePerProposer(): Promise<number> {
  try {
    return await getSetting('proposals.maxOpenPerProposer')
  } catch {
    return 1
  }
}

/**
 * POST /api/proposals — submit a proposal. Voter-role holders only (Box Mafia by default). Voting opens right after
 * the response. A member may have at most proposals.maxOpenPerProposer waiting or open at once. While a pilot list is
 * set the proposal is a test proposal (short window, never listed or counted).
 */
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
  if ((await countActiveFor(discordId)) >= (await maxActivePerProposer())) return out({ error: 'too_many_open' }, 409)

  // The beneficiary must be a member; naming yourself is the same as naming nobody.
  let beneficiaryDiscordId = parsed.data.beneficiaryDiscordId
  if (beneficiaryDiscordId === discordId) beneficiaryDiscordId = null
  if (beneficiaryDiscordId) {
    const member = await fetchMemberByDiscordId(beneficiaryDiscordId).catch(() => null)
    if (!member?.memberId) return out({ error: 'bad_beneficiary' }, 400)
  }

  const isTest = (await loadPilotState()).running
  const { id } = await createProposal({ ...parsed.data, beneficiaryDiscordId, proposerDiscordId: discordId, isTest })
  after(() => openAndAnnounce(id))
  return out({ ok: true, id }, 201)
})
