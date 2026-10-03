// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ValidationError } from '@/app/lib/errors/api-errors'

const getSession = vi.fn()
const playSlots = vi.fn()
const playRoulette = vi.fn()
const startBlackjack = vi.fn()
const blackjackAction = vi.fn()
const getActiveBlackjack = vi.fn()
vi.mock('@/app/lib/session', () => ({ getSession: () => getSession() }))
vi.mock('@/app/lib/pep-games/slots', () => ({ playSlots: (...a: unknown[]) => playSlots(...a) }))
vi.mock('@/app/lib/pep-games/roulette', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/pep-games/roulette')>()),
  playRoulette: (...a: unknown[]) => playRoulette(...a),
}))
vi.mock('@/app/lib/pep-games/blackjack', () => ({
  startBlackjack: (...a: unknown[]) => startBlackjack(...a),
  blackjackAction: (...a: unknown[]) => blackjackAction(...a),
  getActiveBlackjack: (...a: unknown[]) => getActiveBlackjack(...a),
}))

import { POST as slots } from './slots/route'
import { POST as roulette } from './roulette/route'
import { GET as bjGet, POST as bj } from './blackjack/route'
import { GET as features } from '../features/route'

const ME = '100000000000000001'
const req = (body: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) })

describe('web games API', () => {
  beforeEach(() => {
    for (const f of [getSession, playSlots, playRoulette, startBlackjack, blackjackAction, getActiveBlackjack]) f.mockReset()
    getSession.mockResolvedValue({ discordId: ME })
    process.env.PEP_GAMES_ENABLED = '1'
  })
  afterEach(() => {
    delete process.env.PEP_GAMES_ENABLED
    delete process.env.PEP_CRIME_ENABLED
    delete process.env.PEP_ROB_ENABLED
  })

  it('is hidden (404) unless PEP_GAMES_ENABLED=1, and the features endpoint says so', async () => {
    delete process.env.PEP_GAMES_ENABLED
    expect((await slots(req({ bet: 10 }))).status).toBe(404)
    expect((await roulette(req({ bet: 10, space: 'red' }))).status).toBe(404)
    expect((await bj(req({ action: 'start', bet: 10 }))).status).toBe(404)
    expect((await bjGet()).status).toBe(404)
    expect(playSlots).not.toHaveBeenCalled()
    expect(await (await features()).json()).toEqual({ crime: false, games: false, rob: false })
    process.env.PEP_GAMES_ENABLED = '1'
    process.env.PEP_CRIME_ENABLED = '1'
    expect(await (await features()).json()).toEqual({ crime: true, games: true, rob: false })
  })

  it('requires a session', async () => {
    getSession.mockResolvedValue(null)
    expect((await slots(req({ bet: 10 }))).status).toBe(401)
  })

  it('plays as the session user; cooldown is 429 with readyAt; bad input is 400', async () => {
    playSlots.mockResolvedValueOnce({ ok: true, reels: ['pizza', 'pizza', 'pizza'], payout: 1000, multiplier: 100, bet: 10, balance: 1 })
    expect(await (await slots(req({ bet: 10 }))).json()).toMatchObject({ payout: 1000 })
    expect(playSlots).toHaveBeenCalledWith(ME, 10)

    playSlots.mockResolvedValueOnce({ ok: false, reason: 'cooldown', readyAt: new Date('2026-10-02T12:00:03Z') })
    const cd = await slots(req({ bet: 10 }))
    expect(cd.status).toBe(429)
    expect(await cd.json()).toEqual({ error: 'cooldown', readyAt: '2026-10-02T12:00:03.000Z' })

    playSlots.mockRejectedValueOnce(new ValidationError('Bet must be a whole number from 10 to 5,000'))
    expect((await slots(req({ bet: 1 }))).status).toBe(400)

    expect((await roulette(req({ bet: 10, space: 'purple' }))).status).toBe(400)
    playRoulette.mockResolvedValueOnce({ ok: true, landed: 0, payout: 0 })
    await roulette(req({ bet: 10, space: '0' }))
    expect(playRoulette).toHaveBeenCalledWith(ME, 10, { kind: 'number', n: 0 })
  })

  it('blackjack: start, act on your hand, 409 with the live hand, 404 for a stranger', async () => {
    startBlackjack.mockResolvedValueOnce({ ok: true, game: { id: 'g1', status: 'ACTIVE' }, balance: 1 })
    expect((await bj(req({ action: 'start', bet: 50 }))).status).toBe(200)
    expect(startBlackjack).toHaveBeenCalledWith(ME, 50, { source: 'web' })

    startBlackjack.mockResolvedValueOnce({ ok: false, reason: 'active_game', game: { id: 'g1' } })
    const live = await bj(req({ action: 'start', bet: 50 }))
    expect(live.status).toBe(409)
    expect((await live.json()).game).toEqual({ id: 'g1' })

    blackjackAction.mockResolvedValueOnce({ ok: true, game: { id: 'g1', status: 'SETTLED' }, balance: 1 })
    await bj(req({ action: 'stand', gameId: 'g1' }))
    expect(blackjackAction).toHaveBeenCalledWith(ME, 'g1', 'stand')

    blackjackAction.mockResolvedValueOnce({ ok: false, reason: 'not_yours' })
    expect((await bj(req({ action: 'hit', gameId: 'g2' }))).status).toBe(404)
    expect((await bj(req({ action: 'double', gameId: 'g1' }))).status).toBe(400)

    getActiveBlackjack.mockResolvedValueOnce(null)
    expect(await (await bjGet()).json()).toEqual({ game: null })
  })
})
