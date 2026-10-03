// @vitest-environment node
//
// Real-Postgres concurrency suite for the $PEP economy.
//
// Skipped unless PEP_IT_DATABASE_URL points at a LOCAL Postgres whose schema
// was created with `prisma db push`. Run it with:
//
//   npm run test:pep-concurrency      # starts a throwaway docker Postgres
//
// Each scenario fires N identical requests in parallel against the real lib
// functions (real Prisma client, real transactions, real row locks) and then
// checks the invariants:
//   * no wallet ever goes negative
//   * every balance change has a ledger row: wallet == opening + SUM(amount)
//   * the running `balance` column chains (prev.balance + amount == balance)
//   * one-shot payouts (bounty complete/cancel, mission level reward, daily
//     job) pay out exactly once
// Finally it runs every check in scripts/pep-reconcile.sql against the DB.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const DB_URL = process.env.PEP_IT_DATABASE_URL || ''
const isLocal = (() => {
  try {
    return ['localhost', '127.0.0.1'].includes(new URL(DB_URL).hostname)
  } catch {
    return false
  }
})()

vi.mock('./notifications', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  notifyBountyClaimed: vi.fn().mockResolvedValue(undefined),
  notifyBountyCompleted: vi.fn().mockResolvedValue(undefined),
  notifyBountyComment: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./discord', () => ({
  getMembersWithRoles: vi.fn().mockResolvedValue([]),
  hasAnyRole: vi.fn().mockResolvedValue(false),
}))

/* eslint-disable @typescript-eslint/no-explicit-any */
type Libs = {
  prisma: any
  economy: typeof import('./economy')
  shop: typeof import('./shop')
  bounties: typeof import('./bounties')
  missions: typeof import('./missions')
  jobs: typeof import('./jobs')
}
let L: Libs
const N = 20
const RUN = String(Date.now()).slice(-9)
let seq = 0
const uid = () => `9${RUN}${String(++seq).padStart(8, '0')}` // 18-digit fake snowflake
const touched = new Map<string, number>() // userId -> opening balance

async function seedUser(wallet = 0) {
  const id = uid()
  await L.prisma.user.create({ data: { id, roles: [] } })
  await L.prisma.economy.create({ data: { id, wallet } })
  touched.set(id, wallet)
  return id
}

async function wallet(id: string) {
  return (await L.prisma.economy.findUniqueOrThrow({ where: { id } })).wallet as number
}

async function ledger(id: string) {
  return L.prisma.transaction.findMany({ where: { userId: id }, orderBy: { id: 'asc' } })
}

/** Ledger invariants for one user. Fire-and-forget logs are awaited by `settle()` first. */
async function expectLedgerConsistent(id: string) {
  const opening = touched.get(id) ?? 0
  const w = await wallet(id)
  const rows = await ledger(id)
  expect(w).toBeGreaterThanOrEqual(0)
  expect(w).toBe(opening + rows.reduce((s: number, r: any) => s + r.amount, 0))
  let running = opening
  for (const r of rows) {
    running += r.amount
    expect(r.balance, `running balance of tx ${r.id} (${r.type})`).toBe(running)
  }
}

const settle = () => new Promise((r) => setTimeout(r, 300))

function outcomes(results: PromiseSettledResult<unknown>[]) {
  return {
    ok: results.filter((r) => r.status === 'fulfilled').length,
    failed: results.filter((r) => r.status === 'rejected').length,
  }
}

