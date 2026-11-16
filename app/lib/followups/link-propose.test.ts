// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BACKFILL_EARLIEST, parseSince, proposeLinks, sameOwnerName } from './link-propose'

const items = [
  { index: 0, text: 'Send the venue deck to the host', owner: 'Ann Anchovy' },
  { index: 1, text: 'Book the community room for March', owner: 'Bob Basil' },
  { index: 2, text: 'Draft the newsletter intro', owner: null },
]

describe('proposeLinks', () => {
  it('links by owner and wording when one item clearly wins', () => {
    const out = proposeLinks(items, [{ id: 'f1', ownerName: 'Ann', ask: 'Ask how the venue deck is going' }, { id: 'f2', ownerName: 'Bob Basil', ask: 'Check on booking the community room' }])
    expect(out.map((o) => [o.followUpId, o.itemIndex])).toEqual([['f1', 0], ['f2', 1]])
  })

  it('wording alone must be a clear match when the owner differs', () => {
    expect(proposeLinks(items, [{ id: 'f1', ownerName: 'Cy', ask: 'draft the newsletter intro' }]).map((o) => o.itemIndex)).toEqual([2])
    expect(proposeLinks(items, [{ id: 'f1', ownerName: 'Cy', ask: 'something about the venue' }])).toEqual([])
  })

  it('stays unlinked when two items tie or nothing matches', () => {
    const two = [{ index: 0, text: 'Send the deck', owner: 'Ann' }, { index: 1, text: 'Send the deck', owner: 'Ann' }]
    expect(proposeLinks(two, [{ id: 'f1', ownerName: 'Ann', ask: 'Send the deck' }])).toEqual([])
    expect(proposeLinks(items, [{ id: 'f1', ownerName: 'Zed', ask: 'unrelated words entirely' }])).toEqual([])
    expect(proposeLinks([], [{ id: 'f1', ownerName: 'Ann', ask: 'x' }])).toEqual([])
  })

  it('owner names match on equality, containment or the first name', () => {
    expect(sameOwnerName('Ann', 'Ann Anchovy')).toBe(true)
    expect(sameOwnerName('ann anchovy', 'Ann  Anchovy!')).toBe(true)
    expect(sameOwnerName('Ann Basil', 'Ann Anchovy')).toBe(true)
    expect(sameOwnerName('Al', 'Alex')).toBe(false)
    expect(sameOwnerName('Bo', 'Bob')).toBe(false)
    expect(sameOwnerName('', 'Ann')).toBe(false)
    expect(sameOwnerName(null, undefined)).toBe(false)
  })
})

describe('backfill --since', () => {
  it('defaults to the earliest allowed date and refuses anything before it or malformed', () => {
    expect(parseSince(undefined)?.toISOString().slice(0, 10)).toBe(BACKFILL_EARLIEST)
    expect(parseSince('2026-11-15')?.toISOString().slice(0, 10)).toBe('2026-11-15')
    expect(parseSince('2026-10-31')).toBeNull()
    expect(parseSince('2026-1-5')).toBeNull()
    expect(parseSince('soon')).toBeNull()
    expect(parseSince('2026-13-45')).toBeNull()
  })
})
