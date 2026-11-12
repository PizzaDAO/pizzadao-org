// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { evidenceLabel, parseEvidenceInput, parseEvidenceStrict, readEvidence, safeEvidenceUrl } from './evidence'

const fail = (m: string): never => {
  throw new Error(m)
}

describe('evidenceLabel', () => {
  it('names GitHub PRs and issues, else the hostname', () => {
    expect(evidenceLabel('https://github.com/o/r/pull/308')).toBe('PR #308')
    expect(evidenceLabel('https://github.com/o/r/pull/308/files')).toBe('PR #308')
    expect(evidenceLabel('https://github.com/o/r/issues/12')).toBe('#12')
    expect(evidenceLabel('https://github.com/o/r')).toBe('github.com')
    expect(evidenceLabel('https://www.example.org/a/b')).toBe('example.org')
  })
})

describe('safeEvidenceUrl', () => {
  it('accepts http(s) only', () => {
    expect(safeEvidenceUrl('https://example.org/a')).toBe('https://example.org/a')
    expect(safeEvidenceUrl('http://example.org')).toBe('http://example.org/')
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.org', 'example.org', 'https://', 'https://a.org/x y', 'https://a.org/<b>', 'https://a.org/(x)', 5, null]) {
      expect(safeEvidenceUrl(bad)).toBeNull()
    }
  })
})

describe('parseEvidenceStrict', () => {
  it('accepts up to three valid entries and ignores any label', () => {
    expect(parseEvidenceStrict([{ url: 'https://e.org/a', label: 'https://evil.example' }], 'x', fail)).toEqual([{ url: 'https://e.org/a' }])
    expect(parseEvidenceStrict(undefined, 'x', fail)).toEqual([])
  })
  it('rejects non-http, too many and non-arrays', () => {
    expect(() => parseEvidenceStrict([{ url: 'javascript:alert(1)' }], 'x', fail)).toThrow()
    expect(() => parseEvidenceStrict([1, 2, 3, 4].map((n) => ({ url: `https://e.org/${n}` })), 'x', fail)).toThrow()
    expect(() => parseEvidenceStrict('https://e.org', 'x', fail)).toThrow()
  })
})

describe('readEvidence', () => {
  it('derives labels, drops bad entries and caps at three', () => {
    const out = readEvidence([{ url: 'https://github.com/o/r/pull/1' }, { url: 'javascript:x' }, { url: 'https://e.org/a', label: 'Mine' }, { url: 'https://e.org/b' }, { url: 'https://e.org/c' }])
    expect(out).toEqual([{ url: 'https://github.com/o/r/pull/1', label: 'PR #1' }, { url: 'https://e.org/a', label: 'e.org' }, { url: 'https://e.org/b', label: 'e.org' }])
    expect(readEvidence(null)).toEqual([])
  })
})

describe('parseEvidenceInput', () => {
  it('splits on spaces and commas and ignores junk', () => {
    expect(parseEvidenceInput('https://e.org/a, https://e.org/b  nope javascript:x')).toEqual([{ url: 'https://e.org/a' }, { url: 'https://e.org/b' }])
    const maps = 'https://www.google.com/maps/@40.7,-74.0,15z'
    expect(parseEvidenceInput(maps, false)).toEqual([{ url: maps }])
  })
})
