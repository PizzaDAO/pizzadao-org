// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { cleanTaskText, normalizeForDedupe, parseDue, parsePriority } from '../task-add'

describe('cleanTaskText', () => {
  it('collapses whitespace and newlines and trims', () => {
    expect(cleanTaskText('  Print \n\n the\tflyers  ')).toEqual({ ok: true, label: 'Print the flyers' })
  })

  it('strips bidi isolates and zero-width spaces before collapsing whitespace', () => {
    expect(cleanTaskText('\u2066Print\u2069 \u200b the flyers')).toEqual({ ok: true, label: 'Print the flyers' })
  })

  it('strips control and zero-width characters', () => {
    expect(cleanTaskText('Pri​nt\u0007 fly⁠ers')).toEqual({ ok: true, label: 'Print flyers' })
  })

  it('refuses under 3 and over 300 code points, counting an emoji once', () => {
    expect(cleanTaskText('ab').ok).toBe(false)
    expect(cleanTaskText('a​b').ok).toBe(false)
    expect(cleanTaskText('ab🍕').ok).toBe(true)
    expect(cleanTaskText('🍕'.repeat(299) + 'a').ok).toBe(true)
    expect(cleanTaskText('🍕'.repeat(300) + 'a').ok).toBe(false)
    expect(cleanTaskText('a'.repeat(301)).ok).toBe(false)
  })

  it('needs a letter or digit', () => {
    expect(cleanTaskText('!!! ???').ok).toBe(false)
    expect(cleanTaskText('🍕🍕🍕').ok).toBe(false)
    expect(cleanTaskText('--- 4').ok).toBe(true)
  })

  it('refuses a non-string', () => {
    expect(cleanTaskText(undefined).ok).toBe(false)
    expect(cleanTaskText(12345).ok).toBe(false)
  })

  it('keeps raw text (markdown is escaped when shown)', () => {
    expect(cleanTaskText('*bold* @everyone')).toEqual({ ok: true, label: '*bold* @everyone' })
  })
})

describe('parsePriority', () => {
  it('accepts the four values and empty', () => {
    for (const p of ['Top', 'High', 'Mid', 'Low']) expect(parsePriority(p)).toEqual({ ok: true, priority: p })
    for (const empty of [undefined, null, '']) expect(parsePriority(empty)).toEqual({ ok: true, priority: null })
  })

  it('refuses anything else', () => {
    for (const bad of ['top', 'Urgent', 1, {}]) expect(parsePriority(bad).ok).toBe(false)
  })
})

describe('parseDue', () => {
  // Tuesday 2026-11-17, midday in New York.
  const now = new Date('2026-11-17T17:00:00Z')
  const due = (raw: unknown, at = now, zone?: string) => {
    const r = parseDue(raw, at, zone)
    return r.ok ? r.due : r.error
  }

  it('empty gives null', () => {
    expect(due(undefined)).toBeNull()
    expect(due('')).toBeNull()
    expect(due('   ')).toBeNull()
  })

  it('accepts every form', () => {
    expect(due('2026-12-05')).toBe('2026-12-05')
    expect(due('2026-12-5')).toBe('2026-12-05')
    expect(due('12/5')).toBe('2026-12-05')
    expect(due('12/5/2027')).toBe('2027-12-05')
    expect(due('Dec 5')).toBe('2026-12-05')
    expect(due('december 5')).toBe('2026-12-05')
    expect(due('Dec 5th, 2027')).toBe('2027-12-05')
    expect(due('Dec. 5 2027')).toBe('2027-12-05')
    expect(due('today')).toBe('2026-11-17')
    expect(due('Tomorrow')).toBe('2026-11-18')
  })

  it('rolls a missing year to next year once the date has passed', () => {
    const dec = new Date('2026-12-20T17:00:00Z')
    expect(due('Jan 3', dec)).toBe('2027-01-03')
    expect(due('1/3', dec)).toBe('2027-01-03')
    expect(due('Dec 20', dec)).toBe('2026-12-20')
    expect(due('Dec 19', dec)).toBe('2027-12-19')
  })

  it('tomorrow crosses a year end', () => {
    expect(due('tomorrow', new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01')
  })

  it('accepts today, refuses yesterday and past years', () => {
    expect(due('2026-11-17')).toBe('2026-11-17')
    expect(due('2026-11-16')).toMatch(/has passed/)
    expect(due('12/5/2025')).toMatch(/has passed/)
  })

  it('refuses dates that do not exist', () => {
    expect(due('Feb 30')).toMatch(/could not read/)
    expect(due('2026-02-29')).toMatch(/could not read/)
    expect(due('13/1')).toMatch(/could not read/)
    expect(due('2026-00-10')).toMatch(/could not read/)
  })

  it('a Feb 29 with no year lands on the next leap day', () => {
    expect(due('Feb 29')).toBe('2028-02-29')
  })

  it('refuses more than 2 years ahead and allows exactly 2', () => {
    expect(due('2028-11-17')).toBe('2028-11-17')
    expect(due('2028-11-18')).toMatch(/years away/)
    expect(due('2031-01-01')).toMatch(/years away/)
  })

  it('refuses garbage and non-strings', () => {
    for (const bad of ['soon', 'next friday', '5', 'Dec', 'Smarch 5', '2026/12/05', 7]) expect(due(bad)).toMatch(/could not read|Use a due date/)
  })

  it('today is the date in the zone: the midnight edge in New York vs UTC', () => {
    // 2026-11-18 03:00 UTC is still the 17th (22:00) in New York.
    const late = new Date('2026-11-18T03:00:00Z')
    expect(due('today', late)).toBe('2026-11-17')
    expect(due('2026-11-17', late)).toBe('2026-11-17')
    expect(due('today', late, 'UTC')).toBe('2026-11-18')
    expect(due('2026-11-17', late, 'UTC')).toMatch(/has passed/)
  })
})

describe('normalizeForDedupe', () => {
  it('matches case, spacing and edge punctuation', () => {
    expect(normalizeForDedupe('  Print  the Flyers! ')).toBe(normalizeForDedupe('print the flyers'))
  })
})
