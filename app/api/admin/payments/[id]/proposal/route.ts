import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { requirePaymentReviewer } from '@/app/lib/payments/access'
import { evaluateRequest } from '@/app/lib/payments/checks'
import { loadPaymentPolicy } from '@/app/lib/payments/policy'
import { proposalsEnabled } from '@/app/lib/proposals/constants'
import { validatePaymentProposal } from '@/app/lib/proposals/payment-link'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUS = { proposal_required: 400, proposal_invalid: 400, proposal_exhausted: 409 } as const

/**
 * POST /api/admin/payments/[id]/proposal {proposalId, note?} — a reviewer links a passed funding proposal to an
 * open request (for example one that came in through the public form, or was filed before the proposal passed).
 * Same rules as the request form (validatePaymentProposal): passed, funding, filed by the requester, big enough,
 * not already spent. The link is written with an append-only NOTE decision, then the checks re-run.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requirePaymentReviewer()
  if (!g.ok) return g.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  if (!(await proposalsEnabled())) return json({ error: 'Not found' }, 404)
  const b = (await request.json().catch(() => null)) as { proposalId?: unknown; note?: unknown } | null
  const proposalId = typeof b?.proposalId === 'string' && /^[A-Za-z0-9_-]{8,60}$/.test(b.proposalId) ? b.proposalId : ''
  if (!proposalId) return json({ error: 'Pick a proposal' }, 400)
  const { id } = await ctx.params
  try {
    const policy = await loadPaymentPolicy()
    const out = await prisma.$transaction(async (tx) => {
      const r = await tx.paymentRequest.findUnique({
        where: { id },
        select: { status: true, lane: true, riskScore: true, flags: true, amountUsdCents: true, requesterDiscordId: true, claimedDiscordId: true },
      })
      if (!r) return { status: 404 as const, error: 'Not found' }
      if (r.status !== 'RECEIVED' && r.status !== 'NEEDS_INFO') return { status: 409 as const, error: 'This request is no longer open' }
      const who = r.requesterDiscordId ?? r.claimedDiscordId
      if (!who) return { status: 400 as const, error: 'The request has no requester to match the proposal to' }
      if (who === g.actor.discordId) return { status: 403 as const, error: 'You cannot link a proposal to your own request' }
      // Lock the proposal row so the re-sum below cannot race another approval or link.
      await tx.$queryRaw`SELECT id FROM "Proposal" WHERE id = ${proposalId} FOR UPDATE`
      const link = await validatePaymentProposal({
        proposalId,
        requesterDiscordId: who,
        amountUsdCents: r.amountUsdCents,
        capUsdCents: Math.round(policy.onApprovalCapUsd * 100),
        excludeRequestId: id,
      }, tx)
      if (!link.ok) return { status: STATUS[link.error], error: link.error }
      await tx.paymentRequest.update({ where: { id }, data: { proposalId, proposalUrl: null } })
      await tx.paymentDecision.create({
        data: {
          requestId: id,
          action: 'NOTE',
          actorDiscordId: g.actor.discordId,
          actorIsDpr: g.actor.isDpr,
          lane: r.lane,
          riskScoreAtAction: r.riskScore,
          flagsAtAction: r.flags as never,
          checklist: { linkedProposalId: proposalId } as never,
          note: (typeof b?.note === 'string' ? b.note.trim().slice(0, 500) : '') || 'Linked a passed proposal.',
          deployEnv: process.env.VERCEL_ENV ?? 'local',
        },
      })
      return { status: 200 as const }
    })
    if (out.status !== 200) return json({ error: (out as { error?: string }).error }, out.status)
    await evaluateRequest(id).catch((e) => console.error('[payments] check failed:', e instanceof Error ? e.message : e))
    return json({ ok: true })
  } catch (e) {
    console.error('[admin payments] link proposal failed:', e instanceof Error ? e.message : e)
    return json({ error: 'Could not link the proposal' }, 500)
  }
}
