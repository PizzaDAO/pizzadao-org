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
//     job, role income per role, a blackjack hand, an item grant) pay out
//     exactly once
//   * the games: cooldowns hold under races, stakes can't overdraw
//   * /remove-money can't take a wallet below 0, however many race
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
  income: typeof import('./pep-earn/income')
  roulette: typeof import('./pep-games/roulette')
  slots: typeof import('./pep-games/slots')
  blackjack: typeof import('./pep-games/blackjack')
  grants: typeof import('./shop-grants')
  admin: typeof import('./pep-admin')
  celebration: typeof import('./celebration')
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
      income: await import('./pep-earn/income'),
      roulette: await import('./pep-games/roulette'),
      slots: await import('./pep-games/slots'),
      blackjack: await import('./pep-games/blackjack'),
      grants: await import('./shop-grants'),
      admin: await import('./pep-admin'),
      celebration: await import('./celebration'),
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

  it(`${N} concurrent level-completion checks (what parallel auto-verified submissions trigger) pay once`, async () => {
    const level = 2000 + (Number(RUN) % 1000)
    const missions = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        L.prisma.mission.create({ data: { level, index, title: `it auto ${index}`, reward: 69, autoVerify: true } }),
      ),
    )
    // submitMissionCompletion gates on getCurrentLevel (all lower levels done), so on an
    // isolated level we create the approvals directly and race the payout check itself,
    // which is what each auto-verified submission calls.
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

  // ---- Mission verification Phase 0 ----

  it(`${N} parallel resubmits of a rejected mission: one wins, the rejection is kept once`, async () => {
    // Level 1 with a run-unique index: getCurrentLevel is data-driven, so the
    // mission must sit at the bottom level for the submit's level gate.
    const mission = await L.prisma.mission.create({
      data: { level: 1, index: 1000 + (Number(RUN) % 100000), title: 'it resubmit', reward: 0, autoVerify: true },
    })
    const user = await seedUser(0)
    const first = await L.missions.submitMissionCompletion(user, mission.id, 'https://one', 'first')
    expect(first.status).toBe('PENDING') // autoVerify no longer approves on submit
    await L.missions.rejectMission('reviewer', first.id, 'blurry')

    const res = await Promise.allSettled(
      Array.from({ length: N }, (_, i) => L.missions.submitMissionCompletion(user, mission.id, `https://two/${i}`, 'second')),
    )
    expect(outcomes(res).ok).toBe(1)
    const row = await L.prisma.missionCompletion.findUniqueOrThrow({ where: { id: first.id } })
    expect(row).toMatchObject({ status: 'PENDING', reviewedBy: null, reviewNote: null, reviewedAt: null })
    const { memberNotes, history } = L.missions.splitReviewHistory(row.notes)
    expect(memberNotes).toBe('second')
    expect(history).toHaveLength(1)
    expect(history[0]).toMatch(/^Attempt 1 rejected .* by reviewer \| note: blurry \| evidence: https:\/\/one$/)
    await L.prisma.missionCompletion.delete({ where: { id: first.id } })
    await L.prisma.mission.update({ where: { id: mission.id }, data: { isActive: false } })
  }, 60_000)

  it(`${N} parallel level-up claims (tabs, reloads) celebrate once`, async () => {
    const memberId = `it-${RUN}`
    const res = await Promise.allSettled(Array.from({ length: N }, () => L.celebration.claimLevelCelebration(memberId, 3)))
    expect(res.filter((r) => r.status === 'rejected')).toEqual([])
    expect(res.filter((r) => r.status === 'fulfilled' && r.value === true)).toHaveLength(1)
    await expect(L.celebration.claimLevelCelebration(memberId, 3)).resolves.toBe(false)
    await expect(L.celebration.claimLevelCelebration(memberId, 4)).resolves.toBe(true) // the next level-up
    await L.prisma.memberProfileExtras.delete({ where: { memberId } })
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

  // ---- UnbelievaBoat replacement: /pay, /collect-income, games, item grants ----

  it(`${N} parallel /pay calls both ways between two members conserve PEP and don't deadlock`, async () => {
    const a = await seedUser(100)
    const b = await seedUser(100)
    const res = await Promise.allSettled(
      Array.from({ length: N }, (_, i) => (i % 2 ? L.economy.transfer(a, b, 15) : L.economy.transfer(b, a, 15))),
    )
    expect(res.filter((r) => r.status === 'rejected' && !/Insufficient/.test(String(r.reason)))).toEqual([])
    expect((await wallet(a)) + (await wallet(b))).toBe(200)
    await expectLedgerConsistent(a)
    await expectLedgerConsistent(b)
  }, 60_000)

  it(`${N} parallel /collect-income calls pay each held role once`, async () => {
    const user = await seedUser(0)
    const incomes = [
      { name: 'it Crew Member', amount: 42, intervalHours: 24, roleId: `7${RUN}01` },
      { name: 'it Pizza Holder', amount: 69, intervalHours: 24, roleId: `7${RUN}02` },
      { name: 'it Not Held', amount: 690, intervalHours: 24, roleId: `7${RUN}03` },
    ]
    const roles = [`7${RUN}01`, `7${RUN}02`, 'unrelated']
    const res = await Promise.all(Array.from({ length: N }, () => L.income.collectIncome(user, roles, incomes)))
    expect(res.reduce((s, r) => s + r.total, 0)).toBe(111)
    expect(await wallet(user)).toBe(111)
    const rows = (await ledger(user)).filter((r: any) => r.type === 'ROLE_INCOME')
    expect(rows.map((r: any) => r.amount).sort()).toEqual([42, 69])
    // Next day: collectable again.
    const tomorrow = new Date(Date.now() + 24 * 3_600_000 + 1000)
    expect((await L.income.collectIncome(user, roles, incomes, { now: tomorrow })).total).toBe(111)
    await expectLedgerConsistent(user)
  }, 60_000)

  it(`${N} parallel game starts are rate limited to one stake`, async () => {
    const user = await seedUser(1000)
    const res = await Promise.all(Array.from({ length: N }, () => L.slots.playSlots(user, 10)))
    expect(res.filter((r) => r.ok)).toHaveLength(1)
    expect((await ledger(user)).filter((r: any) => r.type === 'GAME_BET')).toHaveLength(1)
    await expectLedgerConsistent(user)
  }, 60_000)

  it(`${N} parallel roulette bets (no rate limit) can't overdraw the wallet`, async () => {
    process.env.GAME_COOLDOWN_SECONDS = '0'
    try {
      const user = await seedUser(100)
      const res = await Promise.allSettled(
        Array.from({ length: N }, () => L.roulette.playRoulette(user, 10, { kind: 'red' }, { rng: () => 0 })), // lands on 0
      )
      const played = res.filter((r) => r.status === 'fulfilled' && (r.value as any).ok).length
      expect(played).toBeGreaterThan(0)
      expect(played).toBeLessThanOrEqual(10)
      expect(await wallet(user)).toBe(100 - 10 * played)
      await expectLedgerConsistent(user)
    } finally {
      delete process.env.GAME_COOLDOWN_SECONDS
    }
  }, 60_000)

  it('roulette and slots pay GAME_WIN in the same transaction as the GAME_BET', async () => {
    process.env.GAME_COOLDOWN_SECONDS = '0'
    try {
      const user = await seedUser(1000)
      const ro = await L.roulette.playRoulette(user, 100, { kind: 'number', n: 0 }, { rng: () => 0 })
      expect(ro).toMatchObject({ ok: true, landed: 0, payout: 3600, balance: 4500 })
      const sl = await L.slots.playSlots(user, 10, { rng: () => 0 }) // three pizzas
      expect(sl).toMatchObject({ ok: true, reels: ['pizza', 'pizza', 'pizza'], payout: 1000, balance: 5490 })
      expect((await ledger(user)).map((r: any) => [r.type, r.amount])).toEqual([
        ['GAME_BET', -100], ['GAME_WIN', 3600], ['GAME_BET', -10], ['GAME_WIN', 1000],
      ])
      await expect(L.slots.playSlots(user, 5)).rejects.toThrow(/Bet must be/)
      await expect(L.slots.playSlots(user, 6000)).rejects.toThrow(/Bet must be/)
      await expectLedgerConsistent(user)
    } finally {
      delete process.env.GAME_COOLDOWN_SECONDS
    }
  }, 60_000)

  async function activeHand(user: string, bet = 10) {
    process.env.GAME_COOLDOWN_SECONDS = '0'
    try {
      for (let i = 0; i < 20; i++) {
        const r = await L.blackjack.startBlackjack(user, bet)
        if (r.ok && r.game.status === 'ACTIVE') return r.game
      }
      throw new Error('no active hand dealt')
    } finally {
      delete process.env.GAME_COOLDOWN_SECONDS
    }
  }

  async function expectBlackjackSettledOnce(user: string) {
    const games = await L.prisma.blackjackGame.findMany({ where: { discordId: user } })
    const wins = (await ledger(user)).filter((r: any) => r.type === 'GAME_WIN')
    for (const g of games) {
      const mine = wins.filter((w: any) => w.metadata?.gameId === g.id)
      expect(mine.length).toBeLessThanOrEqual(1)
      expect(mine.reduce((s: number, w: any) => s + w.amount, 0)).toBe(g.payout ?? 0)
    }
    expect((await ledger(user)).filter((r: any) => r.type === 'GAME_BET')).toHaveLength(games.length)
  }

  it(`${N} parallel /blackjack starts deal one hand and take one stake`, async () => {
    const user = await seedUser(1000)
    const res = await Promise.all(Array.from({ length: N }, () => L.blackjack.startBlackjack(user, 50)))
    expect(res.filter((r) => r.ok)).toHaveLength(1)
    expect(await L.prisma.blackjackGame.count({ where: { discordId: user } })).toBe(1)
    await expectBlackjackSettledOnce(user)
    await expectLedgerConsistent(user)
  }, 60_000)

  it(`${N} parallel Stand presses settle the hand exactly once`, async () => {
    const user = await seedUser(1000)
    const game = await activeHand(user)
    const res = await Promise.all(Array.from({ length: N }, () => L.blackjack.blackjackAction(user, game.id, 'stand')))
    expect(res.every((r) => r.ok && r.game.status === 'SETTLED')).toBe(true)
    expect(res.filter((r) => r.ok && !r.stale)).toHaveLength(1)
    await expectBlackjackSettledOnce(user)
    await expectLedgerConsistent(user)
  }, 60_000)

  it(`${N} parallel Hit presses apply one card at a time; a stranger can't press`, async () => {
    const user = await seedUser(1000)
    const game = await activeHand(user)
    const stranger = await seedUser(0)
    expect(await L.blackjack.blackjackAction(stranger, game.id, 'hit')).toEqual({ ok: false, reason: 'not_yours' })
    const res = await Promise.all(Array.from({ length: N }, () => L.blackjack.blackjackAction(user, game.id, 'hit')))
    expect(res.filter((r) => r.ok && !r.stale)).toHaveLength(1)
    const row = await L.prisma.blackjackGame.findUniqueOrThrow({ where: { id: game.id } })
    expect((row.state as any).player).toHaveLength(3)
    await L.blackjack.blackjackAction(user, game.id, 'stand')
    await expectBlackjackSettledOnce(user)
    await expectLedgerConsistent(user)
  }, 60_000)

  it('a timed-out hand auto-stands once, however many sweeps race', async () => {
    const user = await seedUser(1000)
    const game = await activeHand(user)
    const later = new Date(Date.now() + 10 * 60_000)
    await Promise.all(Array.from({ length: N }, () => L.blackjack.sweepExpiredBlackjack({ now: later, discordId: user })))
    const row = await L.prisma.blackjackGame.findUniqueOrThrow({ where: { id: game.id } })
    expect(row.status).toBe('SETTLED')
    expect(row.activeKey).toBeNull()
    // A late Hit on the timed-out hand changes nothing.
    expect(await L.blackjack.blackjackAction(user, game.id, 'hit', { now: later })).toMatchObject({ ok: true, stale: true })
    await expectBlackjackSettledOnce(user)
    await expectLedgerConsistent(user)
  }, 60_000)

  it(`${N} parallel grant-items runs grant a holding once`, async () => {
    const user = uid()
    const item = await L.prisma.shopItem.create({ data: { name: `it-grant-${RUN}`, price: 1337, quantity: 0 } })
    const [row] = await L.grants.planGrants([{ line: 1, discordId: user, item: `IT grant ${RUN}`, qty: 3 }])
    expect(row.status).toBe('grant')
    const res = await Promise.all(Array.from({ length: N }, () => L.grants.applyGrant(row)))
    expect(res.filter(Boolean)).toHaveLength(1)
    const inv = await L.prisma.inventory.findUniqueOrThrow({ where: { userId_itemId: { userId: user, itemId: item.id } } })
    expect(inv.quantity).toBe(3)
    expect((await L.grants.planGrants([{ line: 1, discordId: user, item: `it-grant-${RUN}`, qty: 3 }]))[0].status).toBe('already_granted')
    expect((await L.grants.planGrants([{ line: 1, discordId: user, item: `it-grant-${RUN}`, qty: 4 }]))[0].status).toBe('conflict')
    // Stock is untouched (holdings were bought in UnbelievaBoat).
    expect((await L.prisma.shopItem.findUniqueOrThrow({ where: { id: item.id } })).quantity).toBe(0)
  }, 60_000)

  // ---- Admin money: /add-money, /remove-money ----

  const ADMIN = '900000000000000001'

  it(`${N} parallel /remove-money calls can't overdraw: exactly the wallet comes out`, async () => {
    const user = await seedUser(1000)
    const res = await Promise.allSettled(Array.from({ length: N }, () => L.admin.adminRemoveMoney(ADMIN, user, 100, 'race test')))
    expect(res.filter((r) => r.status === 'rejected')).toEqual([])
    const values = res.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof L.admin.adminRemoveMoney>>>).value)
    expect(values.filter((v) => v.ok).length).toBe(10)
    expect(values.filter((v) => !v.ok && v.reason === 'insufficient').length).toBe(10)
    expect(await wallet(user)).toBe(0)
    const rows = await ledger(user)
    expect(rows.length).toBe(10)
    for (const r of rows) {
      expect(r.type).toBe('ADMIN_REMOVE')
      expect(r.amount).toBe(-100)
      expect(r.metadata).toEqual({ adminId: ADMIN, reason: 'race test', source: 'discord' })
    }
    await expectLedgerConsistent(user)
  }, 60_000)

  it(`/remove-money with an uneven amount stops short of 0 instead of going negative`, async () => {
    const user = await seedUser(250)
    const res = await Promise.all(Array.from({ length: N }, () => L.admin.adminRemoveMoney(ADMIN, user, 100, 'race test')))
    expect(res.filter((v) => v.ok).length).toBe(2)
    expect(await wallet(user)).toBe(50)
    // Refusals report the balance left at the time (50 once both removals landed).
    expect(res.filter((v) => !v.ok).every((v) => v.balance === 50 || v.balance === 150 || v.balance === 250)).toBe(true)
    await expectLedgerConsistent(user)
  }, 60_000)

  it(`${N} parallel /add-money calls all land, each with an ADMIN_GRANT row`, async () => {
    const user = await seedUser(5)
    const res = await Promise.allSettled(Array.from({ length: N }, (_, i) => L.admin.adminAddMoney(ADMIN, user, i + 1, `grant ${i + 1}`)))
    expect(res.filter((r) => r.status === 'rejected')).toEqual([])
    expect(await wallet(user)).toBe(5 + (N * (N + 1)) / 2)
    const rows = await ledger(user)
    expect(rows.map((r: any) => r.type)).toEqual(Array(N).fill('ADMIN_GRANT'))
    expect(rows.map((r: any) => r.metadata.reason).sort()).toEqual(Array.from({ length: N }, (_, i) => `grant ${i + 1}`).sort())
    expect(rows.every((r: any) => r.metadata.adminId === ADMIN && r.amount > 0)).toBe(true)
    await expectLedgerConsistent(user)
  }, 60_000)

  it('/add-money creates User + Economy for a member with no wallet; /remove-money never creates one', async () => {
    const fresh = uid()
    touched.set(fresh, 0)
    expect(await L.admin.adminAddMoney(ADMIN, fresh, 314, 'welcome bonus')).toEqual({ ok: true, amount: 314, balance: 314 })
    expect(await L.prisma.user.findUnique({ where: { id: fresh } })).not.toBeNull()
    const [row] = await ledger(fresh)
    expect(row).toMatchObject({ type: 'ADMIN_GRANT', amount: 314, balance: 314, metadata: { adminId: ADMIN, reason: 'welcome bonus' } })
    expect(row.description).toContain('welcome bonus')

    const nobody = uid()
    expect(await L.admin.adminRemoveMoney(ADMIN, nobody, 1, 'nothing there')).toEqual({ ok: false, reason: 'insufficient', balance: 0 })
    expect(await L.prisma.economy.findUnique({ where: { id: nobody } })).toBeNull()

    // The lib re-validates (the handler isn't the only line of defence).
    await expect(L.admin.adminAddMoney(ADMIN, fresh, 0, 'zero')).rejects.toThrow(/positive/)
    await expect(L.admin.adminAddMoney(ADMIN, fresh, 10_001, 'too much')).rejects.toThrow(/at most/)
    await expect(L.admin.adminRemoveMoney(ADMIN, fresh, 5, 'no')).rejects.toThrow(/Reason/)
  }, 60_000)

  it('every touched wallet reconciles with the ledger', async () => {
    await settle()
    for (const id of touched.keys()) await expectLedgerConsistent(id)
  }, 60_000)

  async function runReconcile(): Promise<any[]> {
    const sql = readFileSync(resolve(process.cwd(), 'scripts/pep-reconcile.sql'), 'utf8')
    const statements = sql
      .split(/;\s*$/m)
      .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean)
    expect(statements.length).toBeGreaterThan(10)
    const out: any[] = []
    for (const stmt of statements) {
      expect(stmt, 'reconcile script must be read-only').toMatch(/^(SELECT|WITH)\b/i)
      out.push(...((await L.prisma.$queryRawUnsafe(stmt)) as any[]))
    }
    return out
  }

  it('scripts/pep-reconcile.sql runs and flags nothing for the test users', async () => {
    const ids = new Set(touched.keys())
    const rows = await runReconcile()
    // No error-severity row may belong to a user this suite touched.
    expect(rows.filter((r) => r.severity === 'error' && r.user_id && ids.has(r.user_id))).toEqual([])
    expect(rows.some((r) => r.check_name === 'summary')).toBe(true)
  }, 60_000)

  it('scripts/pep-reconcile.sql detects injected corruption', async () => {
    // Drift: a wallet change with no ledger row.
    const drift = await seedUser(0)
    const other = await seedUser(100)
    await L.economy.transfer(other, drift, 10)
    await L.prisma.economy.update({ where: { id: drift }, data: { wallet: { increment: 5 } } })
    // Negative wallet.
    const negative = await seedUser(0)
    await L.prisma.economy.update({ where: { id: negative }, data: { wallet: -7 } })
    // Duplicate mission reward + orphan ledger row.
    const dup = await seedUser(0)
    for (let i = 0; i < 2; i++) {
      await L.prisma.$transaction((tx: any) => L.economy.creditInTx(tx, dup, 69, 'MISSION_REWARD', 'Mission reward: Level 1', { level: 1 }))
    }
    const orphan = uid()
    await L.prisma.transaction.create({ data: { userId: orphan, type: 'JOB_REWARD', amount: 1, balance: 1, description: 'x' } })
    // Admin rows with the wrong sign.
    const badSign = await seedUser(0)
    await L.prisma.transaction.create({ data: { userId: badSign, type: 'ADMIN_REMOVE', amount: 5, balance: 5, description: 'x' } })
    await L.prisma.transaction.create({ data: { userId: badSign, type: 'ADMIN_GRANT', amount: -5, balance: 0, description: 'x' } })

    const rows = await runReconcile()
    const has = (check: string, user: string) => rows.some((r) => r.check_name === check && r.user_id === user)
    expect(has('wallet_vs_ledger', drift)).toBe(true)
    expect(has('negative_wallet', negative)).toBe(true)
    expect(has('mission_reward_duplicate', dup)).toBe(true)
    expect(has('orphan_transaction', orphan)).toBe(true)
    expect(rows.filter((r) => r.check_name === 'amount_sign' && r.user_id === badSign).map((r) => r.type).sort()).toEqual(['ADMIN_GRANT', 'ADMIN_REMOVE'])
    const summary = rows.find((r) => r.check_name === 'summary')
    expect(Number(summary.minted_admin)).toBeGreaterThan(0)
    expect(Number(summary.burned_admin)).toBeGreaterThan(0)

    // Clean up so later runs against a kept DB stay quiet.
    await L.prisma.transaction.deleteMany({ where: { userId: { in: [drift, other, dup, orphan, badSign] } } })
    await L.prisma.economy.updateMany({ where: { id: { in: [drift, negative, dup, other, badSign] } }, data: { wallet: 0 } })
    for (const id of [drift, negative, dup, other, badSign]) touched.set(id, 0)
  }, 60_000)
})
