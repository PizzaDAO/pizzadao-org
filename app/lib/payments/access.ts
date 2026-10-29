/**
 * Who may review and who may mark paid (plans/host-fast-track.md D2). Both are pinned in code,
 * never settings, so no edit can widen them. Everything fails closed.
 *
 *   review (approve / reject / ask for info / see the queue): the admin roles and Dread Pizza Roberts
 *   mark paid, export CSV, see restricted detail: Dread Pizza Roberts, plus the optional treasury role below
 *
 * Nothing in the app sends money. "Paid" is a person's record that they did, with a reference.
 */
import { NextResponse } from 'next/server'
import { requireSession, hasAnyRoleSafe } from '@/app/lib/auth-guards'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'
import type { Session } from '@/app/lib/session'

/** Roles that may review payment requests (the admin roles; Dread Pizza Roberts is checked separately). */
export const PAYMENT_REVIEWER_ROLE_IDS: readonly string[] = [...ADMIN_ROLE_IDS]

/**
 * Optional pinned treasury role that may also mark requests paid. Empty = Dread Pizza Roberts only.
 * To add one, put the Discord role id here in a reviewed change.
 */
export const PAYMENT_TREASURY_ROLE_IDS: readonly string[] = []

export interface PaymentActor {
  discordId: string
  isDpr: boolean
  canReview: boolean
  canMarkPaid: boolean
}

const NONE = (discordId: string): PaymentActor => ({ discordId, isDpr: false, canReview: false, canMarkPaid: false })

export async function paymentActor(discordId: string): Promise<PaymentActor> {
  if (!discordId) return NONE('')
  try {
    const [isDpr, isAdmin, isTreasury] = await Promise.all([
      isDreadPizzaRoberts(discordId).catch(() => false),
      hasAnyRoleSafe(discordId, PAYMENT_REVIEWER_ROLE_IDS),
      hasAnyRoleSafe(discordId, PAYMENT_TREASURY_ROLE_IDS),
    ])
    return { discordId, isDpr, canReview: isDpr || isAdmin, canMarkPaid: isDpr || isTreasury }
  } catch {
    return NONE(discordId)
  }
}

export async function canReviewPayments(discordId: string): Promise<boolean> {
  return (await paymentActor(discordId)).canReview
}

export async function canMarkPaid(discordId: string): Promise<boolean> {
  return (await paymentActor(discordId)).canMarkPaid
}

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE_HEADERS })

export type ReviewerGuard = { ok: true; session: Session; actor: PaymentActor } | { ok: false; response: NextResponse }

/** 401 without a session, 403 unless the caller may review payments. */
export async function requirePaymentReviewer(): Promise<ReviewerGuard> {
  const auth = await requireSession()
  if (!auth.ok) return { ok: false, response: json({ error: 'Not authenticated' }, 401) }
  const actor = await paymentActor(auth.session.discordId)
  if (!actor.canReview) return { ok: false, response: json({ error: 'Forbidden' }, 403) }
  return { ok: true, session: auth.session, actor }
}

/** 401 without a session, 403 unless the caller may mark requests paid (DPR / treasury). */
export async function requirePaymentTreasurer(): Promise<ReviewerGuard> {
  const g = await requirePaymentReviewer()
  if (!g.ok) return g
  if (!g.actor.canMarkPaid) return { ok: false, response: json({ error: 'Forbidden' }, 403) }
  return g
}

/** 401 without a session, 403 unless Dread Pizza Roberts. */
export async function requirePaymentDpr(): Promise<ReviewerGuard> {
  const g = await requirePaymentReviewer()
  if (!g.ok) return g
  if (!g.actor.isDpr) return { ok: false, response: json({ error: 'Forbidden' }, 403) }
  return g
}

export { isSelf } from './types'
