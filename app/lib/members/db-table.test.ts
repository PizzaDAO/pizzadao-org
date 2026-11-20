// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: { member: { findMany: vi.fn() }, memberTableLayout: { findUnique: vi.fn() } } }))

import { prisma } from '@/app/lib/db'
import { clearMembersRowMemo, loadMembersPayload, MEMBERS_FULL_RELOAD_MS } from './db-table'

const findMany = vi.mocked(prisma.member.findMany)
const t = (ms: number) => new Date(ms)

type Row = { id: string; cells: unknown[]; position: number; updatedAt: Date; mergedInto: string | null }
let table: Row[]

beforeEach(() => {
  clearMembersRowMemo()
  vi.mocked(prisma.memberTableLayout.findUnique).mockReset().mockResolvedValue({ id: 1, headers: ['ID', 'Name'], updatedAt: t(1) } as never)
  table = [
    { id: '1', cells: [{ v: '1' }, { v: 'A' }], position: 0, updatedAt: t(10), mergedInto: null },
    { id: '2', cells: [{ v: '2' }, { v: 'B' }], position: 1, updatedAt: t(20), mergedInto: null },
    { id: '3', cells: [{ v: '3' }, { v: 'C' }], position: 2, updatedAt: t(30), mergedInto: '1' },
  ]
  findMany.mockReset().mockImplementation((async (args: { where?: { id?: { in: string[] } }; select: Record<string, boolean> }) => {
    const ids = args.where?.id?.in
    const rows = ids ? table.filter((r) => ids.includes(r.id)) : table
    return rows.map((r) => Object.fromEntries(Object.keys(args.select).map((k) => [k, r[k as keyof Row]])))
  }) as never)
})

/** The ids whose cells a load fetched (the second, `in` query), or null when it fetched none. */
const fetchedIds = () => {
  const call = findMany.mock.calls.find(([a]) => (a as { where?: { id?: unknown } })?.where?.id)
  return call ? ((call[0] as { where: { id: { in: string[] } } }).where.id.in) : null
}

describe('loadMembersPayload (incremental)', () => {
  it('first load fetches every row once; merged rows only with includeMerged', async () => {
    const p = await loadMembersPayload()
    expect(p.rows.map((r) => r.id)).toEqual(['1', '2'])
    expect(p.rows[1].cells).toEqual([{ v: '2' }, { v: 'B' }])
    expect(p.version).toMatch(/^2:[0-9a-f]{16}$/)
    expect(fetchedIds()).toEqual(['1', '2', '3'])
    findMany.mockClear()
    const all = await loadMembersPayload({ includeMerged: true })
    expect(all.rows.map((r) => r.id)).toEqual(['1', '2', '3'])
    expect(fetchedIds()).toBeNull() // nothing changed: only the (id, updatedAt) probe ran
  })

  it('later loads fetch only the rows that changed or are new, and drop deleted ones', async () => {
    await loadMembersPayload()
    table[0] = { ...table[0], cells: [{ v: '1' }, { v: 'A2' }], updatedAt: t(40) }
    table.splice(1, 1) // member 2 deleted
    table.push({ id: '4', cells: [{ v: '4' }, { v: 'D' }], position: 3, updatedAt: t(50), mergedInto: null })
    findMany.mockClear()
    const p = await loadMembersPayload()
    expect(fetchedIds()).toEqual(['1', '4'])
    expect(p.rows.map((r) => [r.id, r.cells[1]])).toEqual([
      ['1', { v: 'A2' }],
      ['4', { v: 'D' }],
    ])
    expect(p.version).toMatch(/^2:[0-9a-f]{16}$/)
  })

  it('a member merged away since the last load leaves the default view', async () => {
    await loadMembersPayload()
    table[1] = { ...table[1], mergedInto: '1', updatedAt: t(60) }
    const p = await loadMembersPayload()
    expect(p.rows.map((r) => r.id)).toEqual(['1'])
  })

  it('an edit that kept its updatedAt is picked up by the full reload after MEMBERS_FULL_RELOAD_MS', async () => {
    const t0 = 10_000_000
    const first = await loadMembersPayload({ now: t0 })
    table[0] = { ...table[0], cells: [{ v: '1' }, { v: 'SQL edit' }] } // same updatedAt
    findMany.mockClear()
    const soon = await loadMembersPayload({ now: t0 + 60_000 })
    expect(soon.rows[0].cells[1]).toEqual({ v: 'A' }) // within the window: the memo
    expect(fetchedIds()).toBeNull()
    expect(soon.version).toBe(first.version)
    const later = await loadMembersPayload({ now: t0 + MEMBERS_FULL_RELOAD_MS + 1 })
    expect(later.rows[0].cells[1]).toEqual({ v: 'SQL edit' })
    expect(fetchedIds()).toEqual(['1', '2', '3'])
    expect(later.version).not.toBe(first.version) // the parsed-table memo is rebuilt too
  })

  it('a changed row missing from the second read is dropped, not served from the memo', async () => {
    await loadMembersPayload()
    const stamps = table.map((r) => ({ id: r.id, updatedAt: r.id === '2' ? t(99) : r.updatedAt, mergedInto: r.mergedInto }))
    findMany.mockImplementationOnce((async () => stamps) as never) // the probe sees 2 as changed...
    table.splice(1, 1) // ...and it is deleted before its cells are read
    const p = await loadMembersPayload()
    expect(p.rows.map((r) => r.id)).toEqual(['1'])
  })

  it('a merge flag that differs from the memo is refetched even with the same updatedAt', async () => {
    await loadMembersPayload()
    table[1] = { ...table[1], mergedInto: '1' } // same updatedAt
    findMany.mockClear()
    const p = await loadMembersPayload()
    expect(fetchedIds()).toEqual(['2'])
    expect(p.rows.map((r) => r.id)).toEqual(['1'])
  })

  it('the version changes when any row is edited, added, removed or merged, and not otherwise', async () => {
    const v0 = (await loadMembersPayload()).version
    expect((await loadMembersPayload()).version).toBe(v0)
    // Same count and same newest updatedAt (the old count:max key would not change).
    table[0] = { ...table[0], updatedAt: t(15) }
    const v1 = (await loadMembersPayload()).version
    expect(v1).not.toBe(v0)
    table[1] = { ...table[1], mergedInto: '1' }
    table[2] = { ...table[2], mergedInto: null }
    const v2 = (await loadMembersPayload()).version
    expect(v2).not.toBe(v1)
  })

  it('throws when the layout row is missing', async () => {
    vi.mocked(prisma.memberTableLayout.findUnique).mockResolvedValue(null as never)
    await expect(loadMembersPayload()).rejects.toThrow(/not imported/)
  })
})
