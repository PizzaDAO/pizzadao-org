// nft.ts strict mode: holdsNFTOfContract never turns an error into "owns none".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const contract = { name: 'Rare Pizza Box', address: '0x' + '1'.repeat(40), chain: 'base' }

async function load(apiKey: string | undefined) {
  vi.resetModules()
  vi.doMock('../api/lib/cache', () => ({ cacheGetOrSet: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheDel: vi.fn() }))
  vi.doMock('./nft-config', () => ({
    ALCHEMY_CHAIN_URLS: { base: 'https://base.example/nft/v3' },
    getContractsByChain: vi.fn(),
  }))
  if (apiKey === undefined) delete process.env.ALCHEMY_API_KEY
  else process.env.ALCHEMY_API_KEY = apiKey
  return import('./nft')
}

describe('holdsNFTOfContract (strict)', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.ALCHEMY_API_KEY
  })

  it('true when a token is owned, false when none, asking for one token only', async () => {
    const { holdsNFTOfContract } = await load('key')
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ownedNfts: [{}] }) })
    expect(await holdsNFTOfContract('0xabc', contract)).toBe(true)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('pageSize=1')
    expect(url).toContain('withMetadata=false')
    expect(url).toContain(`contractAddresses[]=${contract.address}`)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ownedNfts: [] }) })
    expect(await holdsNFTOfContract('0xabc', contract)).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2) // no paging
  })

  it('throws (never false) without an API key', async () => {
    const { holdsNFTOfContract } = await load(undefined)
    await expect(holdsNFTOfContract('0xabc', contract)).rejects.toThrow(/ALCHEMY_API_KEY/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws on a non-OK response, a network error and a malformed body', async () => {
    const { holdsNFTOfContract } = await load('key')
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
    await expect(holdsNFTOfContract('0xabc', contract)).rejects.toThrow(/429/)
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await expect(holdsNFTOfContract('0xabc', contract)).rejects.toThrow(/network down/)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ error: 'x' }) })
    await expect(holdsNFTOfContract('0xabc', contract)).rejects.toThrow(/Unexpected/)
  })

  it('an unsupported chain is its own error type (skippable), with no request', async () => {
    const { holdsNFTOfContract, UnsupportedChainError } = await load('key')
    await expect(holdsNFTOfContract('0xabc', { ...contract, chain: 'solana' })).rejects.toBeInstanceOf(UnsupportedChainError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
