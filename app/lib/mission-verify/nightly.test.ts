// @vitest-environment node
// The nightly run driver: batching, the cursor, the time box, resuming across
// invocations, the lease, and flag-off (dry) behaviour. Storage and the
// per-batch work are in-memory fakes; the real engine + payouts against
// Postgres are in pep-economy.concurrency.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db')

import { driveRun, emptyStats, addOutcome, type RunRow, type RunStore, type RunStats } from './runs'
import { runNightlyMissions, MIN_GAP_MS, type NightlyDeps } from './nightly'
import type { BulkContext, MemberOutcome } from './bulk'
import type { RunReport, MissionCheck } from './engine'

// ---- an in-memory RunStore with the same semantics as prismaRunStore ----
function memoryStore() {
  const runs: RunRow[] = []
  const clone = (r: RunRow): RunRow => ({ ...r, stats: JSON.parse(JSON.stringify(r.stats)) })
  const store: RunStore & { runs: RunRow[] } = {
    runs,
    async findOpen(kind, since, dryRun) {
      const r = runs
        .filter((x) => x.kind === kind && !x.finishedAt && x.startedAt >= since && (dryRun === undefined || x.dryRun === dryRun))
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0]
      return r ? clone(r) : null
    },
    async latest(kind) {
      const r = runs.filter((x) => x.kind === kind).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0]
      return r ? clone(r) : null
    },
    async create(kind, dryRun, stats) {
      const r: RunRow = { id: runs.length + 1, kind, dryRun, startedAt: new Date(now), finishedAt: null, cursor: null, leaseUntil: null, stats }
      runs.push(r)
      return clone(r)
    },
    async claim(id, until, at) {
      const r = runs.find((x) => x.id === id)!
      if (r.finishedAt || (r.leaseUntil && r.leaseUntil >= at)) return false
      r.leaseUntil = until
      return true
    },
    async save(id, patch) {
      const r = runs.find((x) => x.id === id)!
      if (patch.cursor !== undefined) r.cursor = patch.cursor
      if (patch.stats) r.stats = JSON.parse(JSON.stringify(patch.stats))
      if (patch.finishedAt !== undefined) r.finishedAt = patch.finishedAt
      if (patch.leaseUntil !== undefined) r.leaseUntil = patch.leaseUntil
    },
  }
  return store
}

let now = Date.parse('2026-10-03T05:30:00Z')
const clock = () => now

const check = (missionId: number, outcome: MissionCheck['outcome'], level = 1): MissionCheck => ({
  missionId,
  level,
  index: 0,
  title: `m${missionId}`,
  verifierKey: 'x_linked',
  result: { status: 'pass', evidence: {} },
  outcome,
})

const report = (discordId: string, dryRun: boolean, over: Partial<RunReport> = {}): RunReport => ({
  discordId,
  enabled: !dryRun,
  dryRun,
  trigger: 'cron',
  checks: [],
  approved: [],
  held: [],
  reopened: [],
  flagged: [],
  unflagged: [],
  wouldFlag: [],
  wouldUnflag: [],
  levelsPaid: [],
  errors: [],
  ...over,
})

/** A fake checkMany: each member "passes" L1 (69 PEP); costs `costMs` of clock time per batch. */
function fakeBatch(costMs = 1000) {
  const calls: string[][] = []
  const fn = vi.fn(async (ids: string[], _ctx: BulkContext, dryRun: boolean): Promise<MemberOutcome[]> => {
    calls.push(ids)
    now += costMs
    return ids.map((discordId) => ({
      discordId,
      memberId: null,
      report: dryRun
        ? report(discordId, true, { checks: [check(1, 'would_approve')] })
        : report(discordId, false, { checks: [check(1, 'approved')], approved: [1], levelsPaid: [1] }),
      payouts: [{ level: 1, reward: 69 }],
      legacyWouldFail: [],
    }))
  })
  return { fn, calls }
}

