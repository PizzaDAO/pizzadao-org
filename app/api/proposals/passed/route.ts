import { proposalsGateOn } from '@/app/lib/proposals/constants'
import { out, requireProposalsSession, safe } from '@/app/lib/proposals/http'
import { loadSeshWindow, seshWindowOpen } from '@/app/lib/proposals/legacy-sesh'
import { passedFundingProposalsFor } from '@/app/lib/proposals/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/proposals/passed — the signed-in member's passed funding proposals (those they filed, or are the named
 * beneficiary of): the payment form's picker. 404 while off.
 *  - `gate` false (a pilot is running): payments are not using proposals yet, so the form keeps its Sesh field.
 *  - `seshWindowOpen`: the Sesh grace window is open, so the form shows the Sesh field next to the picker.
 */
export const GET = safe('passed', async () => {
  const auth = await requireProposalsSession()
  if (!auth.ok) return auth.response
  const gate = await proposalsGateOn()
  const win = gate ? await loadSeshWindow() : null
  return out({ proposals: await passedFundingProposalsFor(auth.session.discordId), gate, seshWindowOpen: !!win && seshWindowOpen(win, new Date()) })
})
