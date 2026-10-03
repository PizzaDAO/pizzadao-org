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
//   * /rob and the games: cooldowns hold under races, robbing conserves PEP,
//     stakes can't overdraw
//   * /remove-money can't take a wallet below 0, however many race
//   * mission verification: parallel runVerifiers for one member (and racing
//     human approvals) pay each level exactly once, hold what needs a human
//     release, and never override a rejection
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
  getUserRoles: vi.fn().mockResolvedValue([]),
  lookupGuildMembership: vi.fn().mockResolvedValue({ status: 'unknown' }),
  sendDM: vi.fn().mockResolvedValue({ success: false, error: 'discord_not_configured' }),
}))
// Never reach the members sheet from the engine (memberId is passed in).
vi.mock('./sheets/member-repository', () => ({ fetchMemberIdByDiscordId: vi.fn().mockResolvedValue(null) }))

/* eslint-disable @typescript-eslint/no-explicit-any */
type Libs = {
  prisma: any
  economy: typeof import('./economy')
  shop: typeof import('./shop')
  bounties: typeof import('./bounties')
  missions: typeof import('./missions')
  jobs: typeof import('./jobs')
  income: typeof import('./pep-earn/income')
  rob: typeof import('./pep-earn/rob')
  roulette: typeof import('./pep-games/roulette')
  slots: typeof import('./pep-games/slots')
  blackjack: typeof import('./pep-games/blackjack')
  grants: typeof import('./shop-grants')
  admin: typeof import('./pep-admin')
  celebration: typeof import('./celebration')
  engine: typeof import('./mission-verify/engine')
  policy: typeof import('./mission-verify/policy')
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
    process.env.PEP_ROB_ENABLED = '1'
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
      rob: await import('./pep-earn/rob'),
      roulette: await import('./pep-games/roulette'),
      slots: await import('./pep-games/slots'),
      blackjack: await import('./pep-games/blackjack'),
      grants: await import('./shop-grants'),
      admin: await import('./pep-admin'),
      celebration: await import('./celebration'),
      engine: await import('./mission-verify/engine'),
      policy: await import('./mission-verify/policy'),
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
    const row = await L.prisma.missionCompletion.findUniqueOrThrow({ where: { id: first.id }, include: { events: true } })
    expect(row).toMatchObject({ status: 'PENDING', reviewedBy: null, reviewNote: null, reviewedAt: null, attempts: 2 })
    // The rejection is kept once, in the audit trail (one RESUBMITTED event).
    expect(row.events.map((e: any) => e.action).sort()).toEqual(['REJECTED', 'RESUBMITTED', 'SUBMITTED'])
    const { memberNotes, history } = L.missions.reviewHistory(row.notes, row.events)
    expect(memberNotes).toBe('second')
    expect(history).toHaveLength(1)
    expect(history[0]).toMatch(/^Attempt 1 rejected .* by reviewer \| note: blurry \| evidence: https:\/\/one$/)
    await L.prisma.missionCompletion.delete({ where: { id: first.id } })
    await L.prisma.mission.update({ where: { id: mission.id }, data: { isActive: false } })
  }, 60_000)

  // ---- Mission verification Phase 1 (runVerifiers + settleLevels) ----

  const runAll = (user: string, missionIds: number[], extra: Record<string, unknown> = {}) =>
    Promise.allSettled(
      Array.from({ length: N }, () =>
        L.engine.runVerifiers(user, { trigger: 'on_demand', enabled: true, memberId: null, missionIds, ...extra }),
      ),
    )
  let xSeq = 0
  const linkX = (discordId: string) =>
    L.prisma.xAccount.create({ data: { discordId, xId: `it-x-${RUN}-${++xSeq}`, xUsername: `it${xSeq}`, accessToken: 'enc' } })
  // Isolated bottom levels: payouts go in level order, so the test missions
  // sit at level 1 / 2 (unique index) and are deactivated afterwards.
  const missionAt = (level: number, title: string, verifierKey: string | null, verifierParams: object | null, reward: number) =>
    L.prisma.mission.create({
      data: { level, index: 5000 + (Number(RUN) % 100000) + ++xSeq, title, reward, verifierKey, verifierParams: verifierParams ?? undefined },
    })
  const deactivate = (ids: number[]) => L.prisma.mission.updateMany({ where: { id: { in: ids } }, data: { isActive: false } })

  it(`${N} parallel runVerifiers on one member approve once and pay the level once`, async () => {
    const m = await missionAt(1, 'it link X', 'x_linked', {}, 69)
    const user = await seedUser(0)
    await linkX(user)
    const res = await runAll(user, [m.id])
    expect(res.filter((r) => r.status === 'rejected')).toEqual([])
    await settle()
    const rows = await L.prisma.missionCompletion.findMany({ where: { discordId: user }, include: { events: true } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'APPROVED', reviewedBy: 'auto:x_linked', source: 'AUTO' })
    expect(rows[0].events.filter((e: any) => e.action === 'AUTO_APPROVED')).toHaveLength(1)
    const paid = res.flatMap((r) => (r.status === 'fulfilled' ? r.value.levelsPaid : []))
    expect(paid).toEqual([1]) // exactly one run paid it
    expect(await wallet(user)).toBe(69)
    await expectLedgerConsistent(user)
    await deactivate([m.id])
  }, 60_000)

  it('parallel runVerifiers racing human approvals pay each level exactly once, in order', async () => {
    const a = await missionAt(1, 'it link X 2', 'x_linked', {}, 69)
    const b = await missionAt(2, 'it call', 'attendance_count', { min: 1 }, 420)
    const c = await missionAt(2, 'it manual', null, null, 420)
    const user = await seedUser(0)
    await linkX(user)
    await L.prisma.callAttendance.create({
      data: { discordId: user, crewId: 'community_call', crewLabel: 'Community Call', callDate: new Date(), dailySheetId: `it-sheet-${RUN}-${user}` },
    })
    const pending = await L.prisma.missionCompletion.create({ data: { missionId: c.id, discordId: user, status: 'PENDING' } })
    const res = await Promise.allSettled([
      ...Array.from({ length: N }, () =>
        L.engine.runVerifiers(user, { trigger: 'on_demand', enabled: true, memberId: null, missionIds: [a.id, b.id] }),
      ),
      ...Array.from({ length: N }, () => L.missions.approveMission('capo-it', pending.id)),
    ])
    expect(res.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(N + 1) // one approval wins
    await settle()
    // A last settle catches the case where the approval landed after every run settled.
    await L.missions.settleLevels(user)
    expect(await wallet(user)).toBe(69 + 420)
    const rewards = await L.prisma.transaction.findMany({ where: { userId: user, type: 'MISSION_REWARD' }, orderBy: { id: 'asc' } })
    expect(rewards.map((t: any) => t.metadata.level)).toEqual([1, 2])
    await expectLedgerConsistent(user)
    await deactivate([a.id, b.id, c.id])
  }, 60_000)

  it(`${N} parallel runs for a Discord account under 30 days hold once for a human release and pay nothing`, async () => {
    const m = await missionAt(1, 'it young', 'x_linked', {}, 69)
    const young = L.policy.snowflakeAt(new Date(Date.now() - 2 * 86_400_000), Number(RUN) % 4096)
    await L.prisma.user.create({ data: { id: young, roles: [] } })
    await L.prisma.economy.create({ data: { id: young, wallet: 0 } })
    touched.set(young, 0)
    await linkX(young)
    await runAll(young, [m.id])
    await settle()
    const rows = await L.prisma.missionCompletion.findMany({ where: { discordId: young }, include: { events: true } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'PENDING', holdReason: 'NEW_ACCOUNT', source: 'AUTO' })
    expect(rows[0].events.map((e: any) => e.action)).toEqual(['AUTO_HELD'])
    expect(await wallet(young)).toBe(0)
    // A reviewer releases it: paid exactly once even if released concurrently.
    await Promise.allSettled(Array.from({ length: N }, () => L.missions.approveMission('capo-it', rows[0].id)))
    await settle()
    expect(await wallet(young)).toBe(69)
    const after = await L.prisma.missionReviewEvent.findMany({ where: { completionId: rows[0].id } })
    expect(after.filter((e: any) => e.action === 'RELEASED')).toHaveLength(1)
    await expectLedgerConsistent(young)
    await deactivate([m.id])
  }, 60_000)

  it(`${N} parallel runs never override a human rejection: reopened for review once, nothing paid`, async () => {
    const m = await missionAt(1, 'it rejected', 'x_linked', {}, 69)
    const user = await seedUser(0)
    await linkX(user)
    const c = await L.prisma.missionCompletion.create({
      data: { missionId: m.id, discordId: user, status: 'REJECTED', reviewedBy: 'capo-it', reviewNote: 'no', reviewedAt: new Date() },
    })
    await runAll(user, [m.id])
    await settle()
    const row = await L.prisma.missionCompletion.findUniqueOrThrow({ where: { id: c.id }, include: { events: true } })
    expect(row).toMatchObject({ status: 'PENDING', holdReason: 'PREVIOUSLY_REJECTED' })
    expect(row.events.map((e: any) => e.action)).toEqual(['REOPENED'])
    expect(await wallet(user)).toBe(0)
    await deactivate([m.id])
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

  // ---- UnbelievaBoat replacement: /pay, /collect-income, /rob, games, item grants ----

  const OLD_JOIN = { robberJoinedAt: new Date('2020-01-01'), victimJoinedAt: new Date('2020-01-01') }
  const WIN = () => 0 // rob: success, minimum percent
  const LOSE = () => 0.99 // rob: caught, maximum fine percent

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

  it(`${N} robbers on one victim: one attempt (victim cooldown), PEP conserved, both sides ledgered`, async () => {
    const victim = await seedUser(2000)
    const robbers = await Promise.all(Array.from({ length: N }, () => seedUser(1000)))
    const res = await Promise.all(robbers.map((r) => L.rob.attemptRob(r, victim, OLD_JOIN, { rng: WIN })))
    const ok = res.filter((r) => r.ok)
    expect(ok).toHaveLength(1)
    expect(res.filter((r) => !r.ok && r.reason === 'victim_cooldown')).toHaveLength(N - 1)
    expect(ok[0]).toMatchObject({ outcome: 'success', amount: 100, percent: 5 })
    const total = (await wallet(victim)) + (await Promise.all(robbers.map(wallet))).reduce((s, w) => s + w, 0)
    expect(total).toBe(2000 + N * 1000)
    expect(await wallet(victim)).toBe(1900)
    await expectLedgerConsistent(victim)
    for (const r of robbers) await expectLedgerConsistent(r)
    expect((await ledger(victim)).map((r: any) => r.type)).toEqual(['ROB_LOSS'])
  }, 60_000)

  it(`one robber on ${N} victims: one attempt (robber cooldown); a failed rob fines the robber to the victim`, async () => {
    const robber = await seedUser(1000)
    const victims = await Promise.all(Array.from({ length: N }, () => seedUser(500)))
    const res = await Promise.all(victims.map((v) => L.rob.attemptRob(robber, v, OLD_JOIN, { rng: LOSE })))
    const ok = res.filter((r) => r.ok)
    expect(ok).toHaveLength(1)
    expect(ok[0]).toMatchObject({ outcome: 'caught', amount: 250, percent: 25 })
    expect(await wallet(robber)).toBe(750)
    const sum = (await Promise.all(victims.map(wallet))).reduce((s, w) => s + w, 0)
    expect(sum).toBe(N * 500 + 250)
    await expectLedgerConsistent(robber)
    for (const v of victims) await expectLedgerConsistent(v)
    expect((await ledger(robber)).map((r: any) => [r.type, r.amount])).toEqual([['ROB_FINE', -250]])
  }, 60_000)

  it('members robbing each other at the same time neither deadlock nor lose PEP', async () => {
    const pairs = await Promise.all(Array.from({ length: N / 2 }, async () => [await seedUser(1000), await seedUser(1000)]))
    const res = await Promise.allSettled(
      pairs.flatMap(([a, b]) => [L.rob.attemptRob(a, b, OLD_JOIN), L.rob.attemptRob(b, a, OLD_JOIN)]),
    )
    expect(res.filter((r) => r.status === 'rejected')).toEqual([])
    for (const [a, b] of pairs) {
      expect((await wallet(a)) + (await wallet(b))).toBe(2000)
      await expectLedgerConsistent(a)
      await expectLedgerConsistent(b)
    }
  }, 60_000)

  it('rob refuses: self, bots, new members, poor robbers/victims, peace mode', async () => {
    const rich = await seedUser(1000)
    const poor = await seedUser(100)
    const target = await seedUser(1000)
    const r = (a: string, b: string, ctx: any = OLD_JOIN) => L.rob.attemptRob(a, b, ctx, { rng: WIN })
    expect(await r(rich, rich)).toMatchObject({ reason: 'self' })
    expect(await r(rich, target, { ...OLD_JOIN, victimIsBot: true })).toMatchObject({ reason: 'bot' })
    expect(await r(rich, target, { ...OLD_JOIN, victimJoinedAt: new Date() })).toMatchObject({ reason: 'victim_new' })
    expect(await r(rich, target, { ...OLD_JOIN, robberJoinedAt: new Date() })).toMatchObject({ reason: 'robber_new' })
    expect(await r(poor, target)).toMatchObject({ reason: 'robber_poor', min: 500 })
    expect(await r(rich, poor)).toMatchObject({ reason: 'victim_poor', min: 200 })
    expect(await r(rich, uid())).toMatchObject({ reason: 'victim_poor' })

    // Peace mode: N parallel toggles change it once; then the member can't be robbed.
    const toggles = await Promise.all(Array.from({ length: N }, () => L.rob.setPeaceMode(target, true)))
    expect(toggles.filter((t) => t.ok && t.changed)).toHaveLength(1)
    expect(await r(rich, target)).toMatchObject({ reason: 'victim_peace' })
    expect(await L.rob.setPeaceMode(target, false)).toMatchObject({ ok: false, reason: 'cooldown' })
    const later = new Date(Date.now() + 25 * 3_600_000)
    expect(await L.rob.setPeaceMode(target, false, { now: later })).toMatchObject({ ok: true, changed: true })
    // Just left peace mode: can't rob until the toggle cooldown passes.
    expect(await L.rob.attemptRob(target, rich, OLD_JOIN, { now: later })).toMatchObject({ reason: 'peace_recent' })
    // Robbed recently: can't hide in peace mode right after.
    expect(await r(rich, target)).toMatchObject({ ok: true })
    expect(await L.rob.setPeaceMode(rich, true)).toMatchObject({ ok: false, reason: 'robbed_recently' })
    // Refusals write nothing.
    expect(await ledger(poor)).toEqual([])
    for (const id of [rich, poor, target]) await expectLedgerConsistent(id)
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
