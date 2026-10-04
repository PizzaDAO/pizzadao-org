// @vitest-environment node
// checkMany() and its helpers. The real engine runs against a mocked Prisma:
// these tests pin the flag-off (dry) behaviour, the batch prefetch, and the
// payout projection. The real writes and payouts are exercised against
// Postgres in pep-economy.concurrency.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db')
vi.mock('../notifications', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../mission-cache', () => ({ invalidateProgressCache: vi.fn() }))
vi.mock('../sheets/member-repository', () => ({
  fetchMemberIdByDiscordId: vi.fn(async () => null),
  getSheetData: vi.fn(async () => ({ discordToMember: new Map() })),
}))
vi.mock('../missions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../missions')>()
  return { ...actual, settleLevels: vi.fn(async () => []), notifyReviewers: vi.fn(async () => undefined) }
})

import { prisma } from '../db'
import { settleLevels } from '../missions'
import {
  batchSources,
  buildCatalog,
  checkMany,
  compareDiscordIds,
  listGuildMemberRoles,
  membersAfter,
  projectPayouts,
  type BatchData,
  type BulkContext,
} from './bulk'
import { snowflakeAt } from './policy'
import type { VerifierSources } from './types'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>
const NOW = new Date('2026-10-03T12:00:00Z')
const OLD_A = snowflakeAt(new Date('2021-01-01T00:00:00Z'), 1)
const OLD_B = snowflakeAt(new Date('2021-01-01T00:00:00Z'), 2)
const YOUNG = snowflakeAt(new Date('2026-09-25T00:00:00Z'), 3)
const MAFIA = '823266914834841610'

const MISSIONS = [
  { id: 1, level: 1, index: 0, title: 'Link X', reward: 69, verifierKey: 'x_linked', verifierParams: {} },
  { id: 2, level: 2, index: 0, title: 'Say hi', reward: 420, verifierKey: 'attendance_count', verifierParams: { min: 1 } },
  { id: 3, level: 2, index: 1, title: 'Post', reward: 420, verifierKey: null, verifierParams: null },
  { id: 6, level: 6, index: 0, title: 'Pepperoni Mafia', reward: 6942, verifierKey: 'discord_role', verifierParams: { roleIds: [MAFIA] } },
]
const catalog = buildCatalog(MISSIONS)

describe('projectPayouts (what settleLevels would pay)', () => {
  const levels = catalog.levels
  it('pays complete levels in order and stops at the first incomplete one', () => {
    expect(projectPayouts(levels, new Set([1, 2, 6]), new Set()).map((l) => l.level)).toEqual([1]) // L2.1 missing
    expect(projectPayouts(levels, new Set([1, 2, 3]), new Set()).map((l) => l.level)).toEqual([1, 2])
    expect(projectPayouts(levels, new Set([1, 2, 3, 6]), new Set()).map((l) => l.level)).toEqual([1, 2, 6])
  })
  it('skips levels already paid (a paid level counts as complete)', () => {
    expect(projectPayouts(levels, new Set([2, 3]), new Set([1])).map((l) => l.level)).toEqual([2])
    expect(projectPayouts(levels, new Set([1, 2, 3]), new Set([1, 2])).map((l) => l.level)).toEqual([])
  })
  it('a banked higher level is not paid while a lower one is incomplete', () => {
    expect(projectPayouts(levels, new Set([6]), new Set())).toEqual([])
  })
  it('a level with no reward pays nothing but does not block the next one', () => {
    const l = buildCatalog([
      { ...MISSIONS[0], reward: 0 },
      { ...MISSIONS[1], reward: 420 },
    ]).levels
    expect(projectPayouts(l, new Set([1, 2]), new Set()).map((x) => x.level)).toEqual([2])
  })
})

describe('member ordering and the cursor', () => {
  it('sorts Discord ids numerically, de-duplicates and drops non-snowflakes', () => {
    const ids = ['200000000000000000', '99999999999999999', 'abc', '100000000000000000', '200000000000000000', '1234']
    expect(membersAfter(ids, null)).toEqual(['99999999999999999', '100000000000000000', '200000000000000000'])
    expect(compareDiscordIds('99999999999999999', '100000000000000000')).toBeLessThan(0)
  })
  it('returns only members strictly after the cursor', () => {
    const ids = ['99999999999999999', '100000000000000000', '200000000000000000']
    expect(membersAfter(ids, '100000000000000000')).toEqual(['200000000000000000'])
    expect(membersAfter(ids, '200000000000000000')).toEqual([])
  })
})

