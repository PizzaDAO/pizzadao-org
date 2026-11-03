// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/api/lib/google-sheets', () => ({ getManualLinks: vi.fn(async () => ({})) }))

import type { GvizResponse } from '@/app/lib/gviz-parser'
import { parseAllowedPOAPIds } from '@/app/lib/poap'
import { parseNFTContracts } from '@/app/lib/nft-config'
import { parseManualsTable } from '@/app/lib/manuals'
import { manualRecords, manualRowKeys, manualsEditor, nftEditor, nftRecords, poapEditor, poapRecords } from './configs'
import { cleanRows, EditorError } from './editor'
import { planUpserts } from './plan'

const cell = (v: unknown) => ({ v })
const gviz = (cols: Array<{ label?: string; type?: string }>, rows: unknown[][]): GvizResponse =>
  ({ table: { cols, rows: rows.map((r) => ({ c: r.map((v) => (v === null ? null : cell(v))) })) } }) as unknown as GvizResponse

describe('POAP whitelist', () => {
  it('reads ids under a header, keeps sheet order, de-duplicates and flags bad cells', () => {
    const g = gviz([{}, {}], [['Name', 'POAP ID'], ['a', '111'], ['b', 222], ['c', 'n/a'], ['d', '111'], ['e', null]])
    const r = parseAllowedPOAPIds(g)
    expect(r).toEqual({ ids: ['111', '222'], badRows: [4], found: true })
  })

  it('records are keyed by event id; re-ordering only changes positions', () => {
    const db = new Map(poapRecords(['1', '2']).map((r) => [r.key, r.value]))
    const plan = planUpserts(poapRecords(['2', '1']), db)
    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(2)
    expect(planUpserts(poapRecords(['1', '2']), db)).toMatchObject({ unchanged: 2, create: [], update: [] })
  })
})

describe('NFT collections', () => {
  const addr = '0x' + 'a'.repeat(40)
  it('parses valid rows and flags bad ones', () => {
    const g = gviz([{ label: 'Chain' }, { label: 'Contract' }, { label: 'Name' }, { label: 'Order' }], [
      ['Ethereum', addr, 'Pizzas', 2],
      ['base', '0x123', 'Bad', null],
      [null, null, null, null],
    ])
    const r = parseNFTContracts(g)
    expect(r.contracts).toEqual([{ chain: 'ethereum', address: addr, name: 'Pizzas', order: 2, description: undefined }])
    expect(r.badRows).toEqual([3])
  })

  it('keys by chain + lowercase address and drops duplicates', () => {
    const { records, duplicates } = nftRecords([
      { chain: 'ethereum', address: addr, name: 'A' },
      { chain: 'ethereum', address: addr.toUpperCase().replace('0X', '0x'), name: 'B' },
    ])
    expect(records).toHaveLength(1)
    expect(duplicates).toEqual([1])
  })
})

describe('manuals index', () => {
  it('parses the index table and keys by normalized title', () => {
    const g = gviz([{}, {}, {}], [['Manual', 'Crew', 'Status'], ['How to Host', 'Ops', 'Done'], ['how to host', 'Ops', 'Draft']])
    const manuals = parseManualsTable(g.table as never, { 'How to Host': 'https://docs.google.com/x' })
    expect(manuals[0]).toMatchObject({ title: 'How to Host', url: 'https://docs.google.com/x', crew: 'Ops', crewId: 'ops', status: 'Done' })
    const { records, duplicates } = manualRecords(manuals)
    // A repeated title is kept (the pages address manuals by position), keyed #2 and counted.
    expect(records.map((r) => r.key)).toEqual(['how to host', 'how to host#2'])
    expect(records.map((r) => [r.value.status, r.value.position])).toEqual([['Done', 0], ['Draft', 1]])
    expect(duplicates).toBe(1)
  })

  it('editor rows keep their stored key while the title matches; new and renamed rows get a free one', () => {
    expect(
      manualRowKeys([
        { key: 'how to host', title: 'How to Host' },
        { key: 'how to host#2', title: 'how to host' },
        { title: 'How to host' },
        { key: 'old name', title: 'New Name' },
        { title: 'Other' },
      ]),
    ).toEqual(['how to host', 'how to host#2', 'how to host#3', 'new name', 'other'])
    // Two listed rows with the same title are not a duplicate in the editor.
    expect(cleanRows(manualsEditor, [{ key: 'a', title: 'A' }, { key: 'a#2', title: 'A' }, { title: 'A' }])).toHaveLength(3)
  })
})

describe('editors validate rows', () => {
  it('rejects bad ids, addresses, links and duplicates with the row number', () => {
    expect(() => cleanRows(poapEditor, [{ eventId: 'abc' }])).toThrow(/Row 1/)
    expect(() => cleanRows(poapEditor, [{ eventId: '5' }, { eventId: '5' }])).toThrow(/Row 2: duplicate/)
    expect(cleanRows(poapEditor, [{ eventId: ' 7 ' }])).toEqual([{ eventId: '7' }])
    expect(() => cleanRows(nftEditor, [{ chain: 'ethereum', address: '0x1' }])).toThrow(EditorError)
    expect(cleanRows(nftEditor, [{ chain: 'Base', address: '0x' + 'b'.repeat(40), sortOrder: '3' }])[0]).toMatchObject({ chain: 'base', sortOrder: 3 })
    expect(() => cleanRows(manualsEditor, [{ title: 'X', url: 'javascript:alert(1)' }])).toThrow(/link/)
    expect(() => cleanRows(manualsEditor, 'nope')).toThrow(EditorError)
  })
})
