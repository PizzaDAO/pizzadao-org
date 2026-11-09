import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/* eslint-disable @typescript-eslint/no-explicit-any */

// A tiny in-memory database: just enough of the Prisma delegate API for the merge.
type Row = Record<string, any>
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('has' in v) return Array.isArray(row[k]) && row[k].includes(v.has)
      if ('in' in v) return v.in.includes(row[k])
      if ('gte' in v) return row[k] >= v.gte
    }
    return row[k] === v
  })
}
function delegate(rows: Row[], pk: string[] = ['id']) {
  let seq = 1000
  const keyMatch = (w: Row) => (r: Row) => matches(r, w)
  return {
    rows,
    findUnique: async ({ where }: any) => rows.find(keyMatch(where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter(keyMatch(where ?? {})).map((r) => ({ ...r })),
    count: async ({ where }: any = {}) => rows.filter(keyMatch(where ?? {})).length,
    update: async ({ where, data }: any) => {
      const r = rows.find(keyMatch(where))
      if (!r) throw new Error('not found')
      for (const [k, v] of Object.entries(data) as [string, any][]) r[k] = v && typeof v === 'object' && 'increment' in v ? r[k] + v.increment : v
      return r
    },
    updateMany: async ({ where, data }: any) => {
      const hit = rows.filter(keyMatch(where))
      for (const r of hit) {
        for (const [k, v] of Object.entries(data) as [string, any][]) {
          r[k] = v && typeof v === 'object' && 'increment' in v ? r[k] + v.increment : v && typeof v === 'object' && 'decrement' in v ? r[k] - v.decrement : v
        }
      }
      return { count: hit.length }
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex(keyMatch(where))
      if (i >= 0) rows.splice(i, 1)
    },
    deleteMany: async ({ where }: any) => {
      let n = 0
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) { rows.splice(i, 1); n++ }
      return { count: n }
    },
    create: async ({ data }: any) => { const r = { id: ++seq, ...data }; rows.push(r); return r },
    upsert: async ({ where, create }: any) => {
      const r = rows.find(keyMatch(where))
      if (r) return r
      const c = { ...create }
      rows.push(c)
      return c
    },
    _pk: pk,
  }
}

const state = vi.hoisted(() => ({ db: null as any }))
vi.mock('@/app/lib/db', () => ({ get prisma() { return state.db } }))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('./../transactions', () => ({
  logTransaction: vi.fn(async (tx: any, userId: string, type: string, amount: number, description: string, metadata: unknown) => {
    tx.transaction.rows.push({ userId, type, amount, description, metadata })
  }),
}))

vi.mock('@/app/lib/sheets-import/source', () => ({ usesDb: vi.fn(async () => true) }))

import { usesDb } from '@/app/lib/sheets-import/source'
import { mergeMembers, unmergeMembers, MergeError, TABLES, VOUCH_MODEL, PK_OVERRIDES } from './merge'

function makeDb() {
  const d = (name: string) => delegate([], [name])
  const models: Record<string, any> = {}
  const names = new Set<string>([...TABLES.map((t) => t.model), VOUCH_MODEL, 'Member', 'MemberMerge', 'Economy', 'User', 'Transaction', 'MemberTableLayout'])
  for (const n of names) models[n.charAt(0).toLowerCase() + n.slice(1)] = d(n)
  const executed: string[] = []
  const db: any = {
    ...models,
    $executeRaw: async (strings: TemplateStringsArray, ...vals: unknown[]) => { executed.push(strings.join('?') + vals.join(',')) },
    $queryRaw: async () => [],
    $transaction: async (fn: any) => fn(db),
    executed,
  }
  return db
}

const KEEP = '1001'
const GONE = '2002'
const D_KEEP = 'discord-keep-1'
const D_GONE = 'discord-gone-2'

let db: any
beforeEach(() => {
  db = makeDb()
  state.db = db
  db.member.rows.push(
    { id: KEEP, discordId: D_KEEP, name: 'Keep', cells: [], mergedInto: null },
    { id: GONE, discordId: D_GONE, name: 'Gone', cells: [], mergedInto: null },
  )
})

const find = (rep: any, table: string, column: string) => rep.tables.find((t: any) => t.table === table && t.column === column)

describe('mergeMembers input checks', () => {
  it('rejects same ids, missing members and already merged members', async () => {
    await expect(mergeMembers({ keepId: KEEP, removeId: KEEP })).rejects.toBeInstanceOf(MergeError)
    await expect(mergeMembers({ keepId: KEEP, removeId: '9999' })).rejects.toThrow(/not found/)
    db.member.rows[1].mergedInto = '5555'
    await expect(mergeMembers({ keepId: KEEP, removeId: GONE })).rejects.toThrow(/already merged/)
  })
})

describe('dry run', () => {
  it('reports counts and collisions and writes nothing', async () => {
    db.profileLink.rows.push({ id: 1, memberId: GONE }, { id: 2, memberId: GONE })
    db.vouch.rows.push({ id: 1, followerId: GONE, followeeId: 'X' }, { id: 2, followerId: KEEP, followeeId: 'X' })
    db.economy.rows.push({ id: D_GONE, wallet: 70 }, { id: D_KEEP, wallet: 5 })
    const before = JSON.stringify(db.member.rows) + JSON.stringify(db.vouch.rows) + JSON.stringify(db.profileLink.rows)
    const rep = await mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: true })
    expect(rep.dryRun).toBe(true)
    expect(find(rep, 'ProfileLink', 'memberId').moved).toBe(2)
    expect(find(rep, 'Vouch', 'followerId')).toMatchObject({ moved: 0, dropped: 1 })
    expect(rep.pep).toEqual({ moved: 70, fromDiscordId: D_GONE, toDiscordId: D_KEEP })
    expect(JSON.stringify(db.member.rows) + JSON.stringify(db.vouch.rows) + JSON.stringify(db.profileLink.rows)).toBe(before)
    expect(db.memberMerge.rows).toHaveLength(0)
    expect(db.economy.rows.find((r: any) => r.id === D_GONE).wallet).toBe(70)
  })

  it('is the default when dryRun is omitted', async () => {
    db.profileLink.rows.push({ id: 1, memberId: GONE })
    const rep = await mergeMembers({ keepId: KEEP, removeId: GONE })
    expect(rep.dryRun).toBe(true)
    expect(db.profileLink.rows[0].memberId).toBe(GONE)
  })
})

