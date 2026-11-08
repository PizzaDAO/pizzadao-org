/**
 * Reads for the history section of /proposals (plans/proposals-history-import.md): filters, the page of past
 * proposals, the totals for the current filter, and a detail record with links and payments. Server only.
 * The filter parsing, the where-clause and the totals arithmetic are pure so the tests can pin them.
 */
import { prisma } from '@/app/lib/db'
import { toSummary, SUMMARY_SELECT, type ProposalRow, type ProposalSummary } from './store'

export const CLOSED_STATUSES = ['PASSED', 'FAILED', 'UNRESOLVED', 'CANCELLED'] as const

export interface HistoryFilters {
  year: number | null
  outcome: 'passed' | 'failed' | 'unresolved' | null
  city: string
  kind: 'FUNDING' | 'GENERAL' | null
  paid: boolean | null
  q: string
  page: number
}

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''))

export function parseHistoryFilters(sp: SP): HistoryFilters {
  const year = Number(one(sp.year))
  const outcome = one(sp.outcome)
  const kind = one(sp.kind).toUpperCase()
  const paid = one(sp.paid)
  const page = Number(one(sp.page))
  return {
    year: Number.isInteger(year) && year >= 2020 && year <= 2100 ? year : null,
    outcome: outcome === 'passed' || outcome === 'failed' || outcome === 'unresolved' ? outcome : null,
    city: one(sp.city).trim().slice(0, 100),
    kind: kind === 'FUNDING' || kind === 'GENERAL' ? kind : null,
    paid: paid === 'yes' ? true : paid === 'no' ? false : null,
    q: one(sp.q).trim().slice(0, 100),
    page: Number.isInteger(page) && page >= 1 && page <= 10000 ? page : 1,
  }
}

/** The Prisma where for the past-proposals list. `includeImported` false hides imported rows (proposals.historyEnabled off). */
export function historyWhere(f: HistoryFilters, includeImported: boolean): Record<string, unknown> {
  const and: Record<string, unknown>[] = []
  const status = f.outcome === 'passed' ? ['PASSED'] : f.outcome === 'failed' ? ['FAILED'] : f.outcome === 'unresolved' ? ['UNRESOLVED'] : [...CLOSED_STATUSES]
  const where: Record<string, unknown> = { status: { in: status }, AND: and }
  if (!includeImported) where.source = 'APP'
  if (f.year) and.push({ closedAt: { gte: new Date(Date.UTC(f.year, 0, 1)), lt: new Date(Date.UTC(f.year + 1, 0, 1)) } })
  if (f.city) and.push({ city: { contains: f.city, mode: 'insensitive' } })
  if (f.kind) and.push({ kind: f.kind })
  if (f.q) and.push({ title: { contains: f.q, mode: 'insensitive' } })
  if (f.paid === true) and.push({ OR: [{ paidOverride: true }, { paidOverride: null, historyPayments: { some: {} } }] })
  if (f.paid === false) and.push({ OR: [{ paidOverride: false }, { paidOverride: null, historyPayments: { none: {} } }] })
  return where
}

export interface TotalsRow {
  status: string
  kind: string
  city: string | null
  closedAt: Date | null
  amountUsdCents: number | null
  paidOverride: boolean | null
  historyPayments: Array<{ usdValue: number | null; source?: string }>
}

export interface GroupTotal {
  label: string
  count: number
  passedAskedUsd: number
  paidUsd: number
}

export interface HistoryTotals {
  count: number
  passed: number
  failed: number
  unresolved: number
  cancelled: number
  passedAskedUsd: number
  paidUsd: number
  byYear: GroupTotal[]
  byCity: GroupTotal[]
}

/** Paid cents for one proposal: payment USD values, falling back to the amount when only no-tx payments exist. */
export function paidCents(r: Pick<TotalsRow, 'amountUsdCents' | 'paidOverride' | 'historyPayments'>): number {
  if (r.paidOverride === false) return 0
  const p = r.historyPayments
  if (p.length === 0) return r.paidOverride === true ? (r.amountUsdCents ?? 0) : 0
  const sum = p.reduce((n, x) => n + (x.usdValue ?? 0), 0)
  // Only a payment recorded without detail (the sheet said Paid) falls back to the amount; a non-USD leg (such as a box) adds nothing.
  if (sum === 0 && p.some((x) => x.usdValue == null && (x.source === 'sheet' || x.source === 'override'))) return r.amountUsdCents ?? 0
  return sum
}

export function isPaid(r: Pick<TotalsRow, 'paidOverride' | 'historyPayments'>): boolean {
  return r.paidOverride ?? r.historyPayments.length > 0
}

