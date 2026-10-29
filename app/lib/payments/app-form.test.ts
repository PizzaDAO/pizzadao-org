// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseNewRequest } from './app-form'

const ENV = { PAYMENTS_HASH_SECRET: 'test-secret-value' } as unknown as NodeJS.ProcessEnv
const WALLET = '0x1234567890abcdef1234567890abcdef12345678'
const good = (over: Record<string, unknown> = {}) => ({
  kind: 'EVENT_BUDGET', title: 'Community meetup', description: 'Room hire and snacks for a local meetup.', amount: '$250.50',
  eventDate: '2026-11-20', eventCity: 'Springfield', proposalUrl: '', payee: WALLET, ...over,
})

describe('parseNewRequest', () => {
  it('accepts a valid request and converts the amount to cents', () => {
    const r = parseNewRequest(good(), ENV)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).toMatchObject({ source: 'APP', sourceRef: null, kind: 'EVENT_BUDGET', amountUsdCents: 25050, currency: 'USD', eventCity: 'Springfield' })
    expect(r.data.eventDate?.toISOString()).toBe('2026-11-20T00:00:00.000Z')
  })

  it('stores only a hash and a mask for the payee', () => {
    const r = parseNewRequest(good(), ENV)
    if (!r.ok) throw new Error('expected ok')
    expect(JSON.stringify(r.data)).not.toContain(WALLET)
    expect(r.data.payeeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.data.payeeHint).toBe('0x12...78')
    const noSecret = parseNewRequest(good(), {} as never)
    if (!noSecret.ok) throw new Error('expected ok')
    expect(noSecret.data.payeeHash).toBeNull()
  })

  it('rejects bad input with a specific code', () => {
    const code = (o: Record<string, unknown>) => {
      const r = parseNewRequest(good(o), ENV)
      return r.ok ? 'ok' : r.error
    }
    expect(code({ kind: 'GIFT' })).toBe('bad_kind')
    expect(code({ title: 'a' })).toBe('bad_title')
    expect(code({ description: 'short' })).toBe('bad_description')
    expect(code({ amount: '0' })).toBe('bad_amount')
    expect(code({ amount: 'lots' })).toBe('bad_amount')
    expect(code({ amount: 2_000_000 })).toBe('bad_amount')
    expect(code({ eventDate: '20/11/2026' })).toBe('bad_date')
    expect(code({ proposalUrl: 'http://example.com/x' })).toBe('bad_link')
    expect(code({ proposalUrl: 'javascript:alert(1)' })).toBe('bad_link')
    expect(parseNewRequest(null, ENV)).toEqual({ ok: false, error: 'invalid' })
    expect(parseNewRequest([], ENV)).toEqual({ ok: false, error: 'invalid' })
  })

  it('points party-platform links to that platform instead', () => {
    expect(parseNewRequest(good({ description: 'See https://rsv.pizza/e/abc for the event' }), ENV)).toEqual({ ok: false, error: 'party_event' })
    expect(parseNewRequest(good({ proposalUrl: 'https://www.rsv.pizza/x' }), ENV)).toEqual({ ok: false, error: 'party_event' })
  })

  it('strips control characters', () => {
    const r = parseNewRequest(good({ title: 'Meet\u0000up\u0007 title' }), ENV)
    if (!r.ok) throw new Error('expected ok')
    expect(r.data.title).toBe('Meetup title')
  })
})
