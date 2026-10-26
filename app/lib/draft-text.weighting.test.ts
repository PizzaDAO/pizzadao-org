import { describe, it, expect } from 'vitest'
import { xLength, splitThread } from './draft-text'

describe('X weighting (twitter-text)', () => {
  it('counts CJK as 2 per character', () => {
    expect(xLength('日本語')).toBe(6)
  })
  it('counts scheme-less domains as 23', () => {
    expect(xLength('pizzadao.org')).toBe(23)
    expect(xLength('see pizzadao.org')).toBe(4 + 23)
  })
  it('leaves trailing punctuation out of the URL', () => {
    expect(xLength('go https://a.io/x?y=1, ok')).toBe(3 + 23 + 4)
    expect(xLength('see pizzadao.org.')).toBe(4 + 23 + 1)
  })
  it('never lets a thread part exceed 280 by X weighting', () => {
    const text = Array.from({ length: 40 }, (_, i) => `🍕 ピザ ${i} at pizzadao.org, join!`).join(' ')
    const parts = splitThread(text)
    expect(parts.length).toBeGreaterThan(1)
    parts.forEach((p) => expect(xLength(p)).toBeLessThanOrEqual(280))
  })
  it('keeps paragraph and line breaks inside parts', () => {
    const para = (c: string) => `${c.repeat(60)}\n${c.repeat(60)}`
    const text = [para('a'), para('b'), para('c')].join('\n\n')
    const parts = splitThread(text)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts[0]).toContain('\n\n')
    expect(parts[0]).toMatch(/a{60}\na{60}/)
    parts.forEach((p) => expect(xLength(p)).toBeLessThanOrEqual(280))
    const joined = parts.map((p) => p.replace(/ \d+\/\d+$/, '')).join('\n\n')
    expect(joined.replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''))
  })
})
