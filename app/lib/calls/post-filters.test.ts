// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { EMPTY_POST_FILTER, cleanList, clearPostFilterCache, isCrewExcluded, loadPostFilter, mentionsBlockedTerm, savePostFilter, type PostFilter } from './post-filters'

const f = (o: Partial<PostFilter>): PostFilter => ({ ...EMPTY_POST_FILTER, ...o })

beforeEach(() => {
  vi.clearAllMocks()
  clearPostFilterCache()
})

describe('isCrewExcluded', () => {
  it('matches by crew id after slug normalization', () => {
    const filter = f({ excludedCrewIds: ['Crew X'] })
    expect(isCrewExcluded({ id: 'crew_x', label: 'Anything' }, filter)).toBe(true)
    expect(isCrewExcluded({ id: 'crew_y', label: 'Anything' }, filter)).toBe(false)
  })
  it('matches label terms as whole words, case-insensitively, in the label or id', () => {
    const filter = f({ excludedCrewLabelTerms: ['ZETA'] })
    expect(isCrewExcluded({ id: 'a', label: 'Team Zeta' }, filter)).toBe(true)
    expect(isCrewExcluded({ id: 'a', label: 'zeta-crew' }, filter)).toBe(true)
    expect(isCrewExcluded({ id: 'team_zeta', label: '' }, filter)).toBe(true)
    expect(isCrewExcluded({ id: 'a', label: 'Zetamax' }, filter)).toBe(false)
  })
  it('excludes nothing with an empty filter', () => {
    expect(isCrewExcluded({ id: 'crew_x', label: 'ZETA' }, EMPTY_POST_FILTER)).toBe(false)
  })
})

describe('mentionsBlockedTerm', () => {
  const filter = f({ blockedTerms: ['ZETA', 'two words'] })
  it('is whole-word and case-insensitive', () => {
    expect(mentionsBlockedTerm('Talk to zeta folks', filter)).toBe(true)
    expect(mentionsBlockedTerm('the Zeta-team', filter)).toBe(true)
    expect(mentionsBlockedTerm('see two words here', filter)).toBe(true)
    expect(mentionsBlockedTerm('zetamax', filter)).toBe(false)
    expect(mentionsBlockedTerm(null, filter)).toBe(false)
    expect(mentionsBlockedTerm('ZETA', EMPTY_POST_FILTER)).toBe(false)
  })
  it('treats regex characters in a term literally', () => {
    expect(mentionsBlockedTerm('abc', f({ blockedTerms: ['a.c'] }))).toBe(false)
    expect(mentionsBlockedTerm('a.c', f({ blockedTerms: ['a.c'] }))).toBe(true)
  })
})

describe('cleanList', () => {
  it('trims, drops blanks and duplicates, ignores non-strings', () => {
    expect(cleanList([' a ', 'A', '', 3, 'b'])).toEqual(['a', 'b'])
    expect(cleanList('nope')).toEqual([])
  })
})

describe('loadPostFilter / savePostFilter', () => {
  const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
  it('is empty with no row, caches, and throws when the read fails', async () => {
    db.callPostFilter.findUnique.mockResolvedValue(null)
    expect(await loadPostFilter(1000)).toEqual(EMPTY_POST_FILTER)
    await loadPostFilter(1001)
    expect(db.callPostFilter.findUnique).toHaveBeenCalledTimes(1)
    clearPostFilterCache()
    db.callPostFilter.findUnique.mockRejectedValue(new Error('db down'))
    await expect(loadPostFilter()).rejects.toThrow('db down')
  })
  it('save upserts the cleaned lists with the editor and refreshes the cache', async () => {
    db.callPostFilter.upsert.mockResolvedValue({})
    const saved = await savePostFilter({ excludedCrewIds: [' crew_x ', 'crew_x'], blockedTerms: ['ZETA'] }, 'u1')
    expect(saved).toEqual({ excludedCrewIds: ['crew_x'], excludedCrewLabelTerms: [], blockedTerms: ['ZETA'] })
    expect(db.callPostFilter.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 }, update: expect.objectContaining({ updatedBy: 'u1' }) }))
    db.callPostFilter.findUnique.mockResolvedValue({ id: 1, ...saved })
    expect((await loadPostFilter()).blockedTerms).toEqual(['ZETA'])
  })
})
