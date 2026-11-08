// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPLORERS, explorerTxUrl, explorersTextValid, parseExplorers } from './explorers'

const H = `0x${'ab'.repeat(32)}`

describe('explorerTxUrl', () => {
  it('builds a link for a known chain', () => {
    expect(explorerTxUrl('ethereum', H)).toBe(`https://etherscan.io/tx/${H}`)
    expect(explorerTxUrl('polygon', H)).toBe(`https://polygonscan.com/tx/${H}`)
  })
  it('returns null for an unknown or missing chain', () => {
    expect(explorerTxUrl('mystery', H)).toBeNull()
    expect(explorerTxUrl(null, H)).toBeNull()
    expect(explorerTxUrl('__proto__', H)).toBeNull()
    expect(explorerTxUrl('constructor', H, {})).toBeNull()
  })
  it('returns null for a malformed hash', () => {
    expect(explorerTxUrl('ethereum', '0x123')).toBeNull()
    expect(explorerTxUrl('ethereum', `${H}zz`)).toBeNull()
    expect(explorerTxUrl('ethereum', 'paypal-123')).toBeNull()
    expect(explorerTxUrl('ethereum', null)).toBeNull()
  })
  it('uses the configured map, and ignores an unsafe pattern', () => {
    expect(explorerTxUrl('ethereum', H, { ethereum: 'https://scan.example/t/{tx}' })).toBe(`https://scan.example/t/${H}`)
    expect(explorerTxUrl('ethereum', H, { ethereum: 'javascript:alert({tx})' })).toBeNull()
    expect(explorerTxUrl('ethereum', H, { ethereum: 'https://scan.example/' })).toBeNull()
  })
})

describe('the proposals.explorers setting text', () => {
  it('empty or broken text gives the defaults', () => {
    expect(parseExplorers('')).toEqual(DEFAULT_EXPLORERS)
    expect(parseExplorers('{nope')).toEqual(DEFAULT_EXPLORERS)
    expect(parseExplorers('[1]')).toEqual(DEFAULT_EXPLORERS)
  })
  it('adds and replaces chains, dropping bad entries', () => {
    const m = parseExplorers(JSON.stringify({ gnosis: 'https://gnosisscan.io/tx/{tx}', base: 'http://insecure/{tx}', 'Bad Key': 'https://x/{tx}' }))
    expect(m.gnosis).toBe('https://gnosisscan.io/tx/{tx}')
    expect(m.base).toBe(DEFAULT_EXPLORERS.base)
    expect(m['Bad Key']).toBeUndefined()
  })
  it('validates on write', () => {
    expect(explorersTextValid('')).toBe(true)
    expect(explorersTextValid('{"eth":"https://e.io/{tx}"}')).toBe(true)
    expect(explorersTextValid('{"eth":"https://e.io/"}')).toBe(false)
    expect(explorersTextValid('nope')).toBe(false)
  })
})

describe('the migration', () => {
  const sql = readFileSync(new URL('../../../prisma/migrations/20261115000000_proposals_history/migration.sql', import.meta.url), 'utf8')
  it('is additive, forbids imported open or draft rows, and never makes tx hashes globally unique', () => {
    expect(sql).toMatch(/CHECK \("source" = 'APP' OR "status" NOT IN \('DRAFT', 'OPEN'\)\)/)
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i)
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX[^;]*"txHash"/)
    expect(sql).toMatch(/"Proposal_importKey_key"/)
  })
})
