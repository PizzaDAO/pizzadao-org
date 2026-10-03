// @vitest-environment node
/**
 * DB layer of the migration against an in-memory fake of the Prisma calls it
 * uses. The fake implements conditional updateMany semantics so idempotency
 * and race behaviour are exercised for real, not just asserted on mocks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Claim = {
  migrationKey: string
  source: string
  discordId: string
  amount: number
  sourceCash: bigint
  sourceBank: bigint
  snapshotSha: string
  status: string
  transactionId: number | null
  creditedAt: Date | null
  reversedAt: Date | null
}

const state = vi.hoisted(() => ({
  claims: new Map<string, Claim>(),
  wallets: new Map<string, number>(),
  users: new Set<string>(),
  ledger: [] as Array<{ id: number; userId: string; type: string; amount: number; description: string; metadata: unknown }>,
  failEconomyUpdateFor: null as string | null,
}))

vi.mock('../../db', () => {
  const pendingPepClaim = {
    createMany: vi.fn(async ({ data }: { data: Claim[] }) => {
      let count = 0
      for (const d of data) {
        if (state.claims.has(d.migrationKey)) continue
        state.claims.set(d.migrationKey, { ...d, status: 'PENDING', transactionId: null, creditedAt: null, reversedAt: null })
        count++
      }
      return { count }
    }),
    findMany: vi.fn(async ({ where }: { where: { migrationKey?: { in: string[] }; discordId?: string; status?: string; source?: string } }) =>
      [...state.claims.values()].filter(
        (c) =>
          (!where.migrationKey || where.migrationKey.in.includes(c.migrationKey)) &&
          (!where.discordId || c.discordId === where.discordId) &&
          (!where.status || c.status === where.status) &&
          (!where.source || c.source === where.source),
      ),
    ),
    findUnique: vi.fn(async ({ where }: { where: { migrationKey: string } }) => {
      const c = state.claims.get(where.migrationKey)
      return c ? { ...c } : null
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { migrationKey: string; status: string }; data: Partial<Claim> }) => {
      const c = state.claims.get(where.migrationKey)
      if (!c || c.status !== where.status) return { count: 0 }
      Object.assign(c, data)
      return { count: 1 }
    }),
    update: vi.fn(async ({ where, data }: { where: { migrationKey: string }; data: Partial<Claim> }) => {
      Object.assign(state.claims.get(where.migrationKey)!, data)
    }),
  }
  const economy = {
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { wallet: { increment: number } } }) => {
      if (state.failEconomyUpdateFor === where.id) throw new Error('db down')
      state.wallets.set(where.id, (state.wallets.get(where.id) ?? 0) + data.wallet.increment)
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; wallet: { gte: number } }; data: { wallet: { decrement: number } } }) => {
      const w = state.wallets.get(where.id) ?? 0
      if (w < where.wallet.gte) return { count: 0 }
      state.wallets.set(where.id, w - data.wallet.decrement)
      return { count: 1 }
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      state.wallets.has(where.id) ? { id: where.id, wallet: state.wallets.get(where.id) } : null,
    ),
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.filter((id) => state.wallets.has(id)).map((id) => ({ id, wallet: state.wallets.get(id)! })),
    ),
  }
  const user = { findMany: vi.fn(async () => [...state.users].map((id) => ({ id }))) }
  const client = { pendingPepClaim, economy, user } as Record<string, unknown>
  // All-or-nothing: snapshot state, run, restore on throw (like a DB transaction).
  client.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const saved = {
      claims: new Map([...state.claims].map(([k, v]) => [k, { ...v }])),
      wallets: new Map(state.wallets),
      ledger: [...state.ledger],
    }
    try {
      return await fn(client)
    } catch (e) {
      state.claims = saved.claims
      state.wallets = saved.wallets
      state.ledger = saved.ledger
      throw e
    }
  })
  return { prisma: client }
})

vi.mock('../../economy', () => ({
  getOrCreateEconomy: vi.fn(async (id: string) => {
    state.users.add(id)
    if (!state.wallets.has(id)) state.wallets.set(id, 0)
    return { id, wallet: state.wallets.get(id) }
  }),
}))

vi.mock('../../transactions', () => ({
  logTransaction: vi.fn(async (_tx: unknown, userId: string, type: string, amount: number, description: string, metadata: unknown) => {
    const row = { id: state.ledger.length + 1, userId, type, amount, description, metadata }
    state.ledger.push(row)
    return row
  }),
}))

import {
  claimPendingPepForUser,
  claimPendingPepOnLogin,
  creditClaim,
  creditMatched,
  getWallets,
  reverseClaim,
  stageClaims,
} from '../claims'
import { buildSnapshot } from '../snapshot'
import { buildMigrationPlan } from '../plan'
import { reconcile } from '../reconcile'
import { FIXTURE_GUILD, fixtureUsers } from './mock-ub'

const MEMBER = '100000000000000001'
const NEWCOMER = '100000000000000003'
const SHA = 'a'.repeat(64)

function makePlan() {
  const snapshot = buildSnapshot({ guildId: FIXTURE_GUILD, users: fixtureUsers, pages: 1, apiBase: 'mock' })
  const known = new Map<string, string | null>([
    [MEMBER, '1'],
    ['100000000000000008', '8'],
  ])
  return buildMigrationPlan(snapshot, known, { exclude: ['100000000000000005'] })
}
const key = (id: string) => `unbelievaboat:${FIXTURE_GUILD}:${id}`

beforeEach(() => {
  state.claims = new Map()
  state.wallets = new Map([[MEMBER, 25]])
  state.users = new Set([MEMBER])
  state.ledger = []
  state.failEconomyUpdateFor = null
  delete process.env.PEP_MIGRATION_CLAIMS
})

describe('stageClaims', () => {
  it('stages credit + pending entries once and reports conflicts without overwriting', async () => {
    const plan = makePlan()
    const first = await stageClaims(plan, SHA)
    expect(first).toMatchObject({ created: 4, alreadyStaged: 0, conflicts: [] }) // 1, 3, 7, 8
    expect(state.claims.get(key(NEWCOMER))).toMatchObject({ status: 'PENDING', amount: 500, sourceCash: BigInt(300), sourceBank: BigInt(200) })

    const again = await stageClaims(plan, SHA)
    expect(again).toMatchObject({ created: 0, alreadyStaged: 4, conflicts: [] })

    state.claims.get(key(MEMBER))!.amount = 999
    const conflict = await stageClaims(plan, SHA)
    expect(conflict.conflicts).toEqual([{ migrationKey: key(MEMBER), existingAmount: 999, planAmount: 1054, existingStatus: 'PENDING' }])
    expect(state.claims.get(key(MEMBER))!.amount).toBe(999)
  })
})

describe('creditClaim', () => {
  it('credits wallet + ledger exactly once (re-runs are no-ops)', async () => {
    await stageClaims(makePlan(), SHA)
    const r1 = await creditClaim(key(MEMBER))
    expect(r1).toMatchObject({ status: 'credited', amount: 1054, transactionId: 1 })
    expect(state.wallets.get(MEMBER)).toBe(25 + 1054)
    expect(state.ledger).toHaveLength(1)
    expect(state.ledger[0]).toMatchObject({ userId: MEMBER, type: 'MIGRATION_CREDIT', amount: 1054, description: 'UnbelievaBoat migration' })
    expect(state.ledger[0].metadata).toMatchObject({ migrationKey: key(MEMBER), sourceCash: '54', sourceBank: '1000', snapshotSha: SHA })
    expect(state.claims.get(key(MEMBER))).toMatchObject({ status: 'CREDITED', transactionId: 1 })

    const r2 = await creditClaim(key(MEMBER))
    expect(r2.status).toBe('already')
    expect(state.wallets.get(MEMBER)).toBe(25 + 1054)
    expect(state.ledger).toHaveLength(1)
  })

  it('a concurrent second credit loses the conditional update and changes nothing', async () => {
    await stageClaims(makePlan(), SHA)
    const [a, b] = await Promise.all([creditClaim(key(MEMBER)), creditClaim(key(MEMBER))])
    expect([a.status, b.status].sort()).toEqual(['already', 'credited'])
    expect(state.wallets.get(MEMBER)).toBe(25 + 1054)
    expect(state.ledger).toHaveLength(1)
  })

  it('rolls the claim back to PENDING if the wallet update fails', async () => {
    await stageClaims(makePlan(), SHA)
    state.failEconomyUpdateFor = MEMBER
    await expect(creditClaim(key(MEMBER))).rejects.toThrow('db down')
    expect(state.claims.get(key(MEMBER))!.status).toBe('PENDING')
    expect(state.ledger).toHaveLength(0)
    state.failEconomyUpdateFor = null
    expect((await creditClaim(key(MEMBER))).status).toBe('credited')
  })

  it('returns missing for an unknown key', async () => {
    expect(await creditClaim('nope')).toEqual({ status: 'missing', migrationKey: 'nope' })
  })
})

describe('creditMatched + reconcile', () => {
  it('credits members only, leaves newcomers pending, and reconciles to zero mismatches', async () => {
    const plan = makePlan()
    const ids = plan.entries.map((e) => e.discordId)
    const before = await getWallets(ids)
    await stageClaims(plan, SHA)
    const res = await creditMatched(plan.entries)
    expect(res).toMatchObject({ credited: 2, already: 0, failed: [], pepCredited: 1054 + 450 })
    expect(state.claims.get(key(NEWCOMER))!.status).toBe('PENDING')

    const after = await getWallets(ids)
    const claims = new Map([...state.claims].map(([k, c]) => [k, c]))
    const report = reconcile(plan, before, after, claims, new Set(res.creditedKeys))
    expect(report.totals).toMatchObject({ expectedDelta: 1504, actualDelta: 1504, mismatches: 0, claimsPending: 2, pepPending: 510 })

    // Re-running the whole apply is a no-op
    const again = await creditMatched(plan.entries)
    expect(again).toMatchObject({ credited: 0, already: 2 })
    expect(state.ledger).toHaveLength(2)
  })
})

describe('login claim', () => {
  it('is a no-op unless PEP_MIGRATION_CLAIMS=1', async () => {
    await stageClaims(makePlan(), SHA)
    await claimPendingPepOnLogin(NEWCOMER)
    expect(state.claims.get(key(NEWCOMER))!.status).toBe('PENDING')
  })

  it('credits held claims on first login, once', async () => {
    await stageClaims(makePlan(), SHA)
    process.env.PEP_MIGRATION_CLAIMS = '1'
    await claimPendingPepOnLogin(NEWCOMER)
    expect(state.wallets.get(NEWCOMER)).toBe(500)
    expect(state.users.has(NEWCOMER)).toBe(true)
    await claimPendingPepOnLogin(NEWCOMER)
    expect(state.wallets.get(NEWCOMER)).toBe(500)
    expect(await claimPendingPepForUser(NEWCOMER)).toEqual({ credited: 0, amount: 0 })
  })

  it('never throws into the login flow', async () => {
    process.env.PEP_MIGRATION_CLAIMS = '1'
    const { prisma } = await import('../../db')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(prisma.pendingPepClaim.findMany as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('relation does not exist'))
    await expect(claimPendingPepOnLogin(NEWCOMER)).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('reverseClaim', () => {
  it('voids pending claims and reverses credited ones, never below zero', async () => {
    await stageClaims(makePlan(), SHA)
    await creditClaim(key(MEMBER))
    // Member spent most of it
    state.wallets.set(MEMBER, 100)

    const r = await reverseClaim(key(MEMBER))
    expect(r).toEqual({ status: 'reversed', discordId: MEMBER, amount: 1054, debited: 100, shortfall: 954 })
    expect(state.wallets.get(MEMBER)).toBe(0)
    expect(state.ledger.at(-1)).toMatchObject({ type: 'MIGRATION_REVERSAL', amount: -100 })
    expect(state.claims.get(key(MEMBER))!.status).toBe('REVERSED')

    expect(await reverseClaim(key(NEWCOMER))).toMatchObject({ status: 'voided', amount: 500 })
    expect(state.claims.get(key(NEWCOMER))!.status).toBe('VOID')
    // VOID claims are not credited on login anymore
    process.env.PEP_MIGRATION_CLAIMS = '1'
    await claimPendingPepOnLogin(NEWCOMER)
    expect(state.wallets.get(NEWCOMER)).toBeUndefined()

    expect((await reverseClaim(key(MEMBER))).status).toBe('skipped')
  })
})
