import { describe, it, expect, vi, beforeEach } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any */

const h = vi.hoisted(() => ({ prisma: null as any }))
vi.mock('@/app/lib/db', () => ({ get prisma() { return h.prisma } }))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/app/lib/sheets-import/source', () => ({ usesDb: vi.fn(async () => true) }))

import { loadMembersPayload, memberValueRows } from './db-table'
import { nextMemberId } from '@/app/lib/member-registration'
import { upsertMemberInDb } from './writer'
import { dropMerged, protectMergedRow } from '@/app/lib/sheets-import/members'

const HEADERS = ['ID', 'Name', 'Status', 'Discord ID']
const row = (id: string, discord = '') => [{ v: id }, { v: `n${id}` }, { v: 'Active' }, discord ? { v: discord } : null]

function makePrisma(members: Array<{ id: string; cells: any[]; mergedInto?: string | null; position?: number }>) {
  const rows = members.map((m, i) => ({ position: i, mergedInto: null, updatedAt: new Date(), ...m }))
  const matchWhere = (w: any = {}) => (r: any) => !('mergedInto' in w) || (w.mergedInto === null ? r.mergedInto === null : r.mergedInto !== null)
  const member = {
    findMany: vi.fn(async ({ where }: any = {}) => rows.filter(matchWhere(where))),
    aggregate: vi.fn(async () => ({ _max: { position: 10 } })),
    create: vi.fn(async ({ data }: any) => { rows.push({ position: 0, mergedInto: null, updatedAt: new Date(), ...data }) }),
    update: vi.fn(async () => ({})),
  }
  const p: any = {
    member,
    memberTableLayout: { findUnique: vi.fn(async () => ({ id: 1, headers: HEADERS, updatedAt: new Date() })) },
    $executeRaw: vi.fn(),
    $transaction: async (fn: any) => fn(p),
  }
  return p
}

beforeEach(() => {
  h.prisma = makePrisma([
    { id: '1', cells: row('1', '111111') },
    { id: '2', cells: row('2', ''), mergedInto: '1' },
  ])
})

describe('merged-away ids stay taken', () => {
  it('id allocation sees tombstones, display loads do not', async () => {
    const shown = memberValueRows(await loadMembersPayload())
    expect(shown.slice(1).map((r) => r[0])).toEqual(['1'])
    const all = memberValueRows(await loadMembersPayload({ includeMerged: true }))
    expect(all.slice(1).map((r) => r[0])).toEqual(['1', '2'])
    expect(nextMemberId(all, '999999')).toBe('3')
    // Without tombstones the removed id would be handed out again.
    expect(nextMemberId(shown, '999999')).toBe('2')
  })

  it('a rename to a tombstoned id is refused', async () => {
    const res = await upsertMemberInDb({ memberId: '2', discordId: '111111', name: 'x' } as any, 'test')
    expect(res.ok).toBe(false)
    expect((res as any).error).toMatch(/already used/)
  })

  it('a signup that carries a tombstoned id is refused', async () => {
    const res = await upsertMemberInDb({ memberId: '2', discordId: '555555', name: 'new person', source: 'onboarding' } as any, 'test')
    expect(res.ok).toBe(false)
    expect(h.prisma.member.create).not.toHaveBeenCalled()
  })
})

describe('sheet import and merged members', () => {
  it('drops sheet rows for merged-away members', () => {
    const kept = dropMerged([{ key: '1' }, { key: '2' }, { key: '3' }], new Set(['2']))
    expect(kept.map((r) => r.key)).toEqual(['1', '3'])
  })

  it("never overwrites the keeper's Discord cell from the sheet", () => {
    const current = { discordId: '111111', cells: row('1', '111111') as any }
    const stale = row('1', '999999') as any
    const out = protectMergedRow(HEADERS, stale, current)
    expect(out.discordId).toBe('111111')
    expect((out.cells[3] as any).v).toBe('111111')
    const blank = protectMergedRow(HEADERS, row('1', '') as any, current)
    expect(blank.discordId).toBe('111111')
    expect((blank.cells[3] as any).v).toBe('111111')
  })

  it('leaves the incoming row alone when the keeper has no Discord id', () => {
    const out = protectMergedRow(HEADERS, row('1', '999999') as any, { discordId: null, cells: row('1') as any })
    expect(out.discordId).toBe('999999')
  })
})
