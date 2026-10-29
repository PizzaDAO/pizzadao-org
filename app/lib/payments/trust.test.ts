// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { evaluateTrust, toHostView, type TrustInput } from './trust'
import { fetchRsvTrack, rsvConfig, type RsvTrack } from './rsv-track'
import { policy } from './test-utils'

const NOW = new Date('2026-11-10T00:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)
const track = (over: Partial<RsvTrack> = {}): RsvTrack => ({ tier: 'fast_pass', rawTier: 'fast_pass', eligibleForFastPass: true, verifiedParties: 3, ...over })
const input = (over: Partial<TrustInput> = {}): TrustInput => ({
  now: NOW, rsv: null, paidWithProof: 2, fraudRejectedLast12Months: false, accountCreatedAt: daysAgo(100), level: 4, openHighFlagElsewhere: false, ...over,
})
const on = policy({ fastTrackEnabled: true })

describe('evaluateTrust', () => {
  it('eligible with two paid requests, an old enough account and the level', () => {
    expect(evaluateTrust(input(), on)).toMatchObject({ eligible: true, missing: [], blocked: false })
  })
  it('a party-platform Fast Pass replaces the paid-requests history', () => {
    const r = evaluateTrust(input({ paidWithProof: 0, rsv: track() }), on)
    expect(r.eligible).toBe(true)
    expect(r.rsvFastPass).toBe(true)
  })
  it('the party platform missing, null or not Fast Pass falls back to the paid-requests rule', () => {
    expect(evaluateTrust(input({ paidWithProof: 1, rsv: null }), on).missing).toEqual(['history'])
    expect(evaluateTrust(input({ paidWithProof: 1, rsv: track({ tier: 'other', eligibleForFastPass: false }) }), on).eligible).toBe(false)
    expect(evaluateTrust(input({ paidWithProof: 2, rsv: null }), on).eligible).toBe(true)
  })
  it('a flagged tier blocks even with enough paid requests', () => {
    const r = evaluateTrust(input({ rsv: track({ tier: 'flagged', eligibleForFastPass: false }) }), on)
    expect(r).toMatchObject({ eligible: false, blocked: true })
  })
  it('a fraud rejection in the last year, or an open high flag elsewhere, blocks', () => {
    expect(evaluateTrust(input({ fraudRejectedLast12Months: true }), on).eligible).toBe(false)
    expect(evaluateTrust(input({ fraudRejectedLast12Months: true, rsv: track() }), on).eligible).toBe(false)
    expect(evaluateTrust(input({ openHighFlagElsewhere: true }), on).eligible).toBe(false)
  })
  it('account age and level are minimums; an unknown account age fails', () => {
    expect(evaluateTrust(input({ accountCreatedAt: daysAgo(44) }), on).missing).toEqual(['account_age'])
    expect(evaluateTrust(input({ accountCreatedAt: daysAgo(45) }), on).eligible).toBe(true)
    expect(evaluateTrust(input({ accountCreatedAt: null }), on).missing).toEqual(['account_age'])
    expect(evaluateTrust(input({ level: 3 }), on).missing).toEqual(['level'])
  })
  it('switched off or degraded settings never produce eligibility', () => {
    expect(evaluateTrust(input(), policy()).eligible).toBe(false)
    expect(evaluateTrust(input(), policy({ fastTrackEnabled: true, degraded: true })).eligible).toBe(false)
  })
})

describe('host view', () => {
  it('shows progress and what is missing, never blockers', () => {
    const p = on
    const blocked = input({ paidWithProof: 2, rsv: track({ tier: 'flagged', eligibleForFastPass: false }) })
    const view = toHostView(evaluateTrust(blocked, p), blocked, p)
    expect(view).toEqual({ state: 'building', paid: 2, needed: 2, missing: [] })
    expect(JSON.stringify(view)).not.toMatch(/flag|fraud|block|rsv|disavow|restrict/i)
  })
  it('building card for someone part way there; ready when eligible', () => {
    const i = input({ paidWithProof: 1 })
    expect(toHostView(evaluateTrust(i, on), i, on)).toEqual({ state: 'building', paid: 1, needed: 2, missing: ['history'] })
    expect(toHostView(evaluateTrust(input(), on), input(), on).state).toBe('ready')
  })
})

describe('fetchRsvTrack', () => {
  const ENV = { RSV_PIZZA_API_URL: 'https://api.example.test/', RSV_PIZZA_SERVICE_KEY: 'shared-secret' } as unknown as NodeJS.ProcessEnv
  const ids = { wallets: ['0xabc'] }
  const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it('is null without both env vars (no call is made)', async () => {
    const f = reply({})
    expect(await fetchRsvTrack(ids, { env: {} as never, fetchImpl: f })).toBeNull()
    expect(await fetchRsvTrack(ids, { env: { RSV_PIZZA_API_URL: 'https://x.test' } as never, fetchImpl: f })).toBeNull()
    expect(await fetchRsvTrack(ids, { env: { RSV_PIZZA_API_URL: 'http://insecure.test', RSV_PIZZA_SERVICE_KEY: 'k' } as never, fetchImpl: f })).toBeNull()
    expect(f).not.toHaveBeenCalled()
    expect(rsvConfig(ENV)).toEqual({ baseUrl: 'https://api.example.test', serviceKey: 'shared-secret' })
  })
  it('never follows a redirect (the secret must not leave for another host)', async () => {
    const f = reply({ tier: 'fast_pass', eligibleForFastPass: true, verifiedParties: 1 })
    await fetchRsvTrack(ids, { env: ENV, fetchImpl: f })
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].redirect).toBe('error')
  })
  it('sends the service key and only identifiers, and parses a Fast Pass answer', async () => {
    const f = reply({ tier: 'fast_pass', eligibleForFastPass: true, verifiedParties: 4 })
    const r = await fetchRsvTrack({ wallets: ['0xabc'], telegrams: ['someone'] }, { env: ENV, fetchImpl: f })
    expect(r).toMatchObject({ tier: 'fast_pass', eligibleForFastPass: true, verifiedParties: 4 })
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.example.test/api/service/host-track-record')
    expect(init.headers['x-service-key']).toBe('shared-secret')
    expect(JSON.parse(init.body)).toEqual({ wallets: ['0xabc'], telegrams: ['someone'] })
  })
  it('a Fast Pass tier that disagrees with the boolean is not trusted', async () => {
    const r = await fetchRsvTrack(ids, { env: ENV, fetchImpl: reply({ tier: 'fast_pass', eligibleForFastPass: false, verifiedParties: 1 }) })
    expect(r?.eligibleForFastPass).toBe(false)
  })
  it('maps a flagged tier and unknown tiers', async () => {
    expect((await fetchRsvTrack(ids, { env: ENV, fetchImpl: reply({ tier: 'flagged', eligibleForFastPass: false, verifiedParties: 0 }) }))?.tier).toBe('flagged')
    expect((await fetchRsvTrack(ids, { env: ENV, fetchImpl: reply({ tier: 'brand_new', eligibleForFastPass: false, verifiedParties: 0 }) }))?.tier).toBe('other')
  })
  it('failures all mean null: non-200, bad body, network error, timeout', async () => {
    expect(await fetchRsvTrack(ids, { env: ENV, fetchImpl: reply({}, 500) })).toBeNull()
    expect(await fetchRsvTrack(ids, { env: ENV, fetchImpl: reply({ nope: 1 }) })).toBeNull()
    expect(await fetchRsvTrack(ids, { env: ENV, fetchImpl: vi.fn(async () => { throw new Error('down') }) as never })).toBeNull()
    const hang = vi.fn((_u: unknown, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch
    expect(await fetchRsvTrack(ids, { env: ENV, fetchImpl: hang, timeoutMs: 20 })).toBeNull()
  })
  it('makes no call when there are no identifiers to look up', async () => {
    const f = reply({})
    expect(await fetchRsvTrack({}, { env: ENV, fetchImpl: f })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})