describe('apply', () => {
  it('re-points plain rows and tombstones the removed member', async () => {
    db.profileLink.rows.push({ id: 1, memberId: GONE })
    db.referral.rows.push({ id: 1, inviterMemberId: GONE, inviteeMemberId: 'Z' })
    const invalidate = vi.fn()
    const rep = await mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: false, actor: 'tester' }, { invalidate })
    expect(db.profileLink.rows[0].memberId).toBe(KEEP)
    expect(db.referral.rows[0].inviterMemberId).toBe(KEEP)
    const gone = db.member.rows.find((m: any) => m.id === GONE)
    expect(gone).toMatchObject({ mergedInto: KEEP, discordId: null })
    expect(gone.mergedAt).toBeInstanceOf(Date)
    expect(db.member.rows.find((m: any) => m.id === KEEP).discordId).toBe(D_KEEP)
    expect(db.memberMerge.rows).toHaveLength(1)
    expect(db.memberMerge.rows[0]).toMatchObject({ keepId: KEEP, removeId: GONE, actor: 'tester' })
    expect(invalidate).toHaveBeenCalledOnce()
    expect(db.executed.length).toBe(2) // both advisory locks
    expect(rep.totals.moved).toBeGreaterThanOrEqual(2)
  })

  it('drops duplicate vouches and self-vouches, moves the rest', async () => {
    db.vouch.rows.push(
      { id: 1, followerId: GONE, followeeId: 'A' }, // keep has it too -> drop
      { id: 2, followerId: KEEP, followeeId: 'A' },
      { id: 3, followerId: GONE, followeeId: 'B' }, // move
      { id: 4, followerId: GONE, followeeId: KEEP }, // self-vouch -> drop
      { id: 5, followerId: 'C', followeeId: GONE }, // move
      { id: 6, followerId: 'D', followeeId: GONE }, // keep has it too -> drop
      { id: 7, followerId: 'D', followeeId: KEEP },
    )
    const rep = await mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: false })
    expect(db.vouch.rows.map((r: any) => `${r.followerId}>${r.followeeId}`).sort()).toEqual(['C>1001', 'D>1001', '1001>A', '1001>B'].sort())
    expect(find(rep, 'Vouch', 'followerId')).toMatchObject({ moved: 1, dropped: 2 })
    expect(find(rep, 'Vouch', 'followeeId')).toMatchObject({ moved: 1, dropped: 1 })
    expect(rep.totals.collisions).toBe(3)
  })

  it('keeps one wallet, one social account per platform, and the earlier claim/first-seen', async () => {
    const early = new Date('2025-01-01'), late = new Date('2026-01-01')
    db.memberWallet.rows.push(
      { id: 1, memberId: GONE, walletAddress: '0xaa' },
      { id: 2, memberId: KEEP, walletAddress: '0xaa' },
      { id: 3, memberId: GONE, walletAddress: '0xbb' },
    )
    db.socialAccount.rows.push({ id: 1, memberId: GONE, platform: 'x' }, { id: 2, memberId: KEEP, platform: 'x' })
    db.taskClaimEvent.rows.push(
      { id: 1, memberId: GONE, taskKey: 't1', claimedAt: early },
      { id: 2, memberId: KEEP, taskKey: 't1', claimedAt: late },
      { id: 3, memberId: GONE, taskKey: 't2', claimedAt: late },
    )
    db.poapFirstSeen.rows.push({ id: 1, memberId: GONE, poapEventId: 9, firstSeenAt: late }, { id: 2, memberId: KEEP, poapEventId: 9, firstSeenAt: early })
    const rep = await mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: false })
    expect(db.memberWallet.rows.map((r: any) => `${r.memberId}:${r.walletAddress}`).sort()).toEqual(['1001:0xaa', '1001:0xbb'])
    expect(db.socialAccount.rows).toHaveLength(1)
    expect(db.socialAccount.rows[0].memberId).toBe(KEEP)
    expect(db.taskClaimEvent.rows.find((r: any) => r.taskKey === 't1')).toMatchObject({ memberId: KEEP, claimedAt: early })
    expect(db.taskClaimEvent.rows.find((r: any) => r.taskKey === 't2').memberId).toBe(KEEP)
    expect(db.poapFirstSeen.rows).toHaveLength(1)
    expect(db.poapFirstSeen.rows[0].firstSeenAt).toBe(early)
    expect(find(rep, 'MemberWallet', 'memberId').collisions).toHaveLength(1)
  })

  it('keeps the keeper row for one-per-member tables, moves it when the keeper has none', async () => {
    db.memberProfileExtras.rows.push({ id: 1, memberId: GONE }, { id: 2, memberId: KEEP })
    db.memberPfp.rows.push({ id: 3, memberId: GONE })
    const rep = await mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: false })
    expect(db.memberProfileExtras.rows.map((r: any) => r.memberId)).toEqual([KEEP])
    expect(db.memberPfp.rows.map((r: any) => r.memberId)).toEqual([KEEP])
    expect(find(rep, 'MemberProfileExtras', 'memberId')).toMatchObject({ dropped: 1 })
    expect(find(rep, 'MemberPfp', 'memberId')).toMatchObject({ moved: 1 })
  })

  it('replaces the id inside array columns without duplicates', async () => {
    db.article.rows.push({ id: 'a1', collaboratorMemberIds: [GONE, 'Q', KEEP] }, { id: 'a2', collaboratorMemberIds: ['Q', GONE] })
    await mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: false })
    expect(db.article.rows[0].collaboratorMemberIds).toEqual([KEEP, 'Q'])
    expect(db.article.rows[1].collaboratorMemberIds).toEqual(['Q', KEEP])
  })

  it('moves the Discord id (and its sheet cell) when the keeper has none', async () => {
    db.member.rows[0].discordId = null
    db.memberTableLayout.rows.push({ id: 1, headers: ['ID', 'Name', 'Discord'] })
    await mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: false })
    const keep = db.member.rows.find((m: any) => m.id === KEEP)
    expect(keep.discordId).toBe(D_GONE)
    expect(keep.cells[2]).toEqual({ v: D_GONE })
    expect(db.member.rows.find((m: any) => m.id === GONE).discordId).toBeNull()
  })

  it('sums PEP through the ledger with a MERGE memo', async () => {
    db.user.rows.push({ id: D_GONE }, { id: D_KEEP })
    db.economy.rows.push({ id: D_GONE, wallet: 70 }, { id: D_KEEP, wallet: 5 })
    const rep = await mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: false })
    expect(rep.pep?.moved).toBe(70)
    expect(db.economy.rows.find((r: any) => r.id === D_GONE).wallet).toBe(0)
    expect(db.economy.rows.find((r: any) => r.id === D_KEEP).wallet).toBe(75)
    expect(db.transaction.rows).toHaveLength(2)
    expect(db.transaction.rows.every((t: any) => t.description.startsWith('MERGE'))).toBe(true)
    expect(db.transaction.rows.map((t: any) => t.amount)).toEqual([-70, 70])
  })

  it('does not touch PEP when only the removed member had a Discord id', async () => {
    db.member.rows[0].discordId = null
    db.economy.rows.push({ id: D_GONE, wallet: 40 })
    const rep = await mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: false })
    expect(rep.pep).toBeNull()
    expect(db.transaction.rows).toHaveLength(0)
    expect(db.economy.rows[0].wallet).toBe(40)
  })

  it('refuses to run twice', async () => {
    await mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: false })
    await expect(mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: false })).rejects.toThrow(/already merged/)
  })
})