export function computeTotals(rows: TotalsRow[]): HistoryTotals {
  const t: HistoryTotals = { count: rows.length, passed: 0, failed: 0, unresolved: 0, cancelled: 0, passedAskedUsd: 0, paidUsd: 0, byYear: [], byCity: [] }
  const years = new Map<string, GroupTotal>()
  const cities = new Map<string, GroupTotal>()
  const bump = (m: Map<string, GroupTotal>, label: string, asked: number, paid: number) => {
    const g = m.get(label) ?? { label, count: 0, passedAskedUsd: 0, paidUsd: 0 }
    g.count++
    g.passedAskedUsd += asked
    g.paidUsd += paid
    m.set(label, g)
  }
  for (const r of rows) {
    if (r.status === 'PASSED') t.passed++
    else if (r.status === 'FAILED') t.failed++
    else if (r.status === 'UNRESOLVED') t.unresolved++
    else if (r.status === 'CANCELLED') t.cancelled++
    const asked = r.status === 'PASSED' ? (r.amountUsdCents ?? 0) / 100 : 0
    const paid = paidCents(r) / 100
    t.passedAskedUsd += asked
    t.paidUsd += paid
    bump(years, r.closedAt ? String(r.closedAt.getUTCFullYear()) : '?', asked, paid)
    bump(cities, (r.city ?? '').trim() || '?', asked, paid)
  }
  t.byYear = [...years.values()].sort((a, b) => b.label.localeCompare(a.label))
  t.byCity = [...cities.values()].sort((a, b) => b.paidUsd - a.paidUsd || b.count - a.count).slice(0, 25)
  return t
}

export interface HistoryPage {
  rows: ProposalSummary[]
  total: number
  page: number
  pages: number
  totals: HistoryTotals
}

export async function listHistory(f: HistoryFilters, pageSize: number, includeImported: boolean): Promise<HistoryPage> {
  const where = historyWhere(f, includeImported)
  const [total, rows, totalRows] = await Promise.all([
    prisma.proposal.count({ where }),
    prisma.proposal.findMany({
      where,
      orderBy: [{ closedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      skip: (f.page - 1) * pageSize,
      take: pageSize,
      select: SUMMARY_SELECT,
    }),
    // One query for the totals over the whole filter (a few hundred small rows), summed in computeTotals.
    prisma.proposal.findMany({
      where,
      select: { status: true, kind: true, city: true, closedAt: true, amountUsdCents: true, paidOverride: true, historyPayments: { select: { usdValue: true, source: true } } },
    }),
  ])
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return { rows: (rows as ProposalRow[]).map(toSummary), total, page: Math.min(f.page, pages), pages, totals: computeTotals(totalRows as TotalsRow[]) }
}

export interface HistoryDetail {
  links: Array<{ id: number; kind: string; url: string | null; label: string | null }>
  payments: Array<{ id: string; paidAt: string | null; amount: string | null; asset: string | null; chain: string | null; usdValue: number | null; txHash: string | null; offchainRef: string | null; note: string | null }>
  proposerDiscordId: string | null
}

export async function getHistoryDetail(id: string): Promise<HistoryDetail | null> {
  const r = await prisma.proposal.findFirst({
    where: { id, source: 'IMPORTED' },
    select: {
      proposerDiscordId: true,
      links: { select: { id: true, kind: true, url: true, label: true }, orderBy: { id: 'asc' } },
      historyPayments: { select: { id: true, paidAt: true, amount: true, asset: true, chain: true, usdValue: true, txHash: true, offchainRef: true, note: true }, orderBy: [{ paidAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }] },
    },
  })
  if (!r) return null
  return {
    proposerDiscordId: r.proposerDiscordId,
    links: r.links,
    payments: r.historyPayments.map((p: { id: string; paidAt: Date | null; amount: { toString(): string } | null; asset: string | null; chain: string | null; usdValue: number | null; txHash: string | null; offchainRef: string | null; note: string | null }) => ({
      ...p,
      paidAt: p.paidAt ? p.paidAt.toISOString().slice(0, 10) : null,
      amount: p.amount == null ? null : trimDecimal(p.amount.toString()),
    })),
  }
}

/** "0.500000000000000000" -> "0.5". */
export function trimDecimal(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** Plain text for a historical body: user, channel and role mentions become names, other Discord markup is dropped. */
export function renderHistoricalBody(text: string, names: { users?: Record<string, string>; channels?: Record<string, string>; roles?: Record<string, string> } = {}): string {
  return text
    .replace(/<@!?(\d{15,25})>/g, (_, id: string) => `@${names.users?.[id] ?? 'member'}`)
    .replace(/<@&(\d{15,25})>/g, (_, id: string) => `@${names.roles?.[id] ?? 'role'}`)
    .replace(/<#(\d{15,25})>/g, (_, id: string) => `#${names.channels?.[id] ?? 'channel'}`)
    .replace(/<a?:(\w+):\d+>/g, '')
    .replace(/<t:\d+(?::[a-zA-Z])?>/g, '')
}
