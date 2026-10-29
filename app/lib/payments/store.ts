/**
 * Database access for payment requests: create, queue, detail, CSV export. No decision logic here
 * (see decide.ts) and nothing that updates or deletes a PaymentDecision.
 *
 * Reviewer views never include payeeHash. Restricted flag detail (disavow-list matches) is replaced
 * with a generic line for everyone except Dread Pizza Roberts.
 */
import { prisma } from '@/app/lib/db'
import { evaluateRequest } from './checks'
import { countApprovals } from './decide'
import { chooseLane, LANE_ORDER, slaHoursFor } from './lane'
import type { NewPaymentRequest } from './ingest'
import type { PaymentPolicy } from './policy'
import type { PaymentFlag, PaymentLane, PaymentStatus } from './types'

export const RESTRICTED_DETAIL = 'Restricted: ask the top review role.'

export function redactFlags(flags: readonly PaymentFlag[], isDpr: boolean): PaymentFlag[] {
  return flags.map((f) => (f.restricted && !isDpr ? { ...f, detail: RESTRICTED_DETAIL } : f))
}

const asFlags = (v: unknown): PaymentFlag[] => (Array.isArray(v) ? (v as PaymentFlag[]) : [])

/** Create a request in the lane its amount implies, then run the checks that refine the lane. */
export async function createPaymentRequest(data: NewPaymentRequest, policy: PaymentPolicy): Promise<{ id: string }> {
  // Until the checks have run (checkedAt is null, and approval is refused) the request sits in the most
  // cautious lane, so a failed or skipped check can never leave it looking routine.
  const { lane, approvalsNeeded } = chooseLane(
    { amountUsd: data.amountUsdCents / 100, riskScore: policy.highRiskScore, flags: [], fastEligible: false },
    policy,
  )
  const row = await prisma.paymentRequest.create({
    data: {
      source: data.source,
      sourceRef: data.sourceRef,
      kind: data.kind,
      requesterDiscordId: data.requesterDiscordId,
      claimedDiscordId: data.claimedDiscordId,
      requesterMemberId: data.requesterMemberId,
      requesterLabel: data.requesterLabel,
      title: data.title,
      description: data.description,
      eventDate: data.eventDate,
      eventCity: data.eventCity,
      rsvEventSlug: data.rsvEventSlug,
      amountUsdCents: data.amountUsdCents,
      currency: data.currency,
      amountOriginal: data.amountOriginal,
      payeeHash: data.payeeHash,
      payeeHint: data.payeeHint,
      proposalUrl: data.proposalUrl,
      proposalId: data.proposalId ?? null,
      lane,
      approvalsNeeded,
    },
    select: { id: true },
  })
  // Rule flags and the final lane. A failed check leaves the request in the lane its amount implies.
  await evaluateRequest(row.id, { policy }).catch((e) => console.error('[payments] check failed:', e instanceof Error ? e.message : e))
  return row
}

export async function findExistingRefs(refs: string[]): Promise<Set<string>> {
  if (refs.length === 0) return new Set()
  const rows = await prisma.paymentRequest.findMany({ where: { sourceRef: { in: refs } }, select: { sourceRef: true } })
  return new Set(rows.map((r: { sourceRef: string | null }) => r.sourceRef).filter((r: string | null): r is string => !!r))
}

export const QUEUE_LIMIT = 500

export interface QueueItem {
  id: string
  title: string
  requesterLabel: string
  kind: string
  status: PaymentStatus
  lane: PaymentLane
  amountUsd: number
  riskScore: number
  flags: Array<Pick<PaymentFlag, 'id' | 'severity'>>
  createdAt: string
  dueAt: string
  overdue: boolean
  approvals: number
  approvalsNeeded: number
}

