// fetchPizzaDAONFTs flags partial results (a non-OK Alchemy response) and never caches them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const cacheGet = vi.fn()
const cacheSet = vi.fn()

async function load() {
  vi.resetModules()
  vi.doMock('../api/lib/cache', () => ({ cacheGet, cacheSet, cacheGetOrSet: vi.fn(), cacheDel: vi.fn() }))
  vi.doMock('./nft-config', () => ({
    ALCHEMY_CHAIN_URLS: { base: 'https://base.example/nft/v3' },
    getContractsByChain: vi.fn(async () => ({
      base: [{ name: 'Box', address: '0x' + '1'.repeat(40), chain: 'base' }],
    })),
  }))
  process.env.ALCHEMY_API_KEY = 'key'
  return import('./nft')
}

const WALLET = '0x' + 'a'.repeat(40)

describe('fetchPizzaDAONFTs completeness', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    cacheGet.mockResolvedValue(null)
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.ALCHEMY_API_KEY
  })

  it('marks a non-OK response incomplete and does not cache it', async () => {
    const { fetchPizzaDAONFTs } = await load()
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    const r = await fetchPizzaDAONFTs(WALLET)
    expect(r.incomplete).toBe(true)
    expect(cacheSet).not.toHaveBeenCalled()
  })

  it('marks a thrown fetch incomplete', async () => {
    const { fetchPizzaDAONFTs } = await load()
    fetchMock.mockRejectedValue(new Error('network'))
    expect((await fetchPizzaDAONFTs(WALLET)).incomplete).toBe(true)
  })

  it('a clean response is complete and cached', async () => {
    const { fetchPizzaDAONFTs } = await load()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ownedNfts: [{ tokenId: '1', contract: { address: '0x' + '1'.repeat(40) } }] }),
    })
    const r = await fetchPizzaDAONFTs(WALLET)
    expect(r.incomplete).toBeUndefined()
    expect(r.totalCount).toBe(1)
    expect(cacheSet).toHaveBeenCalledTimes(1)
  })
})
