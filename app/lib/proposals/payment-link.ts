/**
 * Linking a payment request to a passed proposal (the request form, while proposals are on).
 *
 * Above the on-approval cap a request must name a PASSED funding proposal that the requester filed, for at
 * least the amount asked, and the requests already funded from it plus this one may not exceed what it passed
 * for. At or below the cap a proposal is optional but, if named, is held to the same rules.
 */
import { prisma } from '@/app/lib/db'

export type LinkError = 'proposal_required' | 'proposal_invalid' | 'proposal_exhausted'

export interface LinkInput {
  proposalId: string | null
  requesterDiscordId: string
  amountUsdCents: number
  capUsdCents: number
  /** A request being (re)linked: its own amount is already in the sum and must not count twice. */
  excludeRequestId?: string
}

export interface LinkableProposal {
  kind: string
  status: string
  proposerDiscordId: string
  amountUsdCents: number | null
}

/** Pure: decide from the proposal and the cents already committed to it. */
export function checkProposalLink(i: LinkInput, proposal: LinkableProposal | null, alreadyFundedCents: number): LinkError | null {
  if (!i.proposalId) return i.amountUsdCents > i.capUsdCents ? 'proposal_required' : null
  if (!proposal || proposal.kind !== 'FUNDING' || proposal.status !== 'PASSED' || proposal.proposerDiscordId !== i.requesterDiscordId || proposal.amountUsdCents == null) {
    return 'proposal_invalid'
  }
  if (i.amountUsdCents > proposal.amountUsdCents) return 'proposal_invalid'
  if (alreadyFundedCents + i.amountUsdCents > proposal.amountUsdCents) return 'proposal_exhausted'
  return null
}

/** `db` lets a caller run the reads inside its own transaction (the reviewer link action holds a lock there). */
export async function validatePaymentProposal(i: LinkInput, db: Pick<typeof prisma, 'proposal' | 'paymentRequest'> = prisma): Promise<{ ok: true; proposalId: string | null } | { ok: false; error: LinkError }> {
  if (!i.proposalId) {
    const e = checkProposalLink(i, null, 0)
    return e ? { ok: false, error: e } : { ok: true, proposalId: null }
  }
  const [proposal, others] = await Promise.all([
    db.proposal.findUnique({ where: { id: i.proposalId }, select: { kind: true, status: true, proposerDiscordId: true, amountUsdCents: true } }),
    db.paymentRequest.findMany({
      where: { proposalId: i.proposalId, status: { notIn: ['REJECTED', 'WITHDRAWN'] }, ...(i.excludeRequestId ? { id: { not: i.excludeRequestId } } : {}) },
      select: { amountUsdCents: true },
    }),
  ])
  const funded = (others as Array<{ amountUsdCents: number }>).reduce((n, r) => n + r.amountUsdCents, 0)
  const e = checkProposalLink(i, proposal, funded)
  return e ? { ok: false, error: e } : { ok: true, proposalId: i.proposalId }
}
