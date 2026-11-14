import { describe, expect, it } from 'vitest'
import { buildAnnouncement, buildCancelledAnnouncement, buildEventPatch, buildUpdateNote, dedupeKey, buildEventPayload, parseSessionExtras, parseSessionInput, SessionInputError, wallParts } from './build'

const NOW = new Date('2026-11-11T12:00:00Z')
const base = { title: 'Intro to Dough', presenter: 'A. Baker', description: 'How dough works.', date: '2026-11-20', time: '18:30', timeZone: 'America/New_York', lengthMinutes: 60 }

describe('parseSessionInput', () => {
  it('turns zone wall time into UTC (EST in November)', () => {
    const s = parseSessionInput(base, NOW)
    expect(s.startsAt.toISOString()).toBe('2026-11-20T23:30:00.000Z')
    expect(s.endsAt.toISOString()).toBe('2026-11-21T00:30:00.000Z')
  })
  it('rejects bad input with a message', () => {
    for (const bad of [
      { ...base, title: '' },
      { ...base, title: 'x'.repeat(101) },
      { ...base, description: '' },
      { ...base, timeZone: 'Mars/Base' },
      { ...base, date: '20-11-2026' },
      { ...base, lengthMinutes: 5 },
      { ...base, date: '2026-11-01' },
    ]) {
      expect(() => parseSessionInput(bad, NOW)).toThrow(SessionInputError)
    }
  })
  it('presenter is optional', () => {
    expect(parseSessionInput({ ...base, presenter: ' ' }, NOW).presenter).toBeNull()
  })
})

describe('payloads', () => {
  const s = parseSessionInput(base, NOW)
  it('voice channel event', () => {
    const p = buildEventPayload(s, { id: '123456', type: 2 }, 'data:image/png;base64,AAA')
    expect(p).toMatchObject({ name: 'Intro to Dough', entity_type: 2, channel_id: '123456', privacy_level: 2, image: 'data:image/png;base64,AAA', scheduled_start_time: '2026-11-20T23:30:00.000Z' })
    expect(String(p.description)).toContain('Presented by A. Baker')
  })
  it('stage channel event uses entity type 1; no image key without a flyer', () => {
    const p = buildEventPayload(s, { id: '123456', type: 13 })
    expect(p.entity_type).toBe(1)
    expect('image' in p).toBe(false)
  })
  it('announcement has title, time tags and event link', () => {
    const t = buildAnnouncement(s, 'https://discord.com/events/1/2')
    expect(t).toContain('**Intro to Dough**')
    expect(t).toContain(`<t:${Math.floor(s.startsAt.getTime() / 1000)}:F>`)
    expect(t).toContain('https://discord.com/events/1/2')
    expect(buildAnnouncement(s, null)).not.toContain('reminder')
  })
  it('dedupe key is stable and case-insensitive on the title', () => {
    expect(dedupeKey('education', s)).toBe(dedupeKey('education', { ...s, title: 'INTRO TO DOUGH ' }))
    expect(dedupeKey('education', s)).not.toBe(dedupeKey('education', { ...s, startsAt: new Date(s.startsAt.getTime() + 60000) }))
  })
})

describe('manage helpers', () => {
  const s = parseSessionInput(base, NOW)
  it('buildEventPatch carries only the form-owned fields (no channel or entity type)', () => {
    const p = buildEventPatch(s, 'data:image/png;base64,AA')
    expect(Object.keys(p).sort()).toEqual(['description', 'image', 'name', 'scheduled_end_time', 'scheduled_start_time'])
    expect(Object.keys(buildEventPatch(s))).not.toContain('image')
  })
  it('the cancelled announcement leads with Cancelled and has no reminder link or pings', () => {
    const t = buildCancelledAnnouncement(s)
    expect(t.startsWith('❌ **Cancelled: Intro to Dough**')).toBe(true)
    expect(t).not.toContain('Set a reminder')
  })
  it('the update note shows the new time', () => {
    expect(buildUpdateNote(s)).toContain(`<t:${Math.floor(s.startsAt.getTime() / 1000)}:F>`)
  })
  it('wallParts round-trips the form across a DST change', () => {
    // 2026-03-08 is the US spring-forward day; 10:00 New York wall time is 14:00 UTC (EDT).
    const dst = parseSessionInput({ ...base, date: '2026-03-09', time: '10:00' }, new Date('2026-03-01T00:00:00Z'))
    expect(wallParts(dst.startsAt, 'America/New_York')).toEqual({ date: '2026-03-09', time: '10:00' })
    const std = parseSessionInput({ ...base, date: '2026-03-07', time: '10:00' }, new Date('2026-03-01T00:00:00Z'))
    expect(wallParts(std.startsAt, 'America/New_York')).toEqual({ date: '2026-03-07', time: '10:00' })
    expect(std.startsAt.getTime() - dst.startsAt.getTime()).toBe(-(2 * 24 - 1) * 3600_000)
  })
  it('parseSessionExtras: public defaults on, recording must be https', () => {
    expect(parseSessionExtras({})).toEqual({ public: true, recordingUrl: null })
    expect(parseSessionExtras({ public: false, recordingUrl: ' https://example.org/a ' })).toEqual({ public: false, recordingUrl: 'https://example.org/a' })
    for (const bad of ['http://example.org', 'javascript:alert(1)', 'not a url', 'https://x.org/' + 'a'.repeat(500)]) {
      expect(() => parseSessionExtras({ recordingUrl: bad })).toThrow(SessionInputError)
    }
  })
})
