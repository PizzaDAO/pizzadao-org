// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseNewProposal } from './validate'

const base = { kind: 'FUNDING', title: 'Pizza party', description: 'A party that brings new people to PizzaDAO.', amount: '$1,250.50' }

describe('parseNewProposal', () => {
  it('accepts a funding proposal and composes a plain-text body from the template fields', () => {
    const r = parseNewProposal({ ...base, eventDate: '2027-05-22', city: 'Lisbon', sponsor: 'A holder', attendance: '120', budget: 'Pizza $900' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).toMatchObject({ kind: 'FUNDING', title: 'Pizza party', amountUsdCents: 125050, city: 'Lisbon', sponsorLabel: 'A holder' })
    expect(r.data.eventDate?.toISOString()).toBe('2027-05-22T00:00:00.000Z')
    expect(r.data.body).toContain('Estimated attendance:\n120')
    expect(r.data.body).toContain('Budget breakdown:\nPizza $900')
  })

  it('a general proposal carries no amount', () => {
    const r = parseNewProposal({ ...base, kind: 'GENERAL', amount: '500' })
    expect(r.ok && r.data.amountUsdCents).toBeNull()
  })

  it('rejects bad input', () => {
    expect(parseNewProposal(null)).toEqual({ ok: false, error: 'invalid' })
    expect(parseNewProposal({ ...base, kind: 'X' })).toEqual({ ok: false, error: 'bad_kind' })
    expect(parseNewProposal({ ...base, title: 'ab' })).toEqual({ ok: false, error: 'bad_title' })
    expect(parseNewProposal({ ...base, description: 'short' })).toEqual({ ok: false, error: 'bad_description' })
    expect(parseNewProposal({ ...base, amount: '0' })).toEqual({ ok: false, error: 'bad_amount' })
    expect(parseNewProposal({ ...base, amount: 'lots' })).toEqual({ ok: false, error: 'bad_amount' })
    expect(parseNewProposal({ ...base, amount: 2_000_000 })).toEqual({ ok: false, error: 'bad_amount' })
    expect(parseNewProposal({ ...base, eventDate: '2027-02-30' })).toEqual({ ok: false, error: 'bad_date' })
  })
})
