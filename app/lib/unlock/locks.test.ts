// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMany = vi.fn(async (a: { data: unknown[] }) => ({ count: a.data.length }))
const findMany = vi.fn(async () => [] as Array<{ address: string }>)
vi.mock('@/app/lib/db', () => ({ prisma: { unlockLock: { createMany: (a: never) => createMany(a), findMany: () => findMany() } } }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(async () => 'pizza\nPizzaDAO\n\n pizza ') }))
const fetchLocksByTerms = vi.fn()
vi.mock('./subgraph', async (orig) => ({ ...(await orig<typeof import('./subgraph')>()), fetchLocksByTerms: (...a: unknown[]) => fetchLocksByTerms(...a) }))

import { discoverLocks, discoveredRows, guessYear, matchesTerms, parseTerms, seedRows } from './locks'

const addr = (n: number) => '0x' + n.toString(16).padStart(40, '0')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('terms', () => {
  it('parses one per line, lowercased and deduped', () => {
    expect(parseTerms('Pizza\n pizzadao \n\npizza')).toEqual(['pizza', 'pizzadao'])
  })
  it('matches case-insensitively on any term', () => {
    const terms = ['pizza', 'bitcoin pizza day']
    expect(matchesTerms('Global PIZZA Party Lima', terms)).toBe(true)
    expect(matchesTerms('MCON III', terms)).toBe(false)
    expect(matchesTerms('anything', [])).toBe(false)
  })
})

describe('guessYear', () => {
  it('prefers a year in the name, then the last mint, else null', () => {
    expect(guessYear('Pizza Day 2024 NYC', '1747812743')).toBe(2024)
    expect(guessYear('Pizza Day', '1747812743')).toBe(2025)
    expect(guessYear('Pizza Day', null)).toBeNull()
  })
})

describe('seedRows', () => {
  it('lowercases addresses, takes the year from the start date, drops bad rows', () => {
    const rows = seedRows([
      { address: '0x' + 'A'.repeat(40), network_id: 8453, event_name: ' GPP Test ', event_slug: 'gpp-test', event_start_date: '2025-05-22' },
      { address: 'nope', network_id: 8453, event_name: 'bad' },
      { address: addr(2), network_id: 999, event_name: 'bad chain' },
    ])
    expect(rows).toEqual([
      { networkId: 8453, address: '0x' + 'a'.repeat(40), name: 'GPP Test', year: 2025, eventSlug: 'gpp-test', enabled: true, source: 'seed' },
    ])
  })
})

describe('discoveredRows', () => {
  it('keeps matching locks once, enabled, source discovered', () => {
    const rows = discoveredRows(
      137,
      [
        { address: addr(1), name: 'Pizza + Beer', lastKeyMintedAt: '1747812743' },
        { address: addr(1).toUpperCase().replace('0X', '0x'), name: 'Pizza + Beer', lastKeyMintedAt: null },
        { address: addr(2), name: 'Unrelated', lastKeyMintedAt: null },
        { address: 'bad', name: 'Pizza bad', lastKeyMintedAt: null },
      ],
      ['pizza'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ networkId: 137, address: addr(1), enabled: true, source: 'discovered', year: 2025 })
  })
})

describe('discoverLocks', () => {
  it('adds with skipDuplicates (never touches existing rows) and reports per chain', async () => {
    fetchLocksByTerms.mockImplementation(async (id: number) => (id === 8453 ? [{ address: addr(1), name: 'Pizza Bazaar', lastKeyMintedAt: null }] : []))
    const res = await discoverLocks({ chains: [8453, 137] })
    expect(res).toEqual([
      { networkId: 8453, chain: 'Base', found: 1, added: 1 },
      { networkId: 137, chain: 'Polygon', found: 0, added: 0 },
    ])
    expect(createMany).toHaveBeenCalledTimes(1)
    expect(createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true })
  })

  it('uses the setting terms when none given and isolates a failing chain', async () => {
    fetchLocksByTerms.mockImplementation(async (id: number) => {
      if (id === 10) throw new Error('down')
      return []
    })
    const res = await discoverLocks({ chains: [10, 1] })
    expect(fetchLocksByTerms.mock.calls[0][1]).toEqual(['pizza', 'pizzadao'])
    expect(res[0].error).toBe('down')
    expect(res[1].error).toBeUndefined()
  })

  it('dry run writes nothing', async () => {
    fetchLocksByTerms.mockResolvedValue([{ address: addr(1), name: 'Pizza', lastKeyMintedAt: null }])
    findMany.mockResolvedValue([])
    const res = await discoverLocks({ chains: [8453], dryRun: true })
    expect(res[0]).toMatchObject({ found: 1, added: 1 })
    expect(createMany).not.toHaveBeenCalled()
  })
})
