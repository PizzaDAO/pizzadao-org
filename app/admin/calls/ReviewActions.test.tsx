// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { formatActionItems, formatChapters, parseActionItems, parseChapters } from './ReviewActions'

describe('review form text formats', () => {
  it('round-trips action items with optional owners', () => {
    const items = [{ text: 'Send the deck', owner: 'Ann' }, { text: 'Book a room' }]
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
})
