import { describe, expect, it } from 'vitest'
import { buildAnnouncement, buildEventPayload, dedupeKey, parseSessionInput, SessionInputError } from './build'

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