describe('listGuildMemberRoles', () => {
  const env = { DISCORD_GUILD_ID: 'g', DISCORD_BOT_TOKEN: 't' } as unknown as NodeJS.ProcessEnv
  const page = (n: number, start: number) =>
    Array.from({ length: n }, (_, i) => ({ user: { id: String(BigInt("100000000000000000") + BigInt(start + i)) }, roles: i % 2 ? [MAFIA] : [] }))
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

  it('reads every page (1,000 per page) into id -> roles', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok(page(1000, 0))).mockResolvedValueOnce(ok(page(3, 1000)))
    const map = await listGuildMemberRoles(fetchImpl as unknown as typeof fetch, env)
    expect(map?.size).toBe(1003)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(String(fetchImpl.mock.calls[1][0])).toContain(`after=${BigInt("100000000000000000") + BigInt(999)}`)
  })

  it('waits out a 429 and retries', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 0.01 }), { status: 429 }))
      .mockResolvedValueOnce(ok(page(2, 0)))
    const sleep = vi.fn(async () => {})
    expect((await listGuildMemberRoles(fetchImpl as unknown as typeof fetch, env, sleep))?.size).toBe(2)
    expect(sleep).toHaveBeenCalledWith(10)
  })

  it('returns null (unknown) when any page fails: a partial list must never flag anyone', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok(page(1000, 0))).mockResolvedValueOnce(new Response('', { status: 500 }))
    expect(await listGuildMemberRoles(fetchImpl as unknown as typeof fetch, env)).toBeNull()
    expect(await listGuildMemberRoles(vi.fn().mockRejectedValue(new Error('net')) as unknown as typeof fetch, env)).toBeNull()
  })

  it('returns null without Discord credentials', async () => {
    expect(await listGuildMemberRoles(vi.fn() as unknown as typeof fetch, {} as NodeJS.ProcessEnv)).toBeNull()
  })
})

describe('batchSources', () => {
  const base = { getMemberRoles: vi.fn(), countWallets: vi.fn() } as unknown as VerifierSources
  const data: BatchData = {
    x: new Map([[OLD_A, { xUsername: 'alice' }]]),
    calls: new Map([[OLD_A, { total: 3, byCrew: { ops: 2, community_call: 1 } }]]),
    wallets: new Map([[OLD_A, 2]]),
    approved: new Map(),
    paidLevels: new Map(),
    legacyAuto: [],
    vouches: new Map([['m-a', [{ followeeId: 'm-b', source: 'PIZZADAO', createdAt: new Date(0) }]]]),
  }
  it('answers from the prefetch, never per member upstream', async () => {
    const s = batchSources(base, data, new Map([[OLD_A, [MAFIA]]]))
    expect(await s.getXAccount(OLD_A)).toEqual({ xUsername: 'alice' })
    expect(await s.getXAccount(OLD_B)).toBeNull()
    expect(await s.countCallsAttended(OLD_A)).toEqual({ total: 3, calls: 3, byCrew: { ops: 2, community_call: 1 } })
    expect(await s.countCallsAttended(OLD_B)).toEqual({ total: 0, calls: 0, byCrew: {} })
    expect(await s.countWallets(OLD_A, null)).toBe(2)
    expect(await s.getMemberRoles(OLD_A)).toEqual([MAFIA])
    expect(await s.getMemberRoles(OLD_B)).toEqual([]) // not in the (complete) listing = not in the guild
    expect(base.getMemberRoles).not.toHaveBeenCalled()
    expect(await s.getVouchesGiven('m-a')).toEqual([{ followeeId: 'm-b', source: 'PIZZADAO', createdAt: new Date(0) }])
    expect(await s.getVouchesGiven('m-z')).toEqual([])
  })
  it('roles are unknown (null) when there is no complete guild listing', async () => {
    expect(await batchSources(base, data, null).getMemberRoles(OLD_A)).toBeNull()
  })
})

