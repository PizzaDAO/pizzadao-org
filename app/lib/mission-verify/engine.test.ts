// @vitest-environment node
// runVerifiers against an in-memory fake of the two tables it writes
// (MissionCompletion with its unique key and conditional updates, and
// MissionReviewEvent). Payout (settleLevels) is mocked here; the real
// race-safe payout is exercised in pep-economy.concurrency.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db')
vi.mock('../notifications', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../mission-cache', () => ({ invalidateProgressCache: vi.fn() }))
vi.mock('../sheets/member-repository', () => ({ fetchMemberIdByDiscordId: vi.fn(async () => 'm-1') }))
vi.mock('../missions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../missions')>()
  return {
    recordReviewEvent: actual.recordReviewEvent,
    rejectionSnapshot: actual.rejectionSnapshot,
    settleLevels: vi.fn(async () => []),
    notifyReviewers: vi.fn(async () => undefined),
  }
})

import { prisma } from '../db'
import { settleLevels, notifyReviewers } from '../missions'
import { createNotification } from '../notifications'
import { runVerifiers } from './engine'
import { snowflakeAt } from './policy'
import type { VerifierSources } from './types'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>
const NOW = new Date('2026-10-03T12:00:00Z')
const OLD = snowflakeAt(new Date('2021-01-01T00:00:00Z')) // years old
const YOUNG = snowflakeAt(new Date('2026-09-25T00:00:00Z')) // 8 days old
const MAFIA = '823266914834841610'

type Row = Record<string, unknown> & { id: number; missionId: number; discordId: string; status: string }
let rows: Row[]
let events: Array<Record<string, unknown>>
let nextId: number

const MISSIONS = [
  { id: 1, level: 1, index: 0, title: 'Link X', verifierKey: 'x_linked', verifierParams: {}, isActive: true },
  { id: 2, level: 2, index: 0, title: 'Say hi on a call', verifierKey: 'attendance_count', verifierParams: { min: 1 }, isActive: true },
  { id: 3, level: 2, index: 1, title: 'Post', verifierKey: null, verifierParams: null, isActive: true },
  { id: 6, level: 6, index: 0, title: 'Join Pepperoni Mafia', verifierKey: 'discord_role', verifierParams: { roleIds: [MAFIA] }, isActive: true },
  { id: 8, level: 8, index: 0, title: 'DPR', verifierKey: 'manual', verifierParams: null, isActive: true },
]

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>
      if ('in' in o) return (o.in as unknown[]).includes(row[k])
      if ('not' in o) return o.not === null ? row[k] != null : row[k] !== o.not
    }
    return (row[k] ?? null) === v
  })
}

function sources(over: Partial<VerifierSources> = {}): VerifierSources {
  return {
    getXAccount: vi.fn(async () => ({ xUsername: 'pizza' })),
    countCallsAttended: vi.fn(async () => ({ total: 0, calls: 0, byCrew: {} })),
    getMemberRoles: vi.fn(async () => []),
    resolveRoleIds: vi.fn(async () => []),
    guildId: () => null,
    resolveChannelId: vi.fn(async () => null),
    getChannelMessage: vi.fn(async () => null),
    getChannel: vi.fn(async () => null),
    countWallets: vi.fn(async () => 0),
    getReferrals: vi.fn(async () => []),
    sharedSignalKinds: vi.fn(async () => []),
    getFarcasterAccounts: vi.fn(async () => []),
    getTelegramUsername: vi.fn(async () => null),
    fetch: vi.fn(async () => { throw new Error("no network in tests") }) as unknown as typeof fetch,
    neynarApiKey: () => null,
    rsvPizzaApiUrl: () => "https://api.rsv.example",
    rsvPizzaServiceKey: () => null,
    getWalletAddresses: vi.fn(async () => []),
    ...over,
  }
}

const run = (discordId: string, over: Record<string, unknown> = {}) =>
  runVerifiers(discordId, { trigger: 'on_demand', now: NOW, enabled: true, memberId: 'm-1', sources: sources(), ...over })

