// @vitest-environment node
/**
 * /work, crime and the cooldown against an in-memory fake of the Prisma calls
 * they use (conditional updateMany, insert-on-conflict-do-nothing, rollback
 * on throw), so cooldown races and ledger writes are exercised for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const state = vi.hoisted(() => ({
  wallets: new Map<string, number>(),
  cooldowns: new Map<string, Date>(),
  ledger: [] as Array<{ userId: string; type: string; amount: number; description: string; metadata: unknown }>,
}))

vi.mock('../../db', () => {
  const k = (d: string, a: string) => `${d}|${a}`
  const client: Record<string, unknown> = {
    economyCooldown: {
      updateMany: vi.fn(async ({ where, data }: { where: { discordId: string; action: string; lastAt: { lte: Date } }; data: { lastAt: Date } }) => {
        const cur = state.cooldowns.get(k(where.discordId, where.action))
        if (!cur || cur > where.lastAt.lte) return { count: 0 }
        state.cooldowns.set(k(where.discordId, where.action), data.lastAt)
        return { count: 1 }
      }),
      createMany: vi.fn(async ({ data }: { data: Array<{ discordId: string; action: string; lastAt: Date }> }) => {
        let count = 0
        for (const d of data) {
          if (state.cooldowns.has(k(d.discordId, d.action))) continue
          state.cooldowns.set(k(d.discordId, d.action), d.lastAt)
          count++
        }
        return { count }
      }),
      findUnique: vi.fn(async ({ where }: { where: { discordId_action: { discordId: string; action: string } } }) => {
        const lastAt = state.cooldowns.get(k(where.discordId_action.discordId, where.discordId_action.action))
        return lastAt ? { lastAt } : null
      }),
    },
    economy: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { wallet: { increment: number } } }) => {
        const wallet = (state.wallets.get(where.id) ?? 0) + data.wallet.increment
        state.wallets.set(where.id, wallet)
        return { id: where.id, wallet }
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; wallet: { gte: number } }; data: { wallet: { decrement: number } } }) => {
        const w = state.wallets.get(where.id) ?? 0
        if (w < where.wallet.gte) return { count: 0 }
        state.wallets.set(where.id, w - data.wallet.decrement)
        return { count: 1 }
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, wallet: state.wallets.get(where.id) ?? 0 })),
    },
  }
  client.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const saved = { wallets: new Map(state.wallets), cooldowns: new Map(state.cooldowns), ledger: [...state.ledger] }
    try {
      return await fn(client)
    } catch (e) {
      Object.assign(state, saved)
      throw e
    }
  })
  return { prisma: client }
})

vi.mock('../../economy', () => ({
  getOrCreateEconomy: vi.fn(async (id: string) => {
    if (!state.wallets.has(id)) state.wallets.set(id, 0)
    return { id, wallet: state.wallets.get(id) }
  }),
}))

vi.mock('../../transactions', () => ({
  logTransaction: vi.fn(async (_tx: unknown, userId: string, type: string, amount: number, description: string, metadata: unknown) => {
    state.ledger.push({ userId, type, amount, description, metadata })
    return { id: state.ledger.length }
  }),
}))

import { doWork, workPrompts, DEFAULT_WORK_PROMPTS } from '../work'
import { commitCrime } from '../crime'
import { randInt } from '../cooldown'

const U = '100000000000000001'
const t0 = new Date('2026-10-02T12:00:00Z')
const at = (s: number) => new Date(t0.getTime() + s * 1000)
/** rng that returns the given values in order (then repeats the last). */
const seq = (...v: number[]) => {
  let i = 0
  return () => v[Math.min(i++, v.length - 1)]
}

beforeEach(() => {
  state.wallets = new Map([[U, 1000]])
  state.cooldowns = new Map()
  state.ledger = []
})
afterEach(() => {
  delete process.env.WORK_PROMPTS_JSON
  delete process.env.WORK_MAX_PEP
})

describe('randInt', () => {
  it('covers the inclusive range', () => {
    expect(randInt(10, 100, () => 0)).toBe(10)
    expect(randInt(10, 100, () => 0.999999)).toBe(100)
  })
})

describe('/work', () => {
  it('pays 10-100, writes WORK_REWARD, and enforces the 30s cooldown', async () => {
    const r = await doWork(U, { rng: seq(0.5, 0), now: t0 })
    expect(r).toMatchObject({ ok: true, amount: 55, balance: 1055, promptIndex: 0, prompt: DEFAULT_WORK_PROMPTS[0] })
    expect(state.ledger).toEqual([{ userId: U, type: 'WORK_REWARD', amount: 55, description: 'Work shift', metadata: { command: 'work', promptIndex: 0 } }])

    const blocked = await doWork(U, { now: at(29) })
    expect(blocked).toEqual({ ok: false, readyAt: at(30) })
    expect(state.wallets.get(U)).toBe(1055)

    expect((await doWork(U, { rng: () => 0, now: at(30) })).ok).toBe(true)
    expect(state.ledger).toHaveLength(2)
  })

  it('concurrent /work calls pay out once', async () => {
    const results = await Promise.all([doWork(U, { rng: () => 0, now: t0 }), doWork(U, { rng: () => 0, now: t0 })])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(state.ledger).toHaveLength(1)
  })

  it('first-ever /work for a brand-new user creates the wallet', async () => {
    const r = await doWork('100000000000000099', { rng: () => 0, now: t0 })
    expect(r).toMatchObject({ ok: true, amount: 10, balance: 10 })
  })

  it('custom prompts come from WORK_PROMPTS_JSON, ignoring junk', () => {
    process.env.WORK_PROMPTS_JSON = JSON.stringify(['Slice {amount}'])
    expect(workPrompts()).toEqual(['Slice {amount}'])
    process.env.WORK_PROMPTS_JSON = '{nope'
    expect(workPrompts()).toBe(DEFAULT_WORK_PROMPTS)
  })
})

describe('crime', () => {
  it('success (40%) pays 2-420 as CRIME_REWARD', async () => {
    const r = await commitCrime(U, { rng: seq(0.7, 0.999999), now: t0 }) // 70 >= 60 -> success; max payout
    expect(r).toEqual({ ok: true, outcome: 'success', amount: 420, balance: 1420 })
    expect(state.ledger[0]).toMatchObject({ type: 'CRIME_REWARD', amount: 420 })
  })

  it('failure (60%) fines 5-55% of the wallet as CRIME_FINE', async () => {
    const r = await commitCrime(U, { rng: seq(0.1, 0), now: t0 }) // fail; 5% fine
    expect(r).toEqual({ ok: true, outcome: 'fined', amount: 50, finePercent: 5, balance: 950 })
    expect(state.ledger[0]).toMatchObject({ type: 'CRIME_FINE', amount: -50 })
    expect((await commitCrime(U, { now: at(10) })).ok).toBe(false)
    const big = await commitCrime(U, { rng: seq(0.1, 0.999999), now: at(31) }) // 55% of 950
    expect(big).toMatchObject({ outcome: 'fined', amount: 522, finePercent: 55, balance: 428 })
  })

  it('a fine on an empty wallet costs nothing and writes no ledger row', async () => {
    state.wallets.set(U, 0)
    const r = await commitCrime(U, { rng: seq(0.1, 0.5), now: t0 })
    expect(r).toMatchObject({ outcome: 'fined', amount: 0, balance: 0 })
    expect(state.ledger).toHaveLength(0)
  })
})
