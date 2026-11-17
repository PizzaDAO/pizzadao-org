import { describe, it, expect, vi } from 'vitest'
import { countGuestAttendance, fetchGuestAttendance } from './guest-attendance'

const env = { RSV_PIZZA_SERVICE_KEY: 'sekret' } as unknown as NodeJS.ProcessEnv
const base = 'https://api.rsv.example'
const HASH = 'a'.repeat(64)
const WALLET = '0x' + '1'.repeat(40)
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }))
const o = (f: unknown) => ({ baseUrl: base, env, fetchImpl: f as typeof fetch })

describe('fetchGuestAttendance', () => {
  it('posts the hashes and wallets with the service key and maps the events', async () => {
    const f = reply({
      ok: true,
      events: [
        { eventId: 'e1', name: 'Party', date: '2026-05-22', city: 'Rome', url: 'https://rsv.pizza/rome', matchedBy: ['wallet', 'email'], hideGuestList: true },
        { eventId: 'e2', name: 'B', date: null, city: null, url: null, matchedBy: ['wallet'], hideGuestList: false },
      ],
    })
    const r = await fetchGuestAttendance({ emailHashes: [HASH, HASH, 'junk'], wallets: [WALLET, 'junk'] }, o(f))
    expect(r).toEqual([
      { id: 'e1', name: 'Party', date: '2026-05-22', city: 'Rome', url: 'https://rsv.pizza/rome', matchedBy: 'email', guestListHidden: true },
      { id: 'e2', name: 'B', date: null, city: null, url: null, matchedBy: 'wallet', guestListHidden: false },
    ])
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.rsv.example/api/service/guest-attendance')
    expect((init.headers as Record<string, string>)['x-service-key']).toBe('sekret')
    expect(JSON.parse(init.body as string)).toEqual({ emailHashes: [HASH], wallets: [WALLET] })
  })

  it('caps identifiers at 10 each', async () => {
    const f = reply({ ok: true, events: [] })
    const hashes = Array.from({ length: 15 }, (_, i) => i.toString(16).padStart(64, '0'))
    await fetchGuestAttendance({ emailHashes: hashes }, o(f))
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).emailHashes).toHaveLength(10)
  })

  it('returns null on a failure, a bad body, no identifiers, no key or a 503, never exposing the key', async () => {
    expect(await fetchGuestAttendance({ emailHashes: [HASH] }, o(reply({ ok: false, reason: 'disabled' }, 503)))).toBeNull()
    expect(await fetchGuestAttendance({ emailHashes: [HASH] }, o(reply({ ok: true, nope: 1 })))).toBeNull()
    expect(await fetchGuestAttendance({ emailHashes: ['not-a-hash'] }, o(reply({ ok: true, events: [] })))).toBeNull()
    expect(await fetchGuestAttendance({ emailHashes: [HASH] }, { baseUrl: base, env: {} as NodeJS.ProcessEnv, fetchImpl: reply({ ok: true, events: [] }) as unknown as typeof fetch })).toBeNull()
    expect(await fetchGuestAttendance({ emailHashes: [HASH] }, { ...o(reply({})), baseUrl: 'http://insecure.example' })).toBeNull()
    const boom = vi.fn(async () => { throw new Error('network sekret') })
    expect(await fetchGuestAttendance({ emailHashes: [HASH] }, o(boom))).toBeNull()
  })
})

describe('countGuestAttendance', () => {
  it('sends dryRun with hashes only and returns the matched-members count', async () => {
    const f = reply({ ok: true, dryRun: true, matchedMembers: 3 })
    expect(await countGuestAttendance([HASH], o(f))).toBe(3)
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ emailHashes: [HASH], dryRun: true })
  })
  it('is null on a bad body or no hashes', async () => {
    expect(await countGuestAttendance([HASH], o(reply({ ok: true, events: [] })))).toBeNull()
    expect(await countGuestAttendance([], o(reply({})))).toBeNull()
  })
})
