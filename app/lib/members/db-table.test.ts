// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: { member: { findMany: vi.fn() }, memberTableLayout: { findUnique: vi.fn() } } }))

import { prisma } from '@/app/lib/db'
import { clearMembersRowMemo, loadMembersPayload } from './db-table'

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
    expect(p.version).toBe('2:20')
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
    expect(p.version).toBe('2:50')
  })

  it('a member merged away since the last load leaves the default view', async () => {
    await loadMembersPayload()
    table[1] = { ...table[1], mergedInto: '1', updatedAt: t(60) }
    const p = await loadMembersPayload()
    expect(p.rows.map((r) => r.id)).toEqual(['1'])
  })

  it('throws when the layout row is missing', async () => {
    vi.mocked(prisma.memberTableLayout.findUnique).mockResolvedValue(null as never)
    await expect(loadMembersPayload()).rejects.toThrow(/not imported/)
  })
})
