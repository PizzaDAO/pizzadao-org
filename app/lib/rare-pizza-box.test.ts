import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/lib/cache', () => ({ cacheGet: vi.fn(), cacheSet: vi.fn(), cacheDel: vi.fn() }))
vi.mock('./nft-config', () => ({ getNFTContracts: vi.fn(), ALCHEMY_CHAIN_URLS: {} }))
vi.mock('./wallet-lookup', () => ({ getEvmWalletsReadOnly: vi.fn() }))
vi.mock('./nft', () => {
  class UnsupportedChainError extends Error {}
  return { holdsNFTOfContract: vi.fn(), UnsupportedChainError }
})

import { checkRarePizzaBox, BOX_TTL_SECONDS } from './rare-pizza-box'
import { cacheGet, cacheSet } from '../api/lib/cache'
import { getNFTContracts } from './nft-config'
import { getEvmWalletsReadOnly } from './wallet-lookup'
import { holdsNFTOfContract, UnsupportedChainError } from './nft'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const base = { name: 'Rare Pizza Box', address: '0x1', chain: 'base' }

beforeEach(() => {
  vi.clearAllMocks()
  m(cacheGet).mockResolvedValue(null)
  m(getEvmWalletsReadOnly).mockResolvedValue(['0xa'])
  m(getNFTContracts).mockResolvedValue([base])
  m(holdsNFTOfContract).mockResolvedValue(true)
})

describe('checkRarePizzaBox', () => {
  it('yes: caches a hit for an hour', async () => {
    expect(await checkRarePizzaBox('m1')).toBe('yes')
    expect(cacheSet).toHaveBeenCalledWith('pizzabox:m1', 'yes', BOX_TTL_SECONDS.yes)
  })

  it('no: caches a miss briefly; no wallets is also "no" without an Alchemy call', async () => {
    m(holdsNFTOfContract).mockResolvedValue(false)
    expect(await checkRarePizzaBox('m1')).toBe('no')
    expect(cacheSet).toHaveBeenCalledWith('pizzabox:m1', 'no', BOX_TTL_SECONDS.no)
    m(getEvmWalletsReadOnly).mockResolvedValue([])
    m(holdsNFTOfContract).mockClear()
    expect(await checkRarePizzaBox('m2')).toBe('no')
    expect(holdsNFTOfContract).not.toHaveBeenCalled()
  })

  it('error (Alchemy down) is "error", cached only for a short time so outages do not hammer Alchemy', async () => {
    m(holdsNFTOfContract).mockRejectedValue(new Error('down'))
    expect(await checkRarePizzaBox('m1')).toBe('error')
    expect(cacheSet).toHaveBeenCalledWith('pizzabox:m1', 'error', BOX_TTL_SECONDS.error)
    expect(BOX_TTL_SECONDS.error).toBeLessThanOrEqual(60)
  })

  it('serves answers from the cache without any lookup', async () => {
    m(cacheGet).mockResolvedValue('error')
    expect(await checkRarePizzaBox('m1')).toBe('error')
    expect(getEvmWalletsReadOnly).not.toHaveBeenCalled()
  })

  it('no contract configured, or a wallet read failure, is "error" not "no"', async () => {
    m(getNFTContracts).mockResolvedValue([])
    expect(await checkRarePizzaBox('m1')).toBe('error')
    m(getEvmWalletsReadOnly).mockRejectedValue(new Error('sheet'))
    expect(await checkRarePizzaBox('m3')).toBe('error')
  })

  it('skips a contract on an unsupported chain; a working one still answers', async () => {
    m(getNFTContracts).mockResolvedValue([{ ...base, chain: 'solana' }, base])
    m(holdsNFTOfContract).mockImplementation(async (_w: string, c: { chain: string }) => {
      if (c.chain === 'solana') throw new UnsupportedChainError('solana')
      return false
    })
    expect(await checkRarePizzaBox('m1')).toBe('no')
  })

  it('error only when every contract fails (all unsupported or all erroring)', async () => {
    m(getNFTContracts).mockResolvedValue([{ ...base, chain: 'solana' }])
    m(holdsNFTOfContract).mockRejectedValue(new UnsupportedChainError('solana'))
    expect(await checkRarePizzaBox('m1')).toBe('error')
  })

  it('cache: false (the report script) neither reads nor writes the cache', async () => {
    expect(await checkRarePizzaBox('m1', { cache: false })).toBe('yes')
    expect(cacheGet).not.toHaveBeenCalled()
    expect(cacheSet).not.toHaveBeenCalled()
  })
})