describe.skipIf(!isLocal)('$PEP economy under concurrency (real Postgres)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL
    const u = new URL(DB_URL)
    process.env.E2E_PG_HOST = '127.0.0.1'
    process.env.E2E_PG_PORT = u.port || '5432'
    // Route the Neon adapter's WebSocket to the local Postgres socket.
    createRequire(import.meta.url)(resolve(process.cwd(), 'e2e/local/preload.cjs'))
    L = {
      prisma: (await import('./db')).prisma,
      economy: await import('./economy'),
      shop: await import('./shop'),
      bounties: await import('./bounties'),
      missions: await import('./missions'),
      jobs: await import('./jobs'),
    }
  }, 60_000)

  afterAll(async () => {
    await L?.prisma.$disconnect()
  })

  it(`${N} parallel transfers can't overdraw and are fully ledgered`, async () => {
    const a = await seedUser(100)
    const b = await seedUser(0)
    const res = await Promise.allSettled(Array.from({ length: N }, () => L.economy.transfer(a, b, 10)))
    expect(outcomes(res)).toEqual({ ok: 10, failed: 10 })
    expect(await wallet(a)).toBe(0)
    expect(await wallet(b)).toBe(100)
    await expectLedgerConsistent(a)
    await expectLedgerConsistent(b)
  }, 60_000)

  it(`${N} parallel shop purchases can't overdraw the wallet or oversell stock`, async () => {
    const buyer = await seedUser(100)
    const item = await L.prisma.shopItem.create({ data: { name: `it-limited-${RUN}`, price: 10, quantity: 5 } })
    const res = await Promise.allSettled(Array.from({ length: N }, () => L.shop.buyItem(buyer, item.id, 1)))
    expect(outcomes(res).ok).toBe(5)
    expect(await wallet(buyer)).toBe(50)
    expect((await L.prisma.shopItem.findUniqueOrThrow({ where: { id: item.id } })).quantity).toBe(0)
    const inv = await L.prisma.inventory.findUniqueOrThrow({ where: { userId_itemId: { userId: buyer, itemId: item.id } } })
    expect(inv.quantity).toBe(5)
    await expectLedgerConsistent(buyer)
  }, 60_000)

  it(`${N} parallel unlimited-stock purchases stop exactly at a zero balance`, async () => {
    const buyer = await seedUser(100)
    const item = await L.prisma.shopItem.create({ data: { name: `it-unlimited-${RUN}`, price: 10, quantity: -1 } })
    const res = await Promise.allSettled(Array.from({ length: N }, () => L.shop.buyItem(buyer, item.id, 1)))
    expect(outcomes(res).ok).toBe(10)
    expect(await wallet(buyer)).toBe(0)
    await expectLedgerConsistent(buyer)
  }, 60_000)

  it(`${N} parallel bounty creations escrow at most the wallet`, async () => {
    const creator = await seedUser(100)
    const res = await Promise.allSettled(
      Array.from({ length: N }, (_, i) => L.bounties.createBounty(creator, `it bounty ${i}`, 10)),
    )
    expect(outcomes(res).ok).toBe(10)
    expect(await wallet(creator)).toBe(0)
    expect(await L.prisma.bounty.count({ where: { createdBy: creator } })).toBe(10)
    await settle()
    await expectLedgerConsistent(creator)
  }, 60_000)

  async function claimedBounty(reward = 50) {
    const creator = await seedUser(reward)
    const claimer = await seedUser(0)
    const bounty = await L.bounties.createBounty(creator, 'it claimed bounty', reward)
    await L.bounties.claimBounty(claimer, bounty.id)
    return { creator, claimer, bounty }
  }

  it(`${N} parallel completeBounty calls pay the claimer once`, async () => {
    const { creator, claimer, bounty } = await claimedBounty()
    await Promise.allSettled(Array.from({ length: N }, () => L.bounties.completeBounty(creator, bounty.id)))
    await settle()
    expect(await wallet(claimer)).toBe(50)
    await expectLedgerConsistent(claimer)
    await expectLedgerConsistent(creator)
  }, 60_000)

  it(`${N} parallel cancelBounty calls refund once`, async () => {
    const { creator, bounty } = await claimedBounty()
    await Promise.allSettled(Array.from({ length: N }, () => L.bounties.cancelBounty(creator, bounty.id)))
    await settle()
    expect(await wallet(creator)).toBe(50)
    await expectLedgerConsistent(creator)
  }, 60_000)

  it('racing complete vs cancel releases the escrow exactly once', async () => {
    const { creator, claimer, bounty } = await claimedBounty()
    await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        i % 2 ? L.bounties.completeBounty(creator, bounty.id) : L.bounties.cancelBounty(creator, bounty.id),
      ),
    )
    await settle()
    expect((await wallet(creator)) + (await wallet(claimer))).toBe(50)
    await expectLedgerConsistent(creator)
    await expectLedgerConsistent(claimer)
  }, 60_000)

  it(`${N} parallel claims leave exactly one claimer`, async () => {
    const creator = await seedUser(10)
    const bounty = await L.bounties.createBounty(creator, 'it claim race', 10)
    const claimers = await Promise.all(Array.from({ length: N }, () => seedUser(0)))
    const res = await Promise.allSettled(claimers.map((c) => L.bounties.claimBounty(c, bounty.id)))
    expect(outcomes(res).ok).toBe(1)
  }, 60_000)

  it(`${N} parallel approvals of the last mission pay the level reward once`, async () => {
    const level = 100 + (Number(RUN) % 1000) // isolated level, outside the real 1-8 range
    const mission = await L.prisma.mission.create({
      data: { level, index: 0, title: 'it mission', reward: 420, autoVerify: false },
    })
    const user = await seedUser(0)
    const completion = await L.prisma.missionCompletion.create({
      data: { missionId: mission.id, discordId: user, status: 'PENDING' },
    })
    await Promise.allSettled(Array.from({ length: N }, () => L.missions.approveMission('admin', completion.id)))
    await settle()
    expect(await wallet(user)).toBe(420)
    await expectLedgerConsistent(user)
  }, 60_000)

  it('concurrent auto-verified submissions completing a level pay the reward once', async () => {
    const level = 2000 + (Number(RUN) % 1000)
    const missions = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        L.prisma.mission.create({ data: { level, index, title: `it auto ${index}`, reward: 69, autoVerify: true } }),
      ),
    )
    // Unlock the level for the user: getCurrentLevel requires prior levels complete,
    // so put the user on an isolated level by approving nothing below it isn't
    // possible — call checkAndAwardLevelReward directly after concurrent approvals.
    const user = await seedUser(0)
    await Promise.all(
      missions.map((m) =>
        L.prisma.missionCompletion.create({ data: { missionId: m.id, discordId: user, status: 'APPROVED', reviewedBy: 'auto' } }),
      ),
    )
    await Promise.allSettled(Array.from({ length: N }, () => L.missions.checkAndAwardLevelReward(user, level)))
    await settle()
    expect(await wallet(user)).toBe(69)
    await expectLedgerConsistent(user)
  }, 60_000)

  it(`${N} parallel daily-job completions pay once`, async () => {
    const user = await seedUser(0)
    const job = await L.prisma.job.create({ data: { description: `it job ${RUN}`, type: 'it' } })
    const res = await Promise.allSettled(
      Array.from({ length: N }, () => L.jobs.recordDailyJobCompletion(user, job.id, 50, 'it daily job')),
    )
    expect(res.filter((r) => r.status === 'fulfilled' && r.value === true)).toHaveLength(1)
    expect(await wallet(user)).toBe(50)
    await expectLedgerConsistent(user)
  }, 60_000)

  it(`${N} parallel admin completeJob calls pay once`, async () => {
    const user = await seedUser(0)
    const job = await L.prisma.job.create({ data: { description: `it admin job ${RUN}`, type: 'it' } })
    await L.prisma.jobAssignment.create({ data: { jobId: job.id, userId: user } })
    await Promise.allSettled(Array.from({ length: N }, () => L.jobs.completeJob(user, 50)))
    await settle()
    expect(await wallet(user)).toBe(50)
    await expectLedgerConsistent(user)
  }, 60_000)

  it('every touched wallet reconciles with the ledger', async () => {
    await settle()
    for (const id of touched.keys()) await expectLedgerConsistent(id)
  }, 60_000)

  it('scripts/pep-reconcile.sql runs and flags nothing for the test users', async () => {
    const sql = readFileSync(resolve(process.cwd(), 'scripts/pep-reconcile.sql'), 'utf8')
    const statements = sql
      .split(/;\s*$/m)
      .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean)
    expect(statements.length).toBeGreaterThan(5)
    const ids = new Set(touched.keys())
    for (const stmt of statements) {
      expect(stmt, 'reconcile script must be read-only').toMatch(/^(SELECT|WITH)\b/i)
      const rows: any[] = await L.prisma.$queryRawUnsafe(stmt)
      // No error-severity row may belong to a user this suite touched.
      const flagged = rows.filter((r) => r.severity === 'error' && r.user_id && ids.has(r.user_id))
      expect(flagged, stmt.slice(0, 80)).toEqual([])
    }
  }, 60_000)
})