const MEMBERS = Array.from({ length: 25 }, (_, i) => String(BigInt("100000000000000000") + BigInt(i * 7)))
const ctx: BulkContext = { catalog: { verifierMissions: [], levels: [], byId: new Map() }, guildRoles: null, memberIds: null }

function deps(store: RunStore, over: Partial<NightlyDeps> = {}): Partial<NightlyDeps> {
  return {
    store,
    clock,
    enabled: () => false,
    loadContext: async () => ctx,
    listMembers: async () => [...MEMBERS].reverse(), // unsorted on purpose: the driver sorts
    refreshSignals: vi.fn(async () => ({ total: 2, created: 1, removed: 0 })),
    announce: vi.fn(async () => {}),
    ...over,
  }
}

beforeEach(() => {
  now = Date.parse('2026-10-03T05:30:00Z')
})

describe('driveRun (batches, cursor, time box)', () => {
  it('processes members in batches and saves the cursor + stats after every batch', async () => {
    const store = memoryStore()
    const run = await store.create('nightly', true, emptyStats())
    const saves: Array<string | null | undefined> = []
    const orig = store.save
    store.save = async (id, patch) => {
      saves.push(patch.cursor)
      return orig(id, patch)
    }
    const { fn, calls } = fakeBatch(10)
    const res = await driveRun({ run, store, members: MEMBERS, processBatch: (ids) => fn(ids, ctx, true), batchSize: 10, budgetMs: 60_000, clock })
    expect(calls.map((c) => c.length)).toEqual([10, 10, 5])
    expect(res).toMatchObject({ done: true, processed: 25 })
    expect(saves.slice(0, 3)).toEqual([MEMBERS[9], MEMBERS[19], MEMBERS[24]])
    const saved = store.runs[0]
    expect(saved).toMatchObject({ cursor: MEMBERS[24], leaseUntil: null })
    expect(saved.finishedAt).not.toBeNull()
    expect(saved.stats).toMatchObject({ members: 25, wouldApprove: 25, wouldPayPep: 25 * 69, wouldPayLevels: { 1: 25 }, invocations: 1 })
  })

  it('stops before a batch that would not fit the budget, leaving the run open at the cursor', async () => {
    const store = memoryStore()
    const run = await store.create('nightly', true, emptyStats())
    const { fn } = fakeBatch(1000)
    // 1 s per batch, 3.4 s budget: before batch 2, 1 s + 1.5 x 1 s fits; before batch 3, 2 s + 1.5 s > 3.4 s -> stop.
    const res = await driveRun({ run, store, members: MEMBERS, processBatch: (ids) => fn(ids, ctx, true), batchSize: 5, budgetMs: 3_400, clock })
    expect(res).toMatchObject({ done: false, processed: 10 })
    expect(store.runs[0]).toMatchObject({ cursor: MEMBERS[9], finishedAt: null, leaseUntil: null })
  })

  it('always does at least one batch, and onBatch can stop the run (payout cap)', async () => {
    const store = memoryStore()
    const run = await store.create('backfill', false, emptyStats())
    const { fn } = fakeBatch(10_000)
    const res = await driveRun({
      run,
      store,
      members: MEMBERS,
      processBatch: (ids) => fn(ids, ctx, false),
      batchSize: 3,
      budgetMs: Infinity,
      clock,
      onBatch: (_b, stats) => stats.pepPaid <= 69 * 5, // stop once more than 5 levels were paid
    })
    expect(res).toMatchObject({ done: false, stopped: true, processed: 6 })
    expect(store.runs[0].finishedAt).toBeNull()
  })

  it('releases the lease and keeps the last good cursor when a batch throws', async () => {
    const store = memoryStore()
    const run = await store.create('nightly', true, emptyStats())
    await store.claim(run.id, new Date(now + 60_000), new Date(now))
    let n = 0
    await expect(
      driveRun({
        run,
        store,
        members: MEMBERS,
        processBatch: async (ids) => {
          if (++n === 2) throw new Error('db down')
          return fakeBatch(1).fn(ids, ctx, true)
        },
        batchSize: 10,
        budgetMs: 60_000,
        clock,
      }),
    ).rejects.toThrow('db down')
    expect(store.runs[0]).toMatchObject({ cursor: MEMBERS[9], leaseUntil: null, finishedAt: null })
  })
})

