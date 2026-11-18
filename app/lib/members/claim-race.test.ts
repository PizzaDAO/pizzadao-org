/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ prisma: null as any }))
vi.mock('@/app/lib/db', () => ({ prisma: { $transaction: (...a: unknown[]) => h.prisma.$transaction(...a) } }))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/app/lib/sheets-import/source', () => ({ usesDb: vi.fn(async () => true), membersMirrorEnabled: vi.fn(async () => false) }))

import { postMemberWrite, upsertMemberInDb } from './writer'

const HEADERS = ['ID', 'Name', 'Status', 'Discord ID']
const row = (id: string, discord = '') => [{ v: id }, { v: `n${id}` }, { v: 'Active' }, discord ? { v: discord } : null]

/** In-memory Member table; transactions are serialized, as the advisory lock makes them in Postgres. */
function makePrisma(initial: Array<{ id: string; cells: any[] }>) {
  const rows = initial.map((m, i) => ({ position: i, mergedInto: null as string | null, ...m }))
  let chain: Promise<unknown> = Promise.resolve()
  const lockCalls: unknown[][] = []
  const tx: any = {
    member: {
      findMany: vi.fn(async ({ where }: any = {}) => {
        const snapshot = rows.filter((r) => (where?.mergedInto === null ? r.mergedInto === null : where?.mergedInto ? r.mergedInto !== null : true)).map((r) => ({ ...r }))
        await new Promise((r) => setTimeout(r, 5)) // widen the read-then-write window
        return snapshot
      }),
      aggregate: vi.fn(async () => ({ _max: { position: 10 } })),
      create: vi.fn(),
      update: vi.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id)!
        r.cells = data.cells
      }),
    },
    memberTableLayout: { findUnique: vi.fn(async () => ({ id: 1, headers: HEADERS })) },
    $executeRaw: vi.fn(async (_s: any, ...v: unknown[]) => { lockCalls.push(v); return 1 }),
  }
  const prisma: any = {
    $transaction: (fn: any) => {
      const run = chain.then(() => fn(tx))
      chain = run.catch(() => undefined)
      return run
    },
  }
  return { prisma, rows, lockCalls }
}

// vitest quirk: two dynamic imports of a mocked module in the same tick, the second gets the real module.
// Start the second racer a tick later; it still overlaps the first (whose transaction takes ~10ms).
const later = <T,>(fn: () => Promise<T>) => new Promise<T>((r) => setTimeout(() => r(fn()), 1))

const claim = (memberId: string, discordId: string, source = 'onboarding_claim') => ({ memberId, discordId, source, discordJoined: true })
const discordOf = (rows: Array<{ id: string; cells: any[] }>, id: string) => rows.find((r) => r.id === id)!.cells[3]?.v ?? ''

describe('member claims under the write lock', () => {
  let db: ReturnType<typeof makePrisma>
  beforeAll(async () => {
    // Warm the lazy imports so the racers below start together.
    h.prisma = makePrisma([{ id: '1', cells: row('1') }]).prisma
    await upsertMemberInDb(claim('1', 'warm'), 't')
    await postMemberWrite({ raw: claim('1', 'warm') })
  })
  beforeEach(() => {
    db = makePrisma([{ id: '1', cells: row('1') }, { id: '2', cells: row('2') }, { id: '3', cells: row('3', '999') }])
    h.prisma = db.prisma
  })

  it('two accounts claiming the same unlinked row: one wins, the other gets a conflict', async () => {
    const [a, b] = await Promise.all([upsertMemberInDb(claim('1', 'A'), 't'), later(() => upsertMemberInDb(claim('1', 'B'), 't'))])
    expect([a.ok, b.ok].sort()).toEqual([false, true])
    const loser = (a.ok ? b : a) as any
    expect(loser.conflict).toBe(true)
    expect(loser.error).toMatch(/already claimed/)
    // The first writer's Discord ID is kept, not overwritten.
    expect(discordOf(db.rows, '1')).toBe(a.ok ? 'A' : 'B')
    expect(db.lockCalls).toHaveLength(2)
  })

  it('one account claiming two rows at once: only one row is linked', async () => {
    const [a, b] = await Promise.all([upsertMemberInDb(claim('1', 'A'), 't'), later(() => upsertMemberInDb(claim('2', 'A', 'onboarding_auto_claim'), 't'))])
    expect([a.ok, b.ok].sort()).toEqual([false, true])
    expect(((a.ok ? b : a) as any).error).toMatch(/already linked/)
    expect(db.rows.filter((r) => discordOf(db.rows, r.id) === 'A')).toHaveLength(1)
  })

  it('re-claiming your own row is still fine (idempotent)', async () => {
    expect((await upsertMemberInDb(claim('3', '999'), 't')).ok).toBe(true)
  })

  it('refuses a row already linked to someone else', async () => {
    const res = (await upsertMemberInDb(claim('3', 'B'), 't')) as any
    expect(res.ok).toBe(false)
    expect(res.conflict).toBe(true)
  })

  it('postMemberWrite answers 409 for a lost claim race', async () => {
    const send = (id: string) => postMemberWrite({ source: 'onboarding_claim', memberId: '1', discordId: id, raw: claim('1', id) })
    const [a, b] = await Promise.all([send('A'), later(() => send('B'))])
    expect([a.status, b.status].sort()).toEqual([200, 409])
  })
})
