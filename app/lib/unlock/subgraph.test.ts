// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildKeysQuery, buildLocksQuery, fetchKeys, fetchLocksByTerms, querySubgraph, SUBGRAPHS } from './subgraph'

const A = '0x' + 'a'.repeat(40)
const L = '0x' + 'b'.repeat(40)

const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 })

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('endpoints', () => {
  it('uses the hosted subgraph per chain', () => {
    expect(SUBGRAPHS[8453]).toBe('https://subgraph.unlock-protocol.com/8453')
    expect(SUBGRAPHS[100]).toBe('https://subgraph.unlock-protocol.com/100')
    expect(Object.keys(SUBGRAPHS).map(Number).sort((a, b) => a - b)).toEqual([1, 10, 56, 100, 137, 8453, 42161])
  })
})

describe('query building', () => {
  it('keys query lowercases owners and locks and pages by id', () => {
    const q = buildKeysQuery(['0x' + 'A'.repeat(40)], [L], '0xabc', 500)
    expect(q).toContain('first: 500')
    expect(q).toContain(`owner_in: ["${A}"]`)
    expect(q).toContain(`lock_in: ["${L}"]`)
    expect(q).toContain('id_gt: "0xabc"')
  })

  it('locks query puts the cursor inside every OR branch (the subgraph rejects a sibling filter)', () => {
    const q = buildLocksQuery(['pizza', 'bitcoin pizza day'], 'x')
    expect(q).toContain('{ id_gt: "x", name_contains_nocase: "pizza" }')
    expect(q).toContain('{ id_gt: "x", name_contains_nocase: "bitcoin pizza day" }')
    expect(q).not.toMatch(/where: \{ id_gt/)
  })

  it('escapes quotes in terms', () => {
    expect(buildLocksQuery(['a"b'], '')).toContain('"a\\"b"')
  })
})

describe('fetchKeys', () => {
  it('sends a User-Agent and pages until a short page', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `k${String(i).padStart(4, '0')}`, owner: A, tokenId: String(i), expiration: '0', cancelled: false, lock: { id: L } }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ keys: full }))
      .mockResolvedValueOnce(ok({ keys: [{ ...full[0], id: 'z', tokenId: '5000' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const keys = await fetchKeys(8453, [A], [L])
    expect(keys).toHaveLength(1001)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://subgraph.unlock-protocol.com/8453')
    expect(init.headers['User-Agent']).toBeTruthy()
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).query).toContain('id_gt: "k0999"')
  })

  it('chunks owners and locks into separate queries', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ok({ keys: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const owners = Array.from({ length: 51 }, (_, i) => '0x' + i.toString(16).padStart(40, '0'))
    const locks = Array.from({ length: 201 }, (_, i) => '0x' + i.toString(16).padStart(40, '1'))
    await fetchKeys(137, owners, locks)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('throws on an unsupported chain', async () => {
    await expect(fetchKeys(999, [A], [L])).rejects.toThrow(/No Unlock subgraph/)
  })
})

describe('errors throw', () => {
  it('GraphQL errors throw (not an empty result)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: 'deployment does not exist' }] }), { status: 200 })))
    const p = querySubgraph('https://x', '{}', 1)
    await expect(p).rejects.toThrow(/deployment does not exist/)
  })

  it('HTTP errors throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 403 })))
    await expect(querySubgraph('https://x', '{}', 1)).rejects.toThrow(/HTTP 403/)
  })

  it('network failures throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    await expect(querySubgraph('https://x', '{}', 1)).rejects.toThrow('boom')
  })
})

describe('fetchLocksByTerms', () => {
  it('returns nothing without terms and pages by address', async () => {
    expect(await fetchLocksByTerms(8453, [])).toEqual([])
    const page = Array.from({ length: 1000 }, (_, i) => ({ address: '0x' + i.toString(16).padStart(40, '0'), name: 'Pizza', lastKeyMintedAt: null }))
    const fetchMock = vi.fn().mockResolvedValueOnce(ok({ locks: page })).mockResolvedValueOnce(ok({ locks: [] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchLocksByTerms(8453, ['pizza'])).toHaveLength(1000)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).query).toContain(`id_gt: "${page[999].address}"`)
  })
})
