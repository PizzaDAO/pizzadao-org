import { describe, expect, it, vi } from 'vitest'
import { fetchUpcomingEvents } from './client'

const wire = { eventId: 'e1', url: 'https://rsv.pizza/e1', name: 'Party', date: '2026-12-05T23:00:00.000Z', timezone: 'America/New_York', city: 'New York', latitude: 40.7, longitude: -74, addressIsCityDefault: true, full: false, rsvpClosed: false, kind: 'gpp' }
const opts = (fetchImpl: typeof fetch, env: Record<string, string> = { RSV_PIZZA_SERVICE_KEY: 'k' }) => ({ baseUrl: 'https://api.example', until: new Date('2027-01-01T00:00:00Z'), env: env as unknown as NodeJS.ProcessEnv, fetchImpl })
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('fetchUpcomingEvents', () => {
  it('parses events and sends the service key, until and limit', async () => {
    const f = reply({ ok: true, events: [wire] })
    const out = await fetchUpcomingEvents(opts(f))
    expect(out).toHaveLength(1)
    expect(out![0]).toMatchObject({ id: 'e1', lat: 40.7, lng: -74, cityLevel: true, kind: 'gpp' })
    const [url, init] = vi.mocked(f).mock.calls[0]
    expect(String(url)).toBe('https://api.example/api/service/upcoming-events')
    expect((init as RequestInit).headers).toMatchObject({ 'x-service-key': 'k' })
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ until: '2027-01-01T00:00:00.000Z', limit: 500 })
  })

  it('rejects an answer carrying extra (host or guest) fields', async () => {
    expect(await fetchUpcomingEvents(opts(reply({ ok: true, events: [{ ...wire, hostEmail: 'x@y.z' }] })))).toBeNull()
    expect(await fetchUpcomingEvents(opts(reply({ ok: true, events: [{ ...wire, guests: [] }] })))).toBeNull()
  })

  it('failure means null: no key, bad status, bad body, network error, non-https base', async () => {
    expect(await fetchUpcomingEvents(opts(reply({ ok: true, events: [] }), {}))).toBeNull()
    expect(await fetchUpcomingEvents(opts(reply({ reason: 'disabled' }, 503)))).toBeNull()
    expect(await fetchUpcomingEvents(opts(reply({ nope: 1 })))).toBeNull()
    expect(await fetchUpcomingEvents(opts(vi.fn(async () => Promise.reject(new Error('x'))) as unknown as typeof fetch))).toBeNull()
    expect(await fetchUpcomingEvents({ ...opts(reply({ ok: true, events: [] })), baseUrl: 'http://api.example' })).toBeNull()
  })

  it('drops events with a non-https link or a bad date, keeps the rest', async () => {
    const out = await fetchUpcomingEvents(opts(reply({ ok: true, events: [{ ...wire, url: 'http://x.test/a' }, { ...wire, eventId: 'e2', date: 'nonsense' }, { ...wire, eventId: 'e3' }] })))
    expect(out!.map((e) => e.id)).toEqual(['e3'])
  })
})