beforeEach(() => {
  vi.clearAllMocks()
  rows = []
  events = []
  nextId = 100
  mockFn(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
  mockFn(prisma.mission.findMany).mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
    MISSIONS.filter((m) => {
      const vk = where.verifierKey as { not?: null; in?: string[] }
      if (vk?.in && !vk.in.includes(m.verifierKey as string)) return false
      if (vk && 'not' in vk && m.verifierKey == null) return false
      const ids = (where.id as { in?: number[] })?.in
      return !ids || ids.includes(m.id)
    }),
  )
  mockFn(prisma.missionCompletion.findMany).mockImplementation(async ({ where }: { where: { discordId: string; missionId: { in: number[] } } }) =>
    rows.filter((r) => r.discordId === where.discordId && where.missionId.in.includes(r.missionId)).map((r) => ({ ...r })),
  )
  mockFn(prisma.missionCompletion.findUnique).mockImplementation(
    async ({ where }: { where: { missionId_discordId: { missionId: number; discordId: string } } }) => {
      const k = where.missionId_discordId
      const r = rows.find((x) => x.missionId === k.missionId && x.discordId === k.discordId)
      return r ? { ...r } : null
    },
  )
  mockFn(prisma.missionCompletion.create).mockImplementation(async ({ data }: { data: Row }) => {
    if (rows.some((r) => r.missionId === data.missionId && r.discordId === data.discordId)) {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    }
    const row = { attempts: 1, flaggedAt: null, holdReason: null, evidence: null, ...data, id: nextId++ } as Row
    rows.push(row)
    return { id: row.id }
  })
  mockFn(prisma.missionCompletion.updateMany).mockImplementation(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const hit = rows.filter((r) => matches(r, where))
    for (const r of hit) Object.assign(r, data)
    return { count: hit.length }
  })
  mockFn(prisma.missionReviewEvent.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    events.push(data)
    return data
  })
})

const row = (missionId: number, discordId = OLD) => rows.find((r) => r.missionId === missionId && r.discordId === discordId)