describe('checkMany', () => {
  type Row = { id: number; missionId: number; discordId: string; status: string; source: string; holdReason: string | null; reviewedBy: string | null; flaggedAt: Date | null; evidence: string | null }
  let rows: Row[]
  const ctx = (over: Partial<BulkContext> = {}): BulkContext => ({ catalog, guildRoles: new Map([[OLD_B, [MAFIA]]]), memberIds: null, ...over })

  beforeEach(() => {
    vi.clearAllMocks()
    rows = []
    mockFn(prisma.xAccount.findMany).mockResolvedValue([
      { discordId: OLD_A, xUsername: 'alice' },
      { discordId: OLD_B, xUsername: 'bob' },
      { discordId: YOUNG, xUsername: 'young' },
    ])
    mockFn(prisma.callAttendance.groupBy).mockResolvedValue([{ discordId: OLD_A, crewId: 'ops', _count: { _all: 1 } }])
    mockFn(prisma.memberWallet.findMany).mockResolvedValue([])
    mockFn(prisma.transaction.findMany).mockResolvedValue([])
    mockFn(prisma.missionCompletion.findMany).mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      const ids = (where.discordId as { in?: string[] })?.in
      const one = typeof where.discordId === 'string' ? where.discordId : null
      return rows.filter((r) => (ids ? ids.includes(r.discordId) : r.discordId === one) && (!where.status || r.status === where.status))
    })
  })

  it('flag off: reports what WOULD happen and writes nothing (no completion, no event, no payout)', async () => {
    // OLD_B already has L2.1 approved by a reviewer and holds the Pepperoni Mafia role.
    rows.push({ id: 50, missionId: 3, discordId: OLD_B, status: 'APPROVED', source: 'MANUAL', holdReason: null, reviewedBy: 'capo', flaggedAt: null, evidence: null })
    mockFn(prisma.callAttendance.groupBy).mockResolvedValue([
      { discordId: OLD_A, crewId: 'ops', _count: { _all: 1 } },
      { discordId: OLD_B, crewId: 'community_call', _count: { _all: 2 } },
    ])
    const out = await checkMany([OLD_A, OLD_B, YOUNG], { trigger: 'cron', enabled: false, now: NOW, ctx: ctx() })

    expect(prisma.missionCompletion.create).not.toHaveBeenCalled()
    expect(prisma.missionCompletion.updateMany).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(settleLevels).not.toHaveBeenCalled()

    const [a, b, y] = out
    expect(a.report?.dryRun).toBe(true)
    expect(a.report?.checks.map((c) => [c.missionId, c.outcome])).toEqual([
      [1, 'would_approve'],
      [2, 'would_approve'],
      [6, 'not_yet'],
    ])
    expect(a.payouts).toEqual([{ level: 1, reward: 69 }]) // L2 still needs the manual L2.1
    expect(b.payouts).toEqual([
      { level: 1, reward: 69 },
      { level: 2, reward: 420 },
    ])
    expect(b.report?.checks.find((c) => c.missionId === 6)).toMatchObject({ outcome: 'would_hold', holdReason: 'HIGH_LEVEL' })
    expect(y.report?.checks.find((c) => c.missionId === 1)).toMatchObject({ outcome: 'would_hold', holdReason: 'NEW_ACCOUNT' })
    expect(y.payouts).toEqual([])
  })

  it('one query per table per batch, however many members', async () => {
    await checkMany([OLD_A, OLD_B, YOUNG], { trigger: 'cron', enabled: false, now: NOW, ctx: ctx() })
    expect(prisma.xAccount.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.callAttendance.groupBy).toHaveBeenCalledTimes(1)
    expect(prisma.memberWallet.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.transaction.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.mission.findMany).not.toHaveBeenCalled() // the catalog is passed in
  })

  it('a dry stateful re-check reports would-flag for a lost role, without writing', async () => {
    rows.push({ id: 60, missionId: 6, discordId: OLD_A, status: 'APPROVED', source: 'MANUAL', holdReason: null, reviewedBy: 'capo', flaggedAt: null, evidence: null })
    const [a] = await checkMany([OLD_A], { trigger: 'cron', enabled: false, now: NOW, ctx: ctx() })
    expect(a.report?.wouldFlag).toEqual([6])
    expect(prisma.missionCompletion.updateMany).not.toHaveBeenCalled()
  })

  it('no guild listing: role missions stay undecided (no hold, no flag)', async () => {
    rows.push({ id: 61, missionId: 6, discordId: OLD_A, status: 'APPROVED', source: 'MANUAL', holdReason: null, reviewedBy: 'capo', flaggedAt: null, evidence: null })
    const [a, b] = await checkMany([OLD_A, OLD_B], { trigger: 'cron', enabled: false, now: NOW, ctx: ctx({ guildRoles: null }) })
    expect(a.report?.wouldFlag).toEqual([])
    expect(b.report?.checks.find((c) => c.missionId === 6)?.result.status).toBe('unknown')
  })

  it('--max-level: only the listed missions are considered', async () => {
    const [a] = await checkMany([OLD_A], { trigger: 'backfill', dryRun: true, missionIds: [1], now: NOW, ctx: ctx() })
    expect(a.report?.checks.map((c) => c.missionId)).toEqual([1])
    expect(a.payouts).toEqual([{ level: 1, reward: 69 }])
  })

  it('auditLegacy: grandfathered no-proof approvals the new verifier would fail are reported, not touched', async () => {
    rows.push({ id: 70, missionId: 1, discordId: OLD_A, status: 'APPROVED', source: 'AUTO', holdReason: null, reviewedBy: 'auto', flaggedAt: null, evidence: null })
    mockFn(prisma.missionCompletion.findMany).mockImplementation(async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      if (select && 'reviewedBy' in select && (where.discordId as { in?: string[] })?.in) return rows.filter((r) => r.status === 'APPROVED')
      return rows.filter((r) => r.discordId === where.discordId)
    })
    mockFn(prisma.xAccount.findMany).mockResolvedValue([]) // no X linked any more
    const [a] = await checkMany([OLD_A], { trigger: 'backfill', dryRun: true, auditLegacy: true, now: NOW, ctx: ctx() })
    expect(a.legacyWouldFail).toEqual([{ missionId: 1, reason: 'No X account linked' }])
    expect(prisma.missionCompletion.updateMany).not.toHaveBeenCalled()
  })

  it('one member failing never fails the batch', async () => {
    mockFn(prisma.missionCompletion.findMany).mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.discordId === OLD_B) throw new Error('boom')
      return []
    })
    const out = await checkMany([OLD_A, OLD_B], { trigger: 'cron', enabled: false, now: NOW, ctx: ctx() })
    expect(out[0].error).toBeUndefined()
    expect(out[1]).toMatchObject({ discordId: OLD_B, report: null, error: 'boom' })
  })
})
