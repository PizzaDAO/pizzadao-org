// @vitest-environment node
/**
 * The website collect route against an in-memory fake of the cooldown/wallet Prisma calls, shared with
 * collectIncome itself (the slash-command path), so "collect in one place blocks the other" is exercised for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  wallets: new Map<string, number>(),
  cooldowns: new Map<string, Date>(),
}))
const session = vi.hoisted(() => ({ value: null as null | { discordId: string } }))
const roles = vi.hoisted(() => ({ value: { ok: true } as unknown }))
const limits = vi.hoisted(() => ({ ip: null as unknown, member: { success: true } as { success: boolean } }))

vi.mock('@/app/lib/session', () => ({ getSession: async () => session.value }))
vi.mock('@/app/lib/rate-limit', () => ({
  enforceRateLimit: async () => limits.ip,
  checkKeyedRateLimit: async () => limits.member,
}))
vi.mock('@/app/lib/pep-earn/income-web', () => ({ loadIncomeContext: async () => roles.value }))

vi.mock('@/app/lib/db', () => {
  const k = (d: string, a: string) => `${d}|${a}`
  const client: Record<string, unknown> = {
    economyCooldown: {
      updateMany: async ({ where, data }: { where: { discordId: string; action: string; lastAt: { lte: Date } }; data: { lastAt: Date } }) => {
        const cur = state.cooldowns.get(k(where.discordId, where.action))
        if (!cur || cur > where.lastAt.lte) return { count: 0 }
        state.cooldowns.set(k(where.discordId, where.action), data.lastAt)
        return { count: 1 }
      },
      createMany: async ({ data }: { data: Array<{ discordId: string; action: string; lastAt: Date }> }) => {
        let count = 0
        for (const d of data) {
          if (state.cooldowns.has(k(d.discordId, d.action))) continue
          state.cooldowns.set(k(d.discordId, d.action), d.lastAt)
          count++
        }
        return { count }
      },
      findUnique: async ({ where }: { where: { discordId_action: { discordId: string; action: string } } }) => {
        const lastAt = state.cooldowns.get(k(where.discordId_action.discordId, where.discordId_action.action))
        return lastAt ? { lastAt } : null
      },
      findMany: async ({ where }: { where: { discordId: string; action: { in: string[] } } }) =>
        where.action.in.flatMap((a) => {
          const lastAt = state.cooldowns.get(k(where.discordId, a))
          return lastAt ? [{ action: a, lastAt }] : []
        }),
    },
    economy: {
      findUnique: async ({ where }: { where: { id: string } }) => ({ wallet: state.wallets.get(where.id) ?? 0 }),
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({ wallet: state.wallets.get(where.id) ?? 0 }),
    },
  }
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(client)
  return { prisma: client }
})

vi.mock('@/app/lib/economy', () => ({
  getOrCreateEconomy: async (id: string) => {
    if (!state.wallets.has(id)) state.wallets.set(id, 0)
  },
  creditInTx: async (_tx: unknown, id: string, amount: number) => {
    state.wallets.set(id, (state.wallets.get(id) ?? 0) + amount)
  },
}))

import { GET, POST } from './route'
import { collectIncome } from '@/app/lib/pep-earn/income'

const U = '100000000000000001'
const BOX = { name: 'Box Mafia', roleId: 'r-box', amount: 42, intervalHours: 24 }
const OG = { name: 'OG', roleId: 'r-og', amount: 10, intervalHours: 24 }
const ctx = (roleIds: string[]) => ({
  ok: true,
  roleIds,
  incomes: [BOX, OG],
  earnRoles: [
    { name: 'Box Mafia', amount: 42 },
    { name: 'OG', amount: 10 },
  ],
})

const post = (headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  POST(new Request('http://localhost/api/pep/collect-income', { method: 'POST', headers, body: '{}' }) as never)

beforeEach(() => {
  state.wallets = new Map()
  state.cooldowns = new Map()
  session.value = { discordId: U }
  roles.value = ctx(['r-box'])
  limits.ip = null
  limits.member = { success: true }
})

describe('/api/pep/collect-income', () => {
  it('requires a session (GET and POST)', async () => {
    session.value = null
    expect((await GET()).status).toBe(401)
    expect((await post()).status).toBe(401)
  })

  it('rejects non-JSON and cross-origin writes', async () => {
    expect((await post({ 'content-type': 'text/plain' })).status).toBe(415)
    expect((await post({ 'content-type': 'application/json', origin: 'https://evil.example', host: 'localhost' })).status).toBe(403)
  })

  it('rate limits per IP and per member', async () => {
    limits.ip = new Response('{}', { status: 429 })
    expect((await post()).status).toBe(429)
    limits.ip = null
    limits.member = { success: false }
    expect((await post()).status).toBe(429)
    expect(state.wallets.get(U)).toBeUndefined()
  })

  it('503s when Discord roles cannot be read, without paying', async () => {
    roles.value = { ok: false }
    expect((await post()).status).toBe(503)
    expect((await GET()).status).toBe(503)
  })

  it('pays per held role, privately, and reports the next time', async () => {
    roles.value = ctx(['r-box', 'r-og'])
    const res = await post()
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const body = await res.json()
    expect(body.total).toBe(52)
    expect(body.paid).toEqual([
      { name: 'Box Mafia', roleId: 'r-box', amount: 42 },
      { name: 'OG', roleId: 'r-og', amount: 10 },
    ])
    expect(body.balance).toBe(52)
    expect(new Date(body.nextReadyAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000)
  })

  it('GET reports what is collectible, then the wait after collecting', async () => {
    const before = await (await GET()).json()
    expect(before).toMatchObject({ totalAvailable: 42, nextReadyAt: null })
    expect(before.available).toEqual([{ name: 'Box Mafia', roleId: 'r-box', amount: 42 }])
    expect(before.earnRoles).toHaveLength(2)

    await post()
    const after = await (await GET()).json()
    expect(after.totalAvailable).toBe(0)
    expect(after.available).toEqual([])
    expect(after.waiting[0]).toMatchObject({ roleId: 'r-box', amount: 42 })
    expect(after.nextReadyAt).toBe(after.waiting[0].readyAt)
  })

  it('shares the cooldown with the slash command (collect here blocks it, and the reverse)', async () => {
    await post()
    const slash = await collectIncome(U, ['r-box'], [BOX])
    expect(slash.paid).toEqual([])
    expect(slash.waiting).toHaveLength(1)
    expect(state.wallets.get(U)).toBe(42)

    // Reverse: a slash-command collect blocks the website.
    state.cooldowns = new Map()
    state.wallets = new Map()
    await collectIncome(U, ['r-box'], [BOX])
    const body = await (await post()).json()
    expect(body.paid).toEqual([])
    expect(body.total).toBe(0)
    expect(body.waiting).toHaveLength(1)
    expect(state.wallets.get(U)).toBe(42)
  })

  it('pays nothing when the member holds no earning role', async () => {
    roles.value = ctx(['r-other'])
    const body = await (await post()).json()
    expect(body).toMatchObject({ paid: [], total: 0, nextReadyAt: null })
    const status = await (await GET()).json()
    expect(status.totalAvailable).toBe(0)
    expect(status.earnRoles.length).toBe(2)
  })
})