describe('runNightlyMissions', () => {
  it('flag off: a dry run that records what WOULD happen; nothing approved or paid', async () => {
    const store = memoryStore()
    const { fn } = fakeBatch(10)
    const d = deps(store, { processBatch: fn })
    const res = await runNightlyMissions({ budgetMs: 60_000, batchSize: 10, deps: d })
    expect(res).toMatchObject({ status: 'finished', dryRun: true, processed: 25, remaining: 0 })
    // every batch was asked for a dry run
    expect(fn.mock.calls.every((c) => c[2] === true)).toBe(true)
    const run = store.runs[0]
    expect(run).toMatchObject({ kind: 'nightly', dryRun: true })
    expect(run.stats).toMatchObject({ wouldApprove: 25, wouldPayPep: 25 * 69, approved: 0, pepPaid: 0, levelsPaid: {} })
    expect(run.stats.signals).toEqual({ total: 2, created: 1, removed: 0 })
    expect(d.announce).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }))
  })

  it('flag on: a live run (each batch told to write)', async () => {
    const store = memoryStore()
    const { fn } = fakeBatch(10)
    const res = await runNightlyMissions({ budgetMs: 60_000, batchSize: 10, deps: deps(store, { processBatch: fn, enabled: () => true }) })
    expect(res).toMatchObject({ status: 'finished', dryRun: false })
    expect(fn.mock.calls.every((c) => c[2] === false)).toBe(true)
    expect(store.runs[0].stats).toMatchObject({ approved: 25, pepPaid: 25 * 69, levelsPaid: { 1: 25 }, wouldApprove: 0 })
  })

  it('time-boxed: the next invocation resumes the same run from the cursor; nobody is processed twice', async () => {
    const store = memoryStore()
    const { fn, calls } = fakeBatch(1000)
    const d = deps(store, { processBatch: fn })
    const first = await runNightlyMissions({ budgetMs: 3_400, batchSize: 5, deps: d })
    expect(first).toMatchObject({ status: 'partial', processed: 10, remaining: 15 })
    now += 30 * 60_000 // the next vercel.json slot
    const second = await runNightlyMissions({ budgetMs: 3_400, batchSize: 5, deps: d })
    expect(second).toMatchObject({ status: 'partial', runId: first.status === 'partial' ? first.runId : -1, processed: 10, remaining: 5 })
    now += 30 * 60_000
    const third = await runNightlyMissions({ budgetMs: 60_000, batchSize: 5, deps: d })
    expect(third).toMatchObject({ status: 'finished', processed: 5, remaining: 0 })
    expect(store.runs).toHaveLength(1)
    expect(calls.flat()).toEqual(MEMBERS) // each member once, in numeric order
    expect(store.runs[0].stats).toMatchObject({ members: 25, invocations: 3 })
    // signals are refreshed once per run, not per invocation
    expect(d.refreshSignals).toHaveBeenCalledTimes(1)
    // the summary is posted once, when the run finishes
    expect(d.announce).toHaveBeenCalledTimes(1)
  })

  it('a later slot the same night finds the run finished and does nothing', async () => {
    const store = memoryStore()
    const { fn } = fakeBatch(10)
    await runNightlyMissions({ budgetMs: 60_000, batchSize: 50, deps: deps(store, { processBatch: fn }) })
    now += 30 * 60_000
    const again = await runNightlyMissions({ budgetMs: 60_000, batchSize: 50, deps: deps(store, { processBatch: fn }) })
    expect(again.status).toBe('already_ran')
    expect(fn).toHaveBeenCalledTimes(1)
    // ...and the next night starts a new run
    now += MIN_GAP_MS
    const next = await runNightlyMissions({ budgetMs: 60_000, batchSize: 50, deps: deps(store, { processBatch: fn }) })
    expect(next.status).toBe('finished')
    expect(store.runs).toHaveLength(2)
  })

  it('busy while another invocation holds the lease', async () => {
    const store = memoryStore()
    const run = await store.create('nightly', true, emptyStats())
    await store.claim(run.id, new Date(now + 300_000), new Date(now))
    const { fn } = fakeBatch(10)
    const res = await runNightlyMissions({ budgetMs: 60_000, deps: deps(store, { processBatch: fn }) })
    expect(res).toEqual({ status: 'busy', runId: run.id })
    expect(fn).not.toHaveBeenCalled()
  })

  it('an expired lease (crashed invocation) is taken over and the run resumes', async () => {
    const store = memoryStore()
    const run = await store.create('nightly', true, emptyStats())
    await store.claim(run.id, new Date(now - 1), new Date(now - 300_000))
    await store.save(run.id, { cursor: MEMBERS[19] })
    const { fn, calls } = fakeBatch(10)
    const res = await runNightlyMissions({ budgetMs: 60_000, deps: deps(store, { processBatch: fn }) })
    expect(res).toMatchObject({ status: 'finished', processed: 5 })
    expect(calls.flat()).toEqual(MEMBERS.slice(20))
  })

  it('turning the flag on mid-run closes the dry run and starts a live one from the beginning', async () => {
    const store = memoryStore()
    const { fn } = fakeBatch(1000)
    await runNightlyMissions({ budgetMs: 3_400, batchSize: 5, deps: deps(store, { processBatch: fn }) })
    now += 30 * 60_000
    const res = await runNightlyMissions({ budgetMs: 60_000, batchSize: 5, deps: deps(store, { processBatch: fn, enabled: () => true }) })
    expect(res).toMatchObject({ status: 'finished', dryRun: false, processed: 25 })
    expect(store.runs).toHaveLength(2)
    expect(store.runs[0].finishedAt).not.toBeNull()
    expect(store.runs[0].stats.closedReason).toMatch(/MISSION_VERIFIERS_ENABLED changed/)
  })
})

