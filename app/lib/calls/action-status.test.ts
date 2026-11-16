// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { FollowUpStatus } from '@prisma/client'
import { deriveActionViews } from './action-status'
import { EMPTY_POST_FILTER, type PostFilter } from './post-filters'

const fu = (actionKey: string | null, status: FollowUpStatus, doneUrl: string | null = null) => ({ actionKey, status, doneUrl })
const item = (key: string, extra: Record<string, unknown> = {}) => ({ text: `Item ${key}`, key, ...extra })
const on = { memberLinks: true }

describe('deriveActionViews precedence', () => {
  it('nothing linked, nothing marked: no state', () => {
    expect(deriveActionViews([item('a')], [], on)).toEqual([{ key: 'a', state: null, links: [] }])
  })

  it('an admin done always wins, even over a member still working', () => {
    expect(deriveActionViews([item('a', { done: true })], [fu('a', 'IN_PROGRESS')], on)[0].state).toBe('done')
  })

  it('in progress and needs help both show as in progress (help is not announced)', () => {
    expect(deriveActionViews([item('a')], [fu('a', 'IN_PROGRESS')], on)[0].state).toBe('in_progress')
    expect(deriveActionViews([item('a')], [fu('a', 'NEEDS_HELP')], on)[0].state).toBe('in_progress')
  })

  it('a done follow-up marks the item done', () => {
    expect(deriveActionViews([item('a')], [fu('a', 'DONE')], on)[0].state).toBe('done')
  })

  it('two owners, one done and one still working: the item is not finished', () => {
    const v = deriveActionViews([item('a')], [fu('a', 'DONE', 'https://example.org/x'), fu('a', 'IN_PROGRESS')], on)[0]
    expect(v.state).toBe('in_progress')
    expect(v.links).toEqual([])
  })

  it('other statuses contribute nothing', () => {
    for (const s of ['DRAFT', 'APPROVED', 'SENT', 'REPLIED', 'FAILED', 'UNREACHABLE', 'ESCALATED', 'DISMISSED'] as const) {
      expect(deriveActionViews([item('a')], [fu('a', s)], on)[0].state, s).toBe(null)
    }
  })

  it('a follow-up whose key matches no item is ignored, and an unlinked follow-up too', () => {
    expect(deriveActionViews([item('a')], [fu('gone', 'DONE'), fu(null, 'DONE')], on)[0].state).toBe(null)
  })

  it('items without a key, and junk entries, keep their place in the list', () => {
    const v = deriveActionViews([{ text: 'x', done: true }, null, item('b')], [], on)
    expect(v.map((x) => x.state)).toEqual(['done', null, null])
    expect(v[0].key).toBeUndefined()
  })

  it('not a list: nothing', () => {
    expect(deriveActionViews(null, [], on)).toEqual([])
  })
})

describe('deriveActionViews links', () => {
  const ev = [{ url: 'https://github.com/o/r/pull/5' }]

  it('admin evidence first, then members links, only on done items', () => {
    const v = deriveActionViews([item('a', { done: true, evidence: ev })], [fu('a', 'DONE', 'https://example.org/doc')], on)[0]
    expect(v.links.map((l) => l.url)).toEqual(['https://github.com/o/r/pull/5', 'https://example.org/doc'])
    expect(v.links[0].label).toBe('PR #5')
    // Evidence on an item that is not done is not shown (as before).
    expect(deriveActionViews([item('a', { evidence: ev })], [], on)[0].links).toEqual([])
  })

  it('member links can be switched off, the item stays done', () => {
    const v = deriveActionViews([item('a')], [fu('a', 'DONE', 'https://example.org/doc')], { memberLinks: false })[0]
    expect(v.state).toBe('done')
    expect(v.links).toEqual([])
  })

  it('dedupes and keeps at most three', () => {
    const many = [{ url: 'https://example.org/1' }, { url: 'https://example.org/2' }, { url: 'https://example.org/3' }]
    const v = deriveActionViews([item('a', { done: true, evidence: many })], [fu('a', 'DONE', 'https://example.org/1'), fu('a', 'DONE', 'https://example.org/4')], on)[0]
    expect(v.links.map((l) => l.url)).toEqual(['https://example.org/1', 'https://example.org/2', 'https://example.org/3'])
  })

  it('an unsafe member link is dropped, not the item', () => {
    const v = deriveActionViews([item('a')], [fu('a', 'DONE', 'javascript:alert(1)')], on)[0]
    expect(v.state).toBe('done')
    expect(v.links).toEqual([])
  })

  it('a link the post filter blocks is dropped, not the item', () => {
    const filter: PostFilter = { ...EMPTY_POST_FILTER, blockedTerms: ['secretproject'] }
    const v = deriveActionViews([item('a')], [fu('a', 'DONE', 'https://example.org/secretproject/doc'), fu('a', 'DONE', 'https://example.org/ok')], { memberLinks: true, filter })[0]
    expect(v.state).toBe('done')
    expect(v.links.map((l) => l.url)).toEqual(['https://example.org/ok'])
  })
})
