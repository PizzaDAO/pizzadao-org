import { describe, expect, it } from 'vitest'
import type { NearbyEvent } from './client'
import { capVerdict, distanceKm, effectiveRadiusKm, eventInvitable, memberVerdict, type MatchConfig, type MemberPlace } from './match'

const NOW = new Date('2026-12-01T12:00:00Z')
const HOUR = 3_600_000
const cfg: MatchConfig = { defaultRadiusKm: 50, citySlackKm: 25, minLeadHours: 24, maxLeadDays: 45, maxPerWeek: 3, maxPerDay: 1, kinds: ['gpp', 'series'] }

// Brooklyn-ish origin; one degree of latitude is about 111.19 km.
const member: MemberPlace = { discordId: 'm1', lat: 40, lng: -74, cityName: 'New York' }
const ev = (o: Partial<NearbyEvent> = {}): NearbyEvent => ({
  id: 'e1', url: 'https://rsv.example/e1', name: 'Pizza', startsAt: new Date(NOW.getTime() + 48 * HOUR), timezone: 'America/New_York', city: 'New York',
  lat: 40, lng: -74, cityLevel: false, full: false, rsvpClosed: false, kind: 'gpp', ...o,
})
const atKm = (km: number) => ({ lat: 40 + km / 111.19, lng: -74 })

describe('distance', () => {
  it('is zero for the same point and about 111 km per degree of latitude', () => {
    expect(distanceKm(member, member)).toBe(0)
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeGreaterThan(110.9)
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeLessThan(111.5)
  })
})

describe('opt-out default and radius', () => {
  it('a member with no preference row is invited (opt-out)', () => {
    expect(memberVerdict(member, undefined, ev(), cfg)).toEqual({ ok: true, km: 0 })
  })
  it('only an explicit nearbyEvents=false excludes', () => {
    expect(memberVerdict(member, { nearbyEvents: false, radiusKm: null }, ev(), cfg)).toEqual({ ok: false, why: 'opted_out' })
    expect(memberVerdict(member, { nearbyEvents: true, radiusKm: null }, ev(), cfg).ok).toBe(true)
  })
  it('the default radius is 50 km, edges inclusive of 50 and exclusive of 51', () => {
    expect(memberVerdict(member, undefined, ev(atKm(49.5)), cfg).ok).toBe(true)
    expect(memberVerdict(member, undefined, ev(atKm(51)), cfg)).toEqual({ ok: false, why: 'far' })
  })
  it('city-level coordinates add the slack (50 + 25 km)', () => {
    expect(memberVerdict(member, undefined, ev({ ...atKm(70), cityLevel: true }), cfg).ok).toBe(true)
    expect(memberVerdict(member, undefined, ev({ ...atKm(70), cityLevel: false }), cfg).ok).toBe(false)
    expect(memberVerdict(member, undefined, ev({ ...atKm(76), cityLevel: true }), cfg).ok).toBe(false)
  })
  it("a member's own radius replaces the default", () => {
    expect(memberVerdict(member, { nearbyEvents: true, radiusKm: 100 }, ev(atKm(90)), cfg).ok).toBe(true)
    expect(memberVerdict(member, { nearbyEvents: true, radiusKm: 10 }, ev(atKm(20)), cfg).ok).toBe(false)
    expect(effectiveRadiusKm({ nearbyEvents: true, radiusKm: 10 }, { cityLevel: true }, cfg)).toBe(35)
  })
})

describe('which events can be invited to', () => {
  it('needs the notice window: not under 24 h, not over 45 days', () => {
    expect(eventInvitable(ev({ startsAt: new Date(NOW.getTime() + 23 * HOUR) }), NOW, cfg)).toBe(false)
    expect(eventInvitable(ev({ startsAt: new Date(NOW.getTime() + 24 * HOUR) }), NOW, cfg)).toBe(true)
    expect(eventInvitable(ev({ startsAt: new Date(NOW.getTime() + 45 * 24 * HOUR) }), NOW, cfg)).toBe(true)
    expect(eventInvitable(ev({ startsAt: new Date(NOW.getTime() + 46 * 24 * HOUR) }), NOW, cfg)).toBe(false)
    expect(eventInvitable(ev({ startsAt: new Date(NOW.getTime() - HOUR) }), NOW, cfg)).toBe(false)
  })
  it('skips full and closed events', () => {
    expect(eventInvitable(ev({ full: true }), NOW, cfg)).toBe(false)
    expect(eventInvitable(ev({ rsvpClosed: true }), NOW, cfg)).toBe(false)
  })
  it('honours the kinds setting', () => {
    expect(eventInvitable(ev({ kind: 'series' }), NOW, { ...cfg, kinds: ['gpp'] })).toBe(false)
    expect(eventInvitable(ev({ kind: 'gpp' }), NOW, { ...cfg, kinds: ['gpp'] })).toBe(true)
  })
})

describe('caps (3 a week, 1 a day)', () => {
  const ago = (h: number) => new Date(NOW.getTime() - h * HOUR)
  it('allows the first send', () => {
    expect(capVerdict([], NOW, cfg)).toBe('ok')
  })
  it('one in the last 24 hours blocks another (day)', () => {
    expect(capVerdict([ago(23)], NOW, cfg)).toBe('day')
    expect(capVerdict([ago(25)], NOW, cfg)).toBe('ok')
  })
  it('three in the last 7 days block another (week), even when none is from today', () => {
    expect(capVerdict([ago(30), ago(60), ago(100)], NOW, cfg)).toBe('week')
    expect(capVerdict([ago(30), ago(60), ago(24 * 7 + 1)], NOW, cfg)).toBe('ok')
  })
  it('the week cap wins over the day cap', () => {
    expect(capVerdict([ago(1), ago(30), ago(60)], NOW, cfg)).toBe('week')
  })
})