describe('addOutcome', () => {
  it('counts dry outcomes as would-*, live ones as done, and samples errors', () => {
    const s: RunStats = emptyStats()
    addOutcome(s, {
      discordId: '1',
      memberId: null,
      report: report('1', true, {
        checks: [check(1, 'would_approve'), check(2, 'would_hold', 6), { ...check(3, 'rejected'), result: { status: 'pass', evidence: {} } }],
        wouldFlag: [6],
        errors: ['mission 9: bad verifierParams'],
      }),
      payouts: [{ level: 1, reward: 69 }],
      legacyWouldFail: [],
    })
    addOutcome(s, {
      discordId: '2',
      memberId: null,
      report: report('2', false, { approved: [1, 2], held: [6], flagged: [6], levelsPaid: [1, 2] }),
      payouts: [
        { level: 1, reward: 69 },
        { level: 2, reward: 420 },
      ],
      legacyWouldFail: [],
    })
    addOutcome(s, { discordId: '3', memberId: null, report: null, error: 'boom', payouts: [], legacyWouldFail: [] })
    expect(s).toMatchObject({
      members: 3,
      wouldApprove: 1,
      wouldHold: 1,
      wouldReopen: 1,
      wouldFlag: 1,
      wouldPayPep: 69,
      wouldPayLevels: { 1: 1 },
      approved: 2,
      held: 1,
      flagged: 1,
      pepPaid: 489,
      levelsPaid: { 1: 1, 2: 1 },
      errors: 2,
    })
    expect(s.errorSamples).toEqual(['1: mission 9: bad verifierParams', '3: boom'])
  })
})
