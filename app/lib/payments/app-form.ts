/**
 * Validation for the in-app payment request form (phase 4). Pure: the route adds who is asking.
 *
 * The payee reference is hashed and masked here and the raw value is dropped. A pasted party-platform
 * link is refused: those events are handled on that platform, so they are not paid twice.
 */
import { hashPayee, maskPayee } from './hash'
import type { NewPaymentRequest } from './ingest'
import type { PaymentKind } from './types'

export const APP_KINDS: readonly PaymentKind[] = ['EVENT_BUDGET', 'REIMBURSEMENT', 'WORK', 'OTHER']
export const MAX_APP_AMOUNT_USD = 1_000_000

export type AppFormError =
  | 'invalid'
  | 'bad_kind'
  | 'bad_title'
  | 'bad_description'
  | 'bad_amount'
  | 'bad_date'
  | 'bad_link'
  | 'party_event'

const clean = (s: unknown, max: number) =>
  typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : ''

const PARTY_PLATFORM = /rsv\.pizza/i

export function parseNewRequest(
  body: unknown,
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; data: Omit<NewPaymentRequest, 'requesterDiscordId' | 'claimedDiscordId' | 'requesterMemberId' | 'requesterLabel'> } | { ok: false; error: AppFormError } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid' }
  const o = body as Record<string, unknown>
  if (Object.values(o).some((v) => typeof v === 'string' && PARTY_PLATFORM.test(v))) return { ok: false, error: 'party_event' }

  if (typeof o.kind !== 'string' || !(APP_KINDS as readonly string[]).includes(o.kind)) return { ok: false, error: 'bad_kind' }
  const title = clean(o.title, 200)
  if (title.length < 3) return { ok: false, error: 'bad_title' }
  const description = clean(o.description, 4000)
  if (description.length < 10) return { ok: false, error: 'bad_description' }

  const amount = typeof o.amount === 'number' ? o.amount : typeof o.amount === 'string' ? Number(o.amount.replace(/[$,\s]/g, '')) : NaN
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_APP_AMOUNT_USD) return { ok: false, error: 'bad_amount' }
  const cents = Math.round(amount * 100)

  let eventDate: Date | null = null
  const dateStr = clean(o.eventDate, 20)
  if (dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { ok: false, error: 'bad_date' }
    eventDate = new Date(`${dateStr}T00:00:00Z`)
    if (Number.isNaN(eventDate.getTime())) return { ok: false, error: 'bad_date' }
  }

  const link = clean(o.proposalUrl, 500)
  if (link && !/^https:\/\/\S{4,480}$/i.test(link)) return { ok: false, error: 'bad_link' }

  const rawProposalId = clean(o.proposalId, 60)
  const proposalId = /^[A-Za-z0-9_-]{8,60}$/.test(rawProposalId) ? rawProposalId : null

  const payee = clean(o.payee, 200)
  return {
    ok: true,
    data: {
      source: 'APP',
      sourceRef: null,
      kind: o.kind as PaymentKind,
      title,
      description,
      eventDate,
      eventCity: clean(o.eventCity, 100) || null,
      rsvEventSlug: null,
      amountUsdCents: cents,
      currency: 'USD',
      amountOriginal: cents / 100,
      payeeHash: payee ? hashPayee(payee, env) : null,
      payeeHint: payee ? maskPayee(payee) : null,
      proposalUrl: link || null,
      proposalId,
    },
  }
}
