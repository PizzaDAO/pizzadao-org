// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { displayOrder, isInternalPath, manualFreshness, parseReviewedDate } from './manuals-freshness'

const now = new Date('2026-11-14T12:00:00Z')
const opts = { now, staleAfterDays: 365, hideDrafts: false, hideReplaced: false }

describe('stale computation', () => {
  it('is stale only when reviewed longer ago than the threshold', () => {
    expect(manualFreshness({ status: 'Complete', reviewedAt: '2025-11-13' }, opts).stale).toBe(true)
    expect(manualFreshness({ status: 'Complete', reviewedAt: '2025-11-15' }, opts).stale).toBe(false)
    expect(manualFreshness({ status: 'Complete', reviewedAt: '2026-11-01' }, opts).stale).toBe(false)
  })
  it('follows the threshold setting', () => {
    expect(manualFreshness({ status: '', reviewedAt: '2026-08-01' }, { ...opts, staleAfterDays: 30 }).stale).toBe(true)
    expect(manualFreshness({ status: '', reviewedAt: '2026-08-01' }, { ...opts, staleAfterDays: 365 }).stale).toBe(false)
  })
  it('a never-reviewed manual is flagged but not stale', () => {
    const f = manualFreshness({ status: 'Complete', reviewedAt: null }, opts)
    expect(f).toMatchObject({ stale: false, neverReviewed: true, reviewedAt: null })
  })
  it('accepts Date values and rejects bad dates', () => {
    expect(manualFreshness({ status: '', reviewedAt: new Date('2020-01-01T00:00:00Z') }, opts).stale).toBe(true)
    expect(parseReviewedDate('2026-02-31')).toBeNull()
    expect(parseReviewedDate('last spring')).toBeNull()
    expect(parseReviewedDate('2026-11-14')?.toISOString()).toBe('2026-11-14T00:00:00.000Z')
  })
})

describe('draft and replaced marks', () => {
  it('flags draft case-insensitively and replaced only for internal paths', () => {
    expect(manualFreshness({ status: ' DRAFT ' }, opts).draft).toBe(true)
    expect(manualFreshness({ status: 'Complete' }, opts).draft).toBe(false)
    expect(manualFreshness({ status: '', supersededBy: '/handbook/host-a-party' }, opts)).toMatchObject({ replaced: true, supersededBy: '/handbook/host-a-party' })
    expect(manualFreshness({ status: '', supersededBy: 'https://evil.example' }, opts)).toMatchObject({ replaced: false, supersededBy: null })
    expect(manualFreshness({ status: '', supersededBy: '//evil.example' }, opts).replaced).toBe(false)
  })
  it('isInternalPath', () => {
    expect(isInternalPath('/handbook')).toBe(true)
    for (const bad of ['handbook', '//x.y', 'javascript:alert(1)', '/a/../b', '/a b', '']) expect(isInternalPath(bad)).toBe(false)
  })
})

describe('listing filters', () => {
  const rows: Array<{ status: string; supersededBy?: string }> = [
    { status: 'Complete' },
    { status: 'Draft' },
    { status: 'Complete', supersededBy: '/handbook/x' },
    { status: 'Draft', supersededBy: '/handbook/y' },
  ]
  const hidden = (o: Partial<typeof opts>) => rows.map((r) => manualFreshness(r, { ...opts, ...o }).hidden)
  it('shows everything (marked) by default', () => expect(hidden({})).toEqual([false, false, false, false]))
  it('hideDrafts hides drafts only', () => expect(hidden({ hideDrafts: true })).toEqual([false, true, false, true]))
  it('hideReplaced hides replaced only', () => expect(hidden({ hideReplaced: true })).toEqual([false, false, true, true]))
  it('both hide both', () => expect(hidden({ hideDrafts: true, hideReplaced: true })).toEqual([false, true, true, true]))
  it('replaced rows sort last, keeping the original order otherwise', () => {
    expect(displayOrder([{ replaced: false }, {}, { replaced: false }])).toEqual([0, 1, 2])
    expect(displayOrder([{ replaced: true }, { replaced: false }, { replaced: true }, {}])).toEqual([1, 3, 0, 2])
  })
})