export async function listQueue(
  filter: 'open' | 'approved' | 'closed',
  policy: PaymentPolicy,
  now: Date = new Date(),
): Promise<{ items: QueueItem[]; total: number }> {
  const statuses: PaymentStatus[] = filter === 'open' ? ['RECEIVED', 'NEEDS_INFO'] : filter === 'approved' ? ['APPROVED'] : ['PAID', 'REJECTED', 'WITHDRAWN']
  // Newest first, so a long queue can never push new requests out of view; the list is then sorted by lane
  // (and oldest first within it). `total` tells the screen when more exist than are shown.
  const where = { status: { in: statuses } }
  const total: number = await prisma.paymentRequest.count({ where })
  const rows = await prisma.paymentRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: QUEUE_LIMIT,
    include: { decisions: { select: { action: true, actorDiscordId: true, actorIsDpr: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  })
  const items = rows.map((r: (typeof rows)[number]): QueueItem => {
    const due = new Date(r.createdAt.getTime() + slaHoursFor(r.lane as PaymentLane, policy) * 3_600_000)
    return {
      id: r.id,
      title: r.title,
      requesterLabel: r.requesterLabel,
      kind: r.kind,
      status: r.status as PaymentStatus,
      lane: r.lane as PaymentLane,
      amountUsd: r.amountUsdCents / 100,
      riskScore: r.riskScore,
      flags: asFlags(r.flags).map((f) => ({ id: f.id, severity: f.severity })),
      createdAt: r.createdAt.toISOString(),
      dueAt: due.toISOString(),
      overdue: filter === 'open' && due.getTime() < now.getTime(),
      approvals: countApprovals(r.decisions).actors.size,
      approvalsNeeded: r.approvalsNeeded,
    }
  })
  return { items: items.sort((a, b) => LANE_ORDER[a.lane] - LANE_ORDER[b.lane] || a.createdAt.localeCompare(b.createdAt)), total }
}

export async function getRequestDetail(id: string, viewer: { isDpr: boolean }) {
  const r = await prisma.paymentRequest.findUnique({
    where: { id },
    include: {
      attachments: { select: { id: true, kind: true, sha256: true, sizeBytes: true, mime: true, uploadedBy: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      checks: { orderBy: { createdAt: 'desc' }, take: 20 },
      decisions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      proposal: { select: { id: true, title: true, status: true, kind: true, amountUsdCents: true, ayes: true, nays: true, abstains: true } },
    },
  })
  if (!r) return null
  return {
    id: r.id,
    source: r.source,
    kind: r.kind,
    status: r.status as PaymentStatus,
    lane: r.lane as PaymentLane,
    requesterDiscordId: r.requesterDiscordId,
    claimedDiscordId: r.claimedDiscordId,
    requesterLabel: r.requesterLabel,
    title: r.title,
    description: r.description,
    eventDate: r.eventDate?.toISOString() ?? null,
    eventCity: r.eventCity,
    rsvEventSlug: r.rsvEventSlug,
    amountUsd: r.amountUsdCents / 100,
    currency: r.currency,
    amountOriginal: r.amountOriginal === null ? null : Number(r.amountOriginal),
    payeeHint: r.payeeHint,
    proposalUrl: r.proposalUrl,
    proposal: r.proposal
      ? { id: r.proposal.id, title: r.proposal.title, status: r.proposal.status as string, amountUsd: r.proposal.amountUsdCents == null ? null : r.proposal.amountUsdCents / 100, ayes: r.proposal.ayes, nays: r.proposal.nays, abstains: r.proposal.abstains }
      : null,
    riskScore: r.riskScore,
    flags: redactFlags(asFlags(r.flags), viewer.isDpr),
    checkedAt: r.checkedAt?.toISOString() ?? null,
    approvalsNeeded: r.approvalsNeeded,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    attachments: r.attachments.map((a: (typeof r.attachments)[number]) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    checks: r.checks.map((c: (typeof r.checks)[number]) => ({
      id: c.id,
      kind: c.kind,
      version: c.version,
      model: c.model,
      createdAt: c.createdAt.toISOString(),
      flags: redactFlags(asFlags((c.result as { flags?: unknown } | null)?.flags), viewer.isDpr),
    })),
    decisions: r.decisions.map((d: (typeof r.decisions)[number]) => ({
      id: d.id,
      action: d.action,
      actorDiscordId: d.actorDiscordId,
      actorIsDpr: d.actorIsDpr,
      lane: d.lane,
      riskScoreAtAction: d.riskScoreAtAction,
      checklist: d.checklist,
      note: d.note,
      proofRef: d.proofRef,
      deployEnv: d.deployEnv,
      createdAt: d.createdAt.toISOString(),
    })),
  }
}

/** Spreadsheet formulas in exported text are neutralised. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Approved and paid requests with who approved and the payment reference, for the treasury and the books. */
export async function exportApprovedCsv(): Promise<string> {
  const rows = await prisma.paymentRequest.findMany({
    where: { status: { in: ['APPROVED', 'PAID'] } },
    orderBy: { createdAt: 'asc' },
    take: 5000,
    include: { decisions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  })
  const head = ['id', 'created', 'status', 'lane', 'kind', 'requester', 'title', 'amount_usd', 'payee_hint', 'approved_by', 'paid_by', 'paid_at', 'proof_ref']
  const lines = [head.join(',')]
  for (const r of rows) {
    const approvals = r.decisions.filter((d: { action: string }) => d.action === 'APPROVE').map((d: { actorDiscordId: string }) => d.actorDiscordId)
    const paid = [...r.decisions].reverse().find((d: { action: string }) => d.action === 'MARK_PAID')
    lines.push(
      [
        r.id, r.createdAt.toISOString(), r.status, r.lane, r.kind, r.requesterLabel, r.title, (r.amountUsdCents / 100).toFixed(2),
        r.payeeHint, [...new Set(approvals)].join(' '), paid?.actorDiscordId, paid?.createdAt.toISOString(), paid?.proofRef,
      ].map(csvCell).join(','),
    )
  }
  return lines.join('\n') + '\n'
}
