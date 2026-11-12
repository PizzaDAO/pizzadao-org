// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { stripEvidence as unticked, formatActionItems, formatChapters, invalidChapterLines, parseActionItems, parseChapters } from './ReviewActions'

describe('review form text formats', () => {
  it('round-trips action items with optional owners', () => {
    const items = [{ text: 'Send the deck', owner: 'Ann' }, { text: 'Book a room' }]
    expect(parseActionItems(formatActionItems(items))).toEqual(items)
  })

  it('round-trips suggestedBy, with and without an owner', () => {
    const items = [{ text: 'A', owner: 'Ann', suggestedBy: 'Bob' }, { text: 'B', suggestedBy: 'Cy' }, { text: 'C', owner: 'Dee' }]
    expect(formatActionItems(items)).toBe('A | Ann | by: Bob\nB | by: Cy\nC | Dee')
    expect(parseActionItems(formatActionItems(items))).toEqual(items)
  })

  it('round-trips the done marker', () => {
    const items = [{ text: 'A', owner: 'Ann', suggestedBy: 'Bob', done: true }, { text: 'B' }, { text: 'C', done: true }]
    expect(formatActionItems(items)).toBe('[x] A | Ann | by: Bob\nB\n[x] C')
    expect(parseActionItems(formatActionItems(items))).toEqual(items)
  })

  it('round-trips evidence links, with and without the other fields', () => {
    const e = [{ url: 'https://github.com/o/r/pull/5' }, { url: 'https://example.org/doc?a=1&b=2' }]
    const items = [{ text: 'A', owner: 'Ann', suggestedBy: 'Bob', done: true, evidence: e }, { text: 'B', done: true, evidence: [e[0]] }, { text: 'C', evidence: e }, { text: 'D', owner: 'Dee', done: true }]
    expect(formatActionItems(items)).toBe('[x] A | Ann | by: Bob | ev: https://github.com/o/r/pull/5 https://example.org/doc?a=1&b=2\n[x] B | ev: https://github.com/o/r/pull/5\nC | ev: https://github.com/o/r/pull/5 https://example.org/doc?a=1&b=2\n[x] D | Dee')
    expect(parseActionItems(formatActionItems(items))).toEqual(items)
  })

  it('does not read look-alike text as evidence, and escapes text that ends like it', () => {
    const items = [{ text: 'Check | ev: soon', owner: 'Ann' }, { text: 'Look', owner: 'ev: https://example.org/x' }, { text: 'Fix', done: true, owner: 'ev: https://example.org/x' }]
    expect(parseActionItems(formatActionItems(items))).toEqual(items)
    expect(parseActionItems('A | ev: javascript:alert(1)')[0].evidence).toBeUndefined()
    expect(parseActionItems('A | ev: https://example.org/a x')[0].evidence).toBeUndefined()
  })

  it('keeps commas inside URLs and drops the evidence when an item is unticked', () => {
    const maps = 'https://www.google.com/maps/@40.7,-74.0,15z'
    const items = [{ text: 'Scout', done: true, evidence: [{ url: maps }, { url: 'https://e.org/a' }] }]
    expect(parseActionItems(formatActionItems(items))).toEqual(items)
    expect(unticked('Scout | Ann | ev: https://e.org/a')).toBe('Scout | Ann')
    expect(unticked('Scout')).toBe('Scout')
  })

  it('caps evidence at three and drops duplicates', () => {
    const line = '[x] A | ev: https://e.org/1 https://e.org/1 https://e.org/2 https://e.org/3 https://e.org/4'
    expect(parseActionItems(line)[0].evidence).toEqual([{ url: 'https://e.org/1' }, { url: 'https://e.org/2' }, { url: 'https://e.org/3' }])
  })

  it('does not turn an open item whose text starts like a marker into a done one', () => {
    const items = [{ text: '[x] literal' }, { text: '[ ] box' }, { text: '\\[x] already', owner: 'Ann' }, { text: '[x] real', done: true }, { text: '[x] odd', done: true, suggestedBy: 'Bob' }]
    expect(parseActionItems(formatActionItems(items))).toEqual(items)
    expect(parseActionItems(formatActionItems([{ text: '[x] literal' }]))[0].done).toBeUndefined()
  })

  it('keeps a "| by:" inside the text when more segments follow it', () => {
    const items = [{ text: 'Vote | by: Friday', owner: 'Ann' }, { text: 'Vote | by: Friday', owner: 'Ann', suggestedBy: 'Bob' }]
    expect(parseActionItems(formatActionItems(items))).toEqual(items)
  })

  it('drops blank lines in action items', () => {
    expect(parseActionItems('\n  one \n\n two | Bob \n')).toEqual([{ text: 'one' }, { text: 'two', owner: 'Bob' }])
  })

  it('round-trips chapters including hour marks', () => {
    const chapters = [{ startMs: 65_000, title: 'Intro' }, { startMs: 3_725_000, title: 'Wrap up' }]
    expect(formatChapters(chapters)).toBe('01:05 Intro\n1:02:05 Wrap up')
    expect(parseChapters(formatChapters(chapters))).toEqual(chapters)
  })

  it('ignores chapter lines without a time', () => {
    expect(parseChapters('no time here\n12:30 Budget')).toEqual([{ startMs: 750_000, title: 'Budget' }])
  })

  it('splits an action item on the LAST " | " only', () => {
    expect(parseActionItems('Review a | b plan | Ann')).toEqual([{ text: 'Review a | b plan', owner: 'Ann' }])
    expect(parseActionItems('Use the a|b notation')).toEqual([{ text: 'Use the a|b notation' }])
    const items = [{ text: 'x | y', owner: 'Ann' }]
    expect(parseActionItems(formatActionItems(items))).toEqual(items)
  })

  it('flags chapter lines without a valid time', () => {
    expect(invalidChapterLines('12:30 ok\nno time\n\n5 also bad')).toEqual(['no time', '5 also bad'])
  })
})