describe('safety and reversibility', () => {
  it('refuses unless members are read from the database', async () => {
    vi.mocked(usesDb).mockResolvedValueOnce(false)
    await expect(mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: false })).rejects.toThrow(/not read from the database/)
    expect(db.member.rows.find((m: any) => m.id === GONE).mergedInto).toBeNull()
  })

  it('blanks the tombstone Discord cell and uses the DiscordId header', async () => {
    db.memberTableLayout.rows.push({ id: 1, headers: ['ID', 'Discord ID', 'Name'] })
    db.member.rows[1].cells = [{ v: GONE }, { v: D_GONE }, { v: 'Gone' }]
    await mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: false })
    expect(db.member.rows[1].cells[1]).toBeNull()
  })

  it('stores undo data and the second pass catches rows inserted mid-merge', async () => {
    db.profileLink.rows.push({ id: 1, memberId: GONE })
    let first = true
    const orig = db.profileLink.updateMany
    db.profileLink.updateMany = async (a: any) => {
      const r = await orig(a)
      if (first) { first = false; db.profileLink.rows.push({ id: 2, memberId: GONE }) }
      return r
    }
    const rep = await mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: false })
    expect(db.profileLink.rows.map((r: any) => r.memberId)).toEqual([KEEP, KEEP])
    expect(find(rep, 'ProfileLink', 'memberId').moved).toBe(2)
    expect(db.memberMerge.rows[0].report.undo.moved.length).toBeGreaterThan(0)
  })

  it('round trip: unmerge restores moved rows, dropped rows, tombstone, discord and PEP', async () => {
    const early = new Date('2025-01-01'), late = new Date('2026-01-01')
    db.member.rows[0].discordId = null
    db.memberTableLayout.rows.push({ id: 1, headers: ['ID', 'Discord ID'] })
    db.member.rows[1].cells = [{ v: GONE }, { v: D_GONE }]
    db.profileLink.rows.push({ id: 1, memberId: GONE })
    db.vouch.rows.push({ id: 1, followerId: GONE, followeeId: 'A' }, { id: 2, followerId: KEEP, followeeId: 'A' }, { id: 3, followerId: GONE, followeeId: 'B' })
    db.taskClaimEvent.rows.push({ id: 1, memberId: GONE, taskKey: 't', claimedAt: early }, { id: 2, memberId: KEEP, taskKey: 't', claimedAt: late })
    db.memberProfileExtras.rows.push({ id: 1, memberId: GONE, bio: 'gone bio' }, { id: 2, memberId: KEEP, bio: 'keep bio' })
    db.memberPfp.rows.push({ id: 3, memberId: GONE })
    db.article.rows.push({ id: 'a1', collaboratorMemberIds: [GONE, 'Q'] })
    const before = JSON.stringify({ v: db.vouch.rows, t: db.taskClaimEvent.rows, e: db.memberProfileExtras.rows, p: db.memberPfp.rows, l: db.profileLink.rows, a: db.article.rows, m: db.member.rows })

    const rep = await mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: false })
    expect(db.vouch.rows).toHaveLength(2)
    const dry = await unmergeMembers(rep.mergeId!, { dryRun: true })
    expect(dry.dryRun).toBe(true)
    expect(db.member.rows[1].mergedInto).toBe(KEEP)

    const un = await unmergeMembers(rep.mergeId!, { dryRun: false, actor: 't' })
    expect(un.conflicts).toEqual([])
    const norm = (rows: any[]) => rows.map((r) => JSON.parse(JSON.stringify(r))).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))
    const afterObj = { v: db.vouch.rows, t: db.taskClaimEvent.rows, e: db.memberProfileExtras.rows, p: db.memberPfp.rows, l: db.profileLink.rows, a: db.article.rows, m: db.member.rows }
    const beforeObj = JSON.parse(before)
    for (const k of Object.keys(beforeObj)) {
      const strip = (rows: any[]) => rows.map((r) => { const c = { ...r }; delete c.updatedBy; delete c.mergedAt; return c })
      expect(norm(strip(afterObj[k as keyof typeof afterObj]))).toEqual(norm(strip(beforeObj[k])))
    }
    expect(db.member.rows[1].mergedInto).toBeNull()
    expect(db.memberMerge.rows[0].undoneAt).toBeInstanceOf(Date)
    await expect(unmergeMembers(rep.mergeId!, { dryRun: false })).rejects.toThrow(/already undone/)
  })

  it('round trip reverses the PEP transfer through the ledger', async () => {
    db.user.rows.push({ id: D_GONE }, { id: D_KEEP })
    db.economy.rows.push({ id: D_GONE, wallet: 70 }, { id: D_KEEP, wallet: 5 })
    const rep = await mergeMembers({ keepId: KEEP, removeId: GONE, dryRun: false })
    await unmergeMembers(rep.mergeId!, { dryRun: false })
    expect(db.economy.rows.find((r: any) => r.id === D_GONE).wallet).toBe(70)
    expect(db.economy.rows.find((r: any) => r.id === D_KEEP).wallet).toBe(5)
    expect(db.transaction.rows).toHaveLength(4)
    expect(db.transaction.rows.slice(2).every((t: any) => t.description.startsWith('UNMERGE'))).toBe(true)
  })

  it('flags both-kept in the report', async () => {
    const rep = await mergeMembers({ keepId: KEEP, removeId: GONE })
    expect(rep.discord.action).toBe('both-kept')
    expect(rep.notes.join(' ')).toMatch(/do NOT follow the merge/)
  })
})

