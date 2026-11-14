import { describe, expect, it } from 'vitest'
import { buildIcs, icsEscape, icsFold } from './ics'

const base = {
  id: 'abc12345',
  title: 'Dough, Heat; Time',
  presenter: 'A. Baker',
  description: 'Line one\nLine two',
  startsAt: new Date('2026-11-20T23:30:00Z'),
  endsAt: new Date('2026-11-21T00:30:00Z'),
  url: 'https://discord.com/events/1/2',
}

describe('buildIcs', () => {
  const ics = buildIcs(base, { host: 'pizzadao.org', now: new Date('2026-11-11T00:00:00Z') })
  it('is a CRLF VCALENDAR with one VEVENT in UTC', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true)
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(ics).toContain('UID:session-abc12345@pizzadao.org\r\n')
    expect(ics).toContain('DTSTAMP:20261111T000000Z\r\n')
    expect(ics).toContain('DTSTART:20261120T233000Z\r\n')
    expect(ics).toContain('DTEND:20261121T003000Z\r\n')
    expect(ics).toContain('URL:https://discord.com/events/1/2\r\n')
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
  })
  it('escapes commas, semicolons and newlines', () => {
    expect(ics).toContain('SUMMARY:Dough\\, Heat\\; Time\r\n')
    expect(ics).toContain('Presented by A. Baker\\n\\nLine one\\nLine two')
  })
  it('leaves out URL when there is none', () => {
    expect(buildIcs({ ...base, url: null })).not.toContain('\r\nURL:')
  })
})

describe('control characters and bare CR', () => {
  it('turns CRLF, CR and LF into \\n and drops other control chars', () => {
    expect(icsEscape('a\r\nb\rc\nd')).toBe('a\\nb\\nc\\nd')
    expect(icsEscape('x\u0000y\u0007z\u001Fw\u007F')).toBe('xyzw')
  })
  it('cannot inject a property through any text field', () => {
    const evil = 'Hi\r\nBEGIN:VEVENT\rATTENDEE:x\u0000'
    const ics = buildIcs({ ...base, id: 'a\r\nb', title: evil, presenter: evil, description: evil, url: 'https://x.test/\r\nATTENDEE:y' }, { host: 'h\nost' })
    const lines = ics.split('\r\n')
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1)
    expect(lines.some((l) => l.startsWith('ATTENDEE'))).toBe(false)
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n\u0000]/)
  })
})

describe('icsEscape / icsFold', () => {
  it('escapes backslashes first', () => {
    expect(icsEscape('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne')
  })
  it('folds at 75 octets, counting multi-byte characters, and unfolds back to the original', () => {
    const long = 'DESCRIPTION:' + 'é'.repeat(80)
    const folded = icsFold(long)
    const lines = folded.split('\r\n')
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
    expect(lines.slice(1).every((l) => l.startsWith(' '))).toBe(true)
    expect(folded.replace(/\r\n /g, '')).toBe(long)
  })
  it('leaves short lines alone', () => {
    expect(icsFold('SUMMARY:Hi')).toBe('SUMMARY:Hi')
  })
})
