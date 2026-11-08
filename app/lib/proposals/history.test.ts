/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { computeTotals, historyWhere, paidCents, parseHistoryFilters, renderHistoricalBody, trimDecimal, type TotalsRow } from './history'
import { toSummary, whitelistHistorical } from './store'

const row = (o: Partial<TotalsRow> = {}): TotalsRow => ({ status: 'PASSED', kind: 'FUNDING', city: 'Town', closedAt: new Date('2024-05-01T00:00:00Z'), amountUsdCents: 50000, paidOverride: null, historyPayments: [], ...o })

describe('filters', () => {
  it('parses and bounds query params', () => {
    expect(parseHistoryFilters({ year: '2024', outcome: 'passed', kind: 'funding', paid: 'yes', q: ' x ', page: '3', city: 'Rome' })).toEqual({ year: 2024, outcome: 'passed', kind: 'FUNDING', paid: true, q: 'x', page: 3, city: 'Rome' })
    expect(parseHistoryFilters({ year: '1', outcome: 'bad', kind: 'x', paid: 'maybe', page: '-1' })).toEqual({ year: null, outcome: null, kind: null, paid: null, q: '', page: 1, city: '' })
    expect(parseHistoryFilters({ year: ['2023', '2024'] }).year).toBe(2023)
  })
  it('builds the where: closed statuses only, imported hidden when history is off', () => {
    const w = historyWhere(parseHistoryFilters({}), true) as any
    expect(w.status.in).toEqual(['PASSED', 'FAILED', 'UNRESOLVED', 'CANCELLED'])
    expect(w.source).toBeUndefined()
    expect((historyWhere(parseHistoryFilters({}), false) as any).source).toBe('APP')
    const f = historyWhere(parseHistoryFilters({ outcome: 'unresolved', year: '2024', paid: 'no', q: 'abc' }), true) as any
    expect(f.status.in).toEqual(['UNRESOLVED'])
    expect(JSON.stringify(f.AND)).toContain('historyPayments')
    expect(JSON.stringify(f.AND)).toContain('abc')
  })
})

describe('totals', () => {
  it('counts by outcome and sums asked and paid', () => {
    const t = computeTotals([
      row({ amountUsdCents: 50000, historyPayments: [{ usdValue: 30000 }, { usdValue: 20000 }] }),
      row({ status: 'PASSED', amountUsdCents: 10000, historyPayments: [{ usdValue: null, source: 'sheet' }] }),
      row({ status: 'FAILED', amountUsdCents: 99900 }),
      row({ status: 'UNRESOLVED', amountUsdCents: null, closedAt: new Date('2023-01-01T00:00:00Z'), city: null }),
    ])
    expect(t).toMatchObject({ count: 4, passed: 2, failed: 1, unresolved: 1, passedAskedUsd: 600, paidUsd: 600 })
    expect(t.byYear.map((g) => [g.label, g.count])).toEqual([['2024', 3], ['2023', 1]])
  })
  it('paid cents: override, fallback only for a no-detail payment, non-USD legs add nothing', () => {
    expect(paidCents({ amountUsdCents: 100, paidOverride: false, historyPayments: [{ usdValue: 5 }] })).toBe(0)
    expect(paidCents({ amountUsdCents: 100, paidOverride: true, historyPayments: [] })).toBe(100)
    expect(paidCents({ amountUsdCents: 100, paidOverride: null, historyPayments: [{ usdValue: null, source: 'sheet' }] })).toBe(100)
    expect(paidCents({ amountUsdCents: 100, paidOverride: null, historyPayments: [{ usdValue: null, source: 'finance_match' }] })).toBe(0)
    expect(paidCents({ amountUsdCents: 100, paidOverride: null, historyPayments: [{ usdValue: 40 }, { usdValue: null, source: 'finance_match' }] })).toBe(40)
  })
})

describe('summaries of imported rows', () => {
  const base = { id: 'x', kind: 'FUNDING' as const, title: 't', amountUsdCents: 1000, city: null, opensAt: new Date('2022-01-01T00:00:00Z'), closesAt: null, ayes: 3, nays: 1, abstains: 0, ayesNeeded: null }
  it('shows counts but never the app result line, and only whitelisted historical keys', () => {
    const s = toSummary({ ...base, status: 'PASSED', source: 'IMPORTED', votesRecorded: true, historical: { quorumStated: 15, notes: 'private', derived: 'PASSED' }, paidOverride: null, historyPayments: [{ usdValue: 500 }] })
    expect(s.result).toBeNull()
    expect(s.votes).toEqual({ ayes: 3, nays: 1, abstains: 0 })
    expect(s).toMatchObject({ source: 'IMPORTED', paid: true, paidUsd: 5 })
    expect(s.historical).toEqual({ quorumStated: 15 })
  })
  it('hides votes that were not recorded', () => {
    expect(toSummary({ ...base, status: 'UNRESOLVED', source: 'IMPORTED', votesRecorded: false }).votes).toBeNull()
  })
  it('keeps the app result line for app proposals', () => {
    expect(toSummary({ ...base, status: 'PASSED' }).result).toMatchObject({ ayes: 3 })
  })
  it('whitelists defensively', () => {
    expect(whitelistHistorical(null)).toBeNull()
    expect(whitelistHistorical({ reactions: [{ emoji: '👍', count: 2 }, { bad: 1 }], partlyPaid: true })).toEqual({ reactions: [{ emoji: '👍', count: 2 }], partlyPaid: true })
  })
})

describe('text helpers', () => {
  it('renders mentions as plain text and drops other Discord markup', () => {
    const out = renderHistoricalBody('hi <@123456789012345678> <#223456789012345678> <@&323456789012345678> <:e:423456789012345678>', { users: { '123456789012345678': 'Pat' }, channels: { '223456789012345678': 'general' } })
    expect(out).toBe('hi @Pat #general @role ')
  })
  it('trims decimals', () => {
    expect(trimDecimal('0.500000000000000000')).toBe('0.5')
    expect(trimDecimal('100.000000000000000000')).toBe('100')
    expect(trimDecimal('7')).toBe('7')
  })
})
