import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearClosingSongCooldowns, playClosingSong } from './closing-song'

const PROD = { VERCEL_ENV: 'production', PIZZA_RADIO_URL: 'https://radio.example/', PIZZA_RADIO_API_KEY: 'k' }
const A = { sessionId: 's1', channelId: '123', crew: 'Amore' }

beforeEach(() => clearClosingSongCooldowns())

describe('closing song', () => {
  it('posts the crew and channel to pizza-radio /play-crew, once per minute per call', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    expect(await playClosingSong(A, { env: PROD, fetchImpl: f as never, now: 0 })).toBe('ok')
    expect(f).toHaveBeenCalledWith('https://radio.example/play-crew', expect.objectContaining({ method: 'POST', body: JSON.stringify({ crew: 'Amore', channelId: '123' }) }))
    expect(await playClosingSong(A, { env: PROD, fetchImpl: f as never, now: 30_000 })).toBe('cooldown')
    expect(await playClosingSong(A, { env: PROD, fetchImpl: f as never, now: 61_000 })).toBe('ok')
  })

  it('never plays from a preview or without pizza-radio configured', async () => {
    const f = vi.fn()
    expect(await playClosingSong(A, { env: { ...PROD, VERCEL_ENV: 'preview' }, fetchImpl: f as never })).toBe('not-configured')
    expect(await playClosingSong(A, { env: { VERCEL_ENV: 'production' }, fetchImpl: f as never })).toBe('not-configured')
    expect(f).not.toHaveBeenCalled()
  })

  it('a refused or failed request can be retried right away', async () => {
    const bad = vi.fn(async () => new Response('{}', { status: 400 }))
    expect(await playClosingSong(A, { env: PROD, fetchImpl: bad as never, now: 0 })).toBe('rejected')
    const down = vi.fn(async () => { throw new Error('down') })
    expect(await playClosingSong(A, { env: PROD, fetchImpl: down as never, now: 1 })).toBe('failed')
    const ok = vi.fn(async () => new Response('{}', { status: 200 }))
    expect(await playClosingSong(A, { env: PROD, fetchImpl: ok as never, now: 2 })).toBe('ok')
  })
})
