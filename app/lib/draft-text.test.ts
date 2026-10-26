import { describe, it, expect } from 'vitest'
import {
  xLength, xRemaining, xIntentUrl, linkedinShareUrl, splitThread,
  canTransition, isLeadOnlyTransition, X_LIMIT,
} from './draft-text'

describe('xLength', () => {
  it('counts plain text by characters', () => {
    expect(xLength('hello')).toBe(5)
  })
  it('counts every URL as 23 characters regardless of length', () => {
    expect(xLength('https://example.com/a/very/long/path?with=query&and=more')).toBe(23)
    expect(xLength('hi https://t.co/x')).toBe(3 + 23)
    expect(xLength('a http://a.io b https://b.io/long/path')).toBe(2 + 23 + 3 + 23)
  })
  it('counts emoji and CJK as two, like X', () => {
    expect(xLength('🍕🍕')).toBe(4)
  })
  it('reports remaining against 280', () => {
    expect(xRemaining('x'.repeat(280))).toBe(0)
    expect(xRemaining('x'.repeat(281))).toBe(-1)
    expect(X_LIMIT).toBe(280)
  })
})

describe('intent urls', () => {
  it('url-encodes the text for X', () => {
    expect(xIntentUrl('Hi & bye #pizza\nhttps://a.io?x=1')).toBe(
      'https://x.com/intent/post?text=' + encodeURIComponent('Hi & bye #pizza\nhttps://a.io?x=1'),
    )
    expect(xIntentUrl('a b&c')).toBe('https://x.com/intent/post?text=a%20b%26c')
  })
  it('builds a LinkedIn share url with encoded text', () => {
    const u = linkedinShareUrl('a b&c')
    expect(u.startsWith('https://www.linkedin.com/')).toBe(true)
    expect(u.endsWith('text=a%20b%26c')).toBe(true)
  })
})

describe('splitThread', () => {
  it('returns short text as a single un-numbered part', () => {
    expect(splitThread('short')).toEqual(['short'])
    expect(splitThread('   ')).toEqual([])
  })
  it('splits long text into numbered parts that each fit', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} about pizza.`).join(' ')
    const parts = splitThread(text)
    expect(parts.length).toBeGreaterThan(1)
    parts.forEach((p, i) => {
      expect(xLength(p)).toBeLessThanOrEqual(280)
      expect(p.endsWith(` ${i + 1}/${parts.length}`)).toBe(true)
    })
    const joined = parts.map((p) => p.replace(/ \d+\/\d+$/, '')).join(' ')
    expect(joined.replace(/\s+/g, ' ')).toBe(text)
  })
  it('prefers paragraph boundaries', () => {
    const p1 = 'a'.repeat(150)
    const p2 = 'b'.repeat(150)
    expect(splitThread(`${p1}\n\n${p2}`)).toEqual([`${p1} 1/2`, `${p2} 2/2`])
  })
  it('hard-cuts a single over-long token', () => {
    const parts = splitThread('z'.repeat(700))
    expect(parts.length).toBeGreaterThanOrEqual(3)
    parts.forEach((p) => expect(xLength(p)).toBeLessThanOrEqual(280))
  })
  it('counts URLs as 23 when splitting', () => {
    const url = 'https://example.com/' + 'p'.repeat(200)
    const text = `${'w '.repeat(120)}${url} ${'v '.repeat(20)}`
    splitThread(text).forEach((p) => expect(xLength(p)).toBeLessThanOrEqual(280))
  })
})

describe('status transitions', () => {
  it('allows the forward path and archive', () => {
    expect(canTransition('draft', 'ready')).toBe(true)
    expect(canTransition('ready', 'posted')).toBe(true)
    expect(canTransition('posted', 'archived')).toBe(true)
    expect(canTransition('draft', 'archived')).toBe(true)
  })
  it('rejects skipping or reversing', () => {
    expect(canTransition('draft', 'posted')).toBe(false)
    expect(canTransition('posted', 'draft')).toBe(false)
    expect(canTransition('posted', 'ready')).toBe(false)
    expect(canTransition('archived', 'posted')).toBe(false)
  })
  it('archived can only be restored to draft', () => {
    expect(canTransition('archived', 'draft')).toBe(true)
    expect(canTransition('archived', 'ready')).toBe(false)
  })
  it('flags lead-only transitions', () => {
    expect(isLeadOnlyTransition('ready', 'posted')).toBe(true)
    expect(isLeadOnlyTransition('draft', 'archived')).toBe(true)
    expect(isLeadOnlyTransition('archived', 'draft')).toBe(true)
    expect(isLeadOnlyTransition('draft', 'ready')).toBe(false)
    expect(isLeadOnlyTransition('ready', 'draft')).toBe(false)
  })
})
