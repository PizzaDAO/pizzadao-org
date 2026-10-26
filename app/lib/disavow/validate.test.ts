// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseNomination, parseVote, isHttpsUrl } from './validate'

const good = {
  displayName: 'Rug Pull Randy',
  reason: 'SCAM',
  statement: 'Took 2 ETH on 2026-09-01 for a print job and never delivered anything.',
  evidenceUrls: ['https://example.com/proof'],
  identifiers: [{ kind: 'X_HANDLE', value: '@randy' }],
  attest: true,
}

describe('parseNomination', () => {
  it('accepts a good nomination and normalizes identifiers', () => {
    const r = parseNomination(good)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.identifiers).toEqual([{ kind: 'X_HANDLE', value: 'randy' }])
  })
  it('falls back to a NAME identifier when none are given', () => {
    const r = parseNomination({ ...good, identifiers: [] })
    expect(r.ok && r.value.identifiers).toEqual([{ kind: 'NAME', value: 'rug pull randy' }])
  })
  it('rejects non-https evidence, too many links, javascript: and credentials', () => {
    expect(parseNomination({ ...good, evidenceUrls: ['http://example.com'] }).ok).toBe(false)
    expect(parseNomination({ ...good, evidenceUrls: ['javascript:alert(1)'] }).ok).toBe(false)
    expect(parseNomination({ ...good, evidenceUrls: Array(6).fill('https://e.com/x') }).ok).toBe(false)
    expect(isHttpsUrl('https://user:pw@example.com')).toBe(false)
  })
  it('enforces length limits and the attestation', () => {
    expect(parseNomination({ ...good, statement: 'too short' }).ok).toBe(false)
    expect(parseNomination({ ...good, statement: 'x'.repeat(1501) }).ok).toBe(false)
    expect(parseNomination({ ...good, displayName: 'n'.repeat(121) }).ok).toBe(false)
    expect(parseNomination({ ...good, attest: false }).ok).toBe(false)
    expect(parseNomination({ ...good, reason: 'RUDE' }).ok).toBe(false)
  })
  it('rejects an unparseable identifier instead of dropping it', () => {
    expect(parseNomination({ ...good, identifiers: [{ kind: 'WALLET', value: 'nope' }] }).ok).toBe(false)
  })
})

describe('parseVote', () => {
  it('validates choice and comment length', () => {
    expect(parseVote({ roundId: 'r', choice: 'YES' }).ok).toBe(true)
    expect(parseVote({ roundId: 'r', choice: 'MAYBE' }).ok).toBe(false)
    expect(parseVote({ roundId: 'r', choice: 'NO', comment: 'x'.repeat(501) }).ok).toBe(false)
  })
})
