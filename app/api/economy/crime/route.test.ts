// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getSession = vi.fn()
const commitCrime = vi.fn()
vi.mock('@/app/lib/session', () => ({ getSession: () => getSession() }))
vi.mock('@/app/lib/pep-earn/crime', () => ({ commitCrime: (id: string) => commitCrime(id) }))

import { POST } from './route'

describe('POST /api/economy/crime', () => {
  beforeEach(() => {
    getSession.mockReset()
    commitCrime.mockReset()
    process.env.PEP_CRIME_ENABLED = '1'
  })
  afterEach(() => {
    delete process.env.PEP_CRIME_ENABLED
  })

  it('is hidden (404) unless PEP_CRIME_ENABLED=1', async () => {
    delete process.env.PEP_CRIME_ENABLED
    expect((await POST()).status).toBe(404)
    expect(commitCrime).not.toHaveBeenCalled()
  })

  it('requires a session', async () => {
    getSession.mockResolvedValue(null)
    expect((await POST()).status).toBe(401)
  })

  it('returns the outcome, or 429 with readyAt on cooldown', async () => {
    getSession.mockResolvedValue({ discordId: '100000000000000001' })
    commitCrime.mockResolvedValueOnce({ ok: true, outcome: 'success', amount: 69, balance: 1069 })
    const ok = await POST()
    expect(await ok.json()).toMatchObject({ outcome: 'success', amount: 69 })

    commitCrime.mockResolvedValueOnce({ ok: false, readyAt: new Date('2026-10-02T12:00:30Z') })
    const cd = await POST()
    expect(cd.status).toBe(429)
    expect(await cd.json()).toEqual({ error: 'cooldown', readyAt: '2026-10-02T12:00:30.000Z' })
  })
})