describe('coverage of the schema', () => {
  it('PK_OVERRIDES match the schema', () => {
    const schema = readFileSync(join(__dirname, '../../../prisma/schema.prisma'), 'utf8')
    const models = new Set([...TABLES.map((t) => t.model), VOUCH_MODEL])
    let model = ''
    const pks: Record<string, string> = {}
    for (const line of schema.split('\n')) {
      const m = line.match(/^model (\w+)/)
      if (m) model = m[1]
      const f = line.match(/^\s+(\w+)\s+\S+.*@id\b/)
      if (f && models.has(model)) pks[model] = f[1]
    }
    for (const mdl of models) expect(PK_OVERRIDES[mdl] ?? 'id').toBe(pks[mdl])
  })

  // Member-id columns that are deliberately not merged: they hold a Discord id or a display name.
  const IGNORED = new Set(['ArticleReaction.memberId', 'MafiaRankCache.memberName', 'Proposal.proposerDiscordId', 'Proposal.proposerLabel', 'Vouch.followerId', 'Vouch.followeeId'])
  it('every member-id column in prisma/schema.prisma is handled or explicitly ignored', () => {
    const schema = readFileSync(join(__dirname, '../../../prisma/schema.prisma'), 'utf8')
    const handled = new Set([...TABLES.map((t) => `${t.model}.${t.field}`), ...IGNORED])
    const re = /^\s+(\w*(memberId|followerId|followeeId|memberKey|proposer|memberName)\w*)\s+\S+/i
    let model = ''
    const missing: string[] = []
    for (const line of schema.split('\n')) {
      const m = line.match(/^model (\w+)/)
      if (m) model = m[1]
      const f = line.match(re)
      if (f && model !== 'MemberMerge' && !handled.has(`${model}.${f[1]}`)) missing.push(`${model}.${f[1]}`)
    }
    expect(missing).toEqual([])
  })
})
