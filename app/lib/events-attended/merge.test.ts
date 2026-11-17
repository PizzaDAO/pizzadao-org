import { describe, it, expect } from 'vitest'
import { mergeEvents, MAX_ROWS, rsvSlug } from './merge'

const att = (id: string, over: Partial<Parameters<typeof mergeEvents>[0]['attended'][number]> = {}) => ({
  id,
  name: `Party ${id}`,
  date: new Date('2026-05-22T00:00:00Z'),
  city: 'Brooklyn',
  url: `https://rsv.pizza/${id}`,
  guestListHidden: false,
  ...over,
})
const none = { attended: [], tickets: [], organizer: [] }
const opts = { countTickets: true, viewerIsOwner: false }

describe('mergeEvents', () => {
  it('collapses Organizer and Attended for the same rsv.pizza slug into one Organizer row', () => {
    const r = mergeEvents({ ...none, attended: [att('nyc')], organizer: [{ id: '1', slug: 'NYC', name: 'x', date: null, city: null, url: 'https://rsv.pizza/nyc' }] }, opts)
    expect(r.events).toHaveLength(1)
    expect(r.events[0].badge).toBe('organizer')
  })

  it('keeps an organizer-only row', () => {
    const r = mergeEvents({ ...none, organizer: [{ id: '1', slug: 'rome', name: 'Bitcoin Pizza Day Rome', date: null, city: 'Rome', url: 'https://rsv.pizza/rome' }] }, opts)
    expect(r.events.map((e) => e.badge)).toEqual(['organizer'])
  })

  it('collapses a same-year ticket into the Attended row when the city appears in the ticket name', () => {
    const r = mergeEvents({ ...none, attended: [att('bk')], tickets: [{ id: 't', name: 'Pizza Party Brooklyn 2026', year: 2026, url: null }] }, opts)
    expect(r.events).toHaveLength(1)
    expect(r.events[0].badge).toBe('attended')
  })

  it('does not collapse a ticket from another year', () => {
    const r = mergeEvents({ ...none, attended: [att('bk')], tickets: [{ id: 't', name: 'Pizza Party Brooklyn 2025', year: 2025, url: null }] }, opts)
    expect(r.events.map((e) => e.badge).sort()).toEqual(['attended', 'ticket'])
  })

  it('drops tickets when countTickets is off', () => {
    const r = mergeEvents({ ...none, tickets: [{ id: 't', name: 'X', year: 2024, url: null }] }, { ...opts, countTickets: false })
    expect(r.events).toEqual([])
  })

  it('shows hidden-guest-list parties to the owner only', () => {
    const input = { ...none, attended: [att('a', { guestListHidden: true }), att('b')] }
    expect(mergeEvents(input, opts).events.map((e) => e.id)).toEqual(['rsv:b'])
    expect(mergeEvents(input, { ...opts, viewerIsOwner: true }).events).toHaveLength(2)
  })

  it('drops a ticket that matches a hidden-guest-list party for other viewers, but keeps it merged for the owner', () => {
    const input = { ...none, attended: [att('bk', { guestListHidden: true })], tickets: [{ id: 't', name: 'Pizza Party Brooklyn 2026', year: 2026, url: null }] }
    expect(mergeEvents(input, opts).events).toEqual([])
    const owner = mergeEvents(input, { ...opts, viewerIsOwner: true })
    expect(owner.events.map((e) => e.badge)).toEqual(['attended'])
  })

  it('sorts newest first with unknown dates last, and caps with a total', () => {
    const r = mergeEvents(
      { ...none, attended: [att('old', { date: new Date('2024-01-01Z') }), att('new', { date: new Date('2026-01-01Z') }), att('undated', { date: null })], tickets: [{ id: 't', name: 'T', year: 2025, url: null }] },
      opts,
    )
    expect(r.events.map((e) => e.id)).toEqual(['rsv:new', 'tix:t', 'rsv:old', 'rsv:undated'])
    const many = mergeEvents({ ...none, attended: Array.from({ length: MAX_ROWS + 5 }, (_, i) => att(`e${i}`)) }, opts)
    expect(many.events).toHaveLength(MAX_ROWS)
    expect(many.total).toBe(MAX_ROWS + 5)
  })
})

describe('rsvSlug', () => {
  it('reads rsv.pizza slugs only', () => {
    expect(rsvSlug('https://rsv.pizza/Rome')).toBe('rome')
    expect(rsvSlug('https://example.com/rome')).toBeNull()
    expect(rsvSlug(null)).toBeNull()
  })
})
