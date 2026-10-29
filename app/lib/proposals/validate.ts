/**
 * Validation for the new-proposal form (pure). The form follows the proposal template (event, location,
 * date, cost, sponsors, description, budget); the server turns it into one plain-text body, which pages
 * render as text (never as HTML or markdown).
 */
import { PROPOSAL_MAX_BODY, PROPOSAL_MAX_CITY, PROPOSAL_MAX_SPONSOR, PROPOSAL_MAX_TITLE, PROPOSAL_MAX_USD } from './constants'

export interface NewProposal {
  kind: 'FUNDING' | 'GENERAL'
  title: string
  body: string
  amountUsdCents: number | null
  eventDate: Date | null
  city: string | null
  sponsorLabel: string | null
}

export type ProposalFormError = 'invalid' | 'bad_kind' | 'bad_title' | 'bad_description' | 'bad_amount' | 'bad_date' | 'too_long'

const clean = (s: unknown, max: number) =>
  typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : ''

export function parseNewProposal(raw: unknown): { ok: true; data: NewProposal } | { ok: false; error: ProposalFormError } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid' }
  const o = raw as Record<string, unknown>
  if (o.kind !== 'FUNDING' && o.kind !== 'GENERAL') return { ok: false, error: 'bad_kind' }
  const kind = o.kind

  const title = clean(o.title, PROPOSAL_MAX_TITLE)
  if (title.length < 3) return { ok: false, error: 'bad_title' }
  const description = clean(o.description, PROPOSAL_MAX_BODY)
  if (description.length < 20) return { ok: false, error: 'bad_description' }

  let amountUsdCents: number | null = null
  if (kind === 'FUNDING') {
    const amount = typeof o.amount === 'number' ? o.amount : typeof o.amount === 'string' ? Number(o.amount.replace(/[$,\s]/g, '')) : NaN
    if (!Number.isFinite(amount) || amount <= 0 || amount > PROPOSAL_MAX_USD) return { ok: false, error: 'bad_amount' }
    amountUsdCents = Math.round(amount * 100)
  }

  let eventDate: Date | null = null
  const dateStr = clean(o.eventDate, 20)
  if (dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { ok: false, error: 'bad_date' }
    eventDate = new Date(`${dateStr}T00:00:00Z`)
    if (Number.isNaN(eventDate.getTime()) || eventDate.toISOString().slice(0, 10) !== dateStr) return { ok: false, error: 'bad_date' }
  }

  const city = clean(o.city, PROPOSAL_MAX_CITY) || null
  const sponsorLabel = clean(o.sponsor, PROPOSAL_MAX_SPONSOR) || null
  const attendance = clean(o.attendance, 60)
  const otherSponsors = clean(o.otherSponsors, 400)
  const pizzaFrom = clean(o.pizzaFrom, 200)
  const budget = clean(o.budget, 3000)

  const parts: string[] = []
  const add = (label: string, value: string) => { if (value) parts.push(`${label}\n${value}`) }
  add('Description and how this benefits PizzaDAO:', description)
  add('Estimated attendance:', attendance)
  add('Other confirmed event sponsors:', otherSponsors)
  add('Ordering pizza from:', pizzaFrom)
  add('Budget breakdown:', budget)
  const body = parts.join('\n\n')
  if (body.length > PROPOSAL_MAX_BODY) return { ok: false, error: 'too_long' }

  return { ok: true, data: { kind, title, body, amountUsdCents, eventDate, city, sponsorLabel } }
}