describe('runVerifiers', () => {
  it('approves a pass as auto:<key> with one AUTO_APPROVED event, then settles levels', async () => {
    mockFn(settleLevels).mockResolvedValueOnce([1])
    const report = await run(OLD)
    expect(report.approved).toEqual([1])
    expect(report.levelsPaid).toEqual([1])
    expect(row(1)).toMatchObject({ status: 'APPROVED', reviewedBy: 'auto:x_linked', source: 'AUTO', holdReason: null, memberId: 'm-1' })
    expect(events).toEqual([expect.objectContaining({ completionId: row(1)!.id, actorId: 'auto:x_linked', action: 'AUTO_APPROVED', via: 'on_demand' })])
    expect(settleLevels).toHaveBeenCalledWith(OLD)
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'MISSION_APPROVED', recipientId: OLD, actorId: 'auto:x_linked' }))
    // Manual missions and missions with no verifier are never run.
    expect(report.checks.map((c) => c.missionId)).toEqual([1, 2, 6])
  })

  it('is idempotent: a second run writes nothing new', async () => {
    await run(OLD)
    const before = { rows: JSON.stringify(rows), events: events.length }
    const again = await run(OLD)
    expect(again.approved).toEqual([])
    expect(again.checks.find((c) => c.missionId === 1)?.outcome).toBe('already_approved')
    expect(JSON.stringify(rows)).toBe(before.rows)
    expect(events).toHaveLength(before.events)
    expect(prisma.missionCompletion.create).toHaveBeenCalledTimes(1)
  })

  it("approves the member's own PENDING submission when the verifier passes", async () => {
    rows.push({ id: 7, missionId: 2, discordId: OLD, status: 'PENDING', source: 'MANUAL', holdReason: null, attempts: 1 })
    const report = await run(OLD, { sources: sources({ countCallsAttended: vi.fn(async () => ({ total: 2, calls: 2, byCrew: {} })) }) })
    expect(report.approved).toContain(2)
    expect(row(2)).toMatchObject({ status: 'APPROVED', reviewedBy: 'auto:attendance_count', source: 'AUTO' })
  })

  it('a lost create race (row appeared concurrently) falls back to the conditional PENDING update', async () => {
    // findMany sees no row, but by the time we create, another run (or a submit) made one.
    mockFn(prisma.missionCompletion.create).mockImplementationOnce(async () => {
      rows.push({ id: 55, missionId: 1, discordId: OLD, status: 'PENDING', source: 'MANUAL', holdReason: null, attempts: 1 })
      throw Object.assign(new Error('dup'), { code: 'P2002' })
    })
    const report = await run(OLD, { missionIds: [1] })
    expect(report.approved).toEqual([1])
    expect(rows).toHaveLength(1)
    expect(row(1)).toMatchObject({ id: 55, status: 'APPROVED' })
    expect(events.filter((e) => e.action === 'AUTO_APPROVED')).toHaveLength(1)
  })

  it('a lost create race against a row another run already held writes nothing (one AUTO_HELD only)', async () => {
    mockFn(prisma.missionCompletion.create).mockImplementationOnce(async () => {
      rows.push({ id: 57, missionId: 1, discordId: YOUNG, status: 'PENDING', source: 'AUTO', holdReason: 'NEW_ACCOUNT', attempts: 1 })
      throw Object.assign(new Error('dup'), { code: 'P2002' })
    })
    const report = await run(YOUNG, { missionIds: [1] })
    expect(report.held).toEqual([])
    expect(report.checks[0].outcome).toBe('awaiting_release')
    expect(events).toEqual([])
    expect(prisma.missionCompletion.updateMany).not.toHaveBeenCalled()
  })

  it('a lost create race against an APPROVED row writes nothing', async () => {
    mockFn(prisma.missionCompletion.create).mockImplementationOnce(async () => {
      rows.push({ id: 56, missionId: 1, discordId: OLD, status: 'APPROVED', source: 'AUTO', holdReason: null, attempts: 1 })
      throw Object.assign(new Error('dup'), { code: 'P2002' })
    })
    const report = await run(OLD, { missionIds: [1] })
    expect(report.approved).toEqual([])
    expect(events).toEqual([])
  })

  describe('never overrides a human rejection', () => {
    const rejected = (source = 'MANUAL') => ({
      id: 9,
      missionId: 1,
      discordId: OLD,
      status: 'REJECTED',
      source,
      holdReason: null,
      attempts: 1,
      evidence: 'https://x.com/me',
      reviewedBy: 'capo-1',
      reviewNote: 'not linked',
      reviewedAt: new Date('2026-10-01T00:00:00Z'),
    })

    it('routes it back to review (PENDING, PREVIOUSLY_REJECTED hold) instead of approving', async () => {
      rows.push(rejected())
      const report = await run(OLD, { missionIds: [1] })
      expect(report.approved).toEqual([])
      expect(report.reopened).toEqual([1])
      expect(row(1)).toMatchObject({ status: 'PENDING', holdReason: 'PREVIOUSLY_REJECTED', source: 'AUTO', reviewedBy: null })
      expect(row(1)!.status).not.toBe('APPROVED')
      const ev = events.find((e) => e.action === 'REOPENED')!
      expect(ev).toMatchObject({ completionId: 9, actorId: 'auto:x_linked' })
      expect((ev.metadata as { previous: unknown }).previous).toMatchObject({ reviewedBy: 'capo-1', reviewNote: 'not linked' })
      expect(notifyReviewers).toHaveBeenCalled()
    })

    it('a reopened row is never auto-approved by later runs; a human must release it', async () => {
      rows.push(rejected())
      await run(OLD, { missionIds: [1] })
      const again = await run(OLD, { missionIds: [1] })
      expect(again.approved).toEqual([])
      expect(again.checks[0].outcome).toBe('awaiting_release')
      expect(row(1)!.status).toBe('PENDING')
    })

    it('rejected again after the reopen (source AUTO): the decision stands, no more reopening', async () => {
      rows.push(rejected('AUTO'))
      const report = await run(OLD, { missionIds: [1] })
      expect(report.reopened).toEqual([])
      expect(report.checks[0].outcome).toBe('rejected')
      expect(row(1)!.status).toBe('REJECTED')
      expect(events).toEqual([])
    })
  })

  describe('human release (D9)', () => {
    it('holds an L6+ pass for a release instead of approving it', async () => {
      const report = await run(OLD, { missionIds: [6], interactionRoles: [MAFIA] })
      expect(report.held).toEqual([6])
      expect(report.approved).toEqual([])
      expect(row(6)).toMatchObject({ status: 'PENDING', holdReason: 'HIGH_LEVEL', source: 'AUTO', reviewedBy: null })
      expect(events).toEqual([expect.objectContaining({ action: 'AUTO_HELD', actorId: 'auto:discord_role' })])
      expect(notifyReviewers).toHaveBeenCalled()
      // ...and leaves it alone afterwards.
      const again = await run(OLD, { missionIds: [6], interactionRoles: [MAFIA] })
      expect(again.checks[0].outcome).toBe('awaiting_release')
      expect(events).toHaveLength(1)
    })

    it('holds any pass for a Discord account younger than 30 days, and lifts it once the account is old enough', async () => {
      const report = await run(YOUNG, { missionIds: [1] })
      expect(report.held).toEqual([1])
      expect(row(1, YOUNG)).toMatchObject({ status: 'PENDING', holdReason: 'NEW_ACCOUNT' })

      const stillYoung = await run(YOUNG, { missionIds: [1], now: new Date('2026-10-20T00:00:00Z') })
      expect(stillYoung.checks[0].outcome).toBe('awaiting_release')

      const later = await run(YOUNG, { missionIds: [1], now: new Date('2026-11-01T00:00:00Z') })
      expect(later.approved).toEqual([1])
      expect(row(1, YOUNG)).toMatchObject({ status: 'APPROVED', holdReason: null, reviewedBy: 'auto:x_linked' })
    })
  })

  it('verifies out of order (banking): an L6 pass is recorded even at level 1', async () => {
    const report = await run(OLD, { interactionRoles: [MAFIA], sources: sources({ getXAccount: vi.fn(async () => null) }) })
    expect(report.held).toEqual([6])
    expect(row(1)).toBeUndefined()
  })

  it('fail and unknown results write nothing', async () => {
    const report = await run(OLD, {
      sources: sources({ getXAccount: vi.fn(async () => null), getMemberRoles: vi.fn(async () => null) }),
    })
    expect(report.checks.find((c) => c.missionId === 1)?.result.status).toBe('fail')
    expect(report.checks.find((c) => c.missionId === 6)?.result.status).toBe('unknown')
    expect(rows).toEqual([])
    expect(events).toEqual([])
  })

  it('flags a stateful APPROVED completion whose role is gone, never revokes, and unflags when it is back', async () => {
    rows.push({ id: 60, missionId: 6, discordId: OLD, status: 'APPROVED', source: 'AUTO', holdReason: null, flaggedAt: null, attempts: 1 })
    const lost = await run(OLD, { missionIds: [6], interactionRoles: [] })
    expect(lost.flagged).toEqual([6])
    expect(row(6)).toMatchObject({ status: 'APPROVED', flagReason: expect.any(String) })
    expect(row(6)!.flaggedAt).toBeInstanceOf(Date)
    expect(events.at(-1)).toMatchObject({ action: 'FLAGGED' })

    await run(OLD, { missionIds: [6], interactionRoles: [] }) // already flagged: no second event
    expect(events.filter((e) => e.action === 'FLAGGED')).toHaveLength(1)

    const back = await run(OLD, { missionIds: [6], interactionRoles: [MAFIA] })
    expect(back.unflagged).toEqual([6])
    expect(row(6)).toMatchObject({ status: 'APPROVED', flaggedAt: null })
  })

  it('MISSION_VERIFIERS_ENABLED off (the default): a dry run that reports and writes nothing', async () => {
    delete process.env.MISSION_VERIFIERS_ENABLED
    const report = await runVerifiers(OLD, { trigger: 'on_demand', now: NOW, memberId: null, sources: sources(), interactionRoles: [MAFIA] })
    expect(report).toMatchObject({ enabled: false, dryRun: true, approved: [], levelsPaid: [] })
    expect(report.checks.find((c) => c.missionId === 1)?.outcome).toBe('would_approve')
    expect(report.checks.find((c) => c.missionId === 6)?.outcome).toBe('would_hold')
    expect(rows).toEqual([])
    expect(settleLevels).not.toHaveBeenCalled()
  })

  it('reports bad verifierParams and skips that mission', async () => {
    mockFn(prisma.mission.findMany).mockResolvedValueOnce([{ ...MISSIONS[1], verifierParams: { min: -1 } }])
    const report = await run(OLD)
    expect(report.errors[0]).toMatch(/bad verifierParams/)
    expect(rows).toEqual([])
  })
})
