/**
 * What a requester may see about their own requests: status, amount, and the question a reviewer
 * asked when more information is needed. Never flags, risk, lane, approvers, notes on other
 * actions or the payment reference.
 */
import { prisma } from '@/app/lib/db'
import type { PaymentStatus } from './types'

export interface MyRequest {
  id: string
  title: string
  kind: string
  status: PaymentStatus
  amountUsd: number
  createdAt: string
  /** Latest reviewer question while the request is waiting for information. */
  question: string | null
}

export async function listMyRequests(discordId: string): Promise<MyRequest[]> {
  const rows = await prisma.paymentRequest.findMany({
    where: { requesterDiscordId: discordId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, title: true, kind: true, status: true, amountUsdCents: true, createdAt: true,
      decisions: { where: { action: 'REQUEST_INFO' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { note: true } },
    },
  })
  return rows.map((r: (typeof rows)[number]) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    status: r.status as PaymentStatus,
    amountUsd: r.amountUsdCents / 100,
    createdAt: r.createdAt.toISOString(),
    question: r.status === 'NEEDS_INFO' ? (r.decisions[0]?.note ?? null) : null,
  }))
}
