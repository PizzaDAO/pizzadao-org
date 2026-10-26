/**
 * Does a member hold a Rare Pizza Box NFT? Used by the L5.3 "Own a Rare Pizza
 * Box" mission verifier (rare_pizza_box in mission-verify/verifiers.ts).
 *
 * Reuses the existing NFT stack: the "Rare Pizza Box" contract from the same
 * contracts sheet the NFT page and mafia points use, the member's wallets
 * (MemberWallet, then the members sheet), Alchemy. Strict mode: a failed lookup
 * is 'error', never "owns none".
 *
 * Cost controls: a hit is cached for an hour, a miss for 2 minutes (so buying a
 * box shows up on the next check), an error for 60 seconds (so an outage does
 * not hammer Alchemy). Each Alchemy call asks for one token and stops there.
 * Strictly read-only toward the database (no wallet caching).
 */

import { cacheGet, cacheSet } from '../api/lib/cache'
import { getNFTContracts } from './nft-config'
import { holdsNFTOfContract, UnsupportedChainError } from './nft'
import { getEvmWalletsReadOnly } from './wallet-lookup'
import { MAFIA_POINT_SOURCES } from './mafia-points/config'

/** Fallback where the site lists the NFT collections (the overview prefers the purchase link). */
export const PIZZA_BOX_LINK = '/nfts'

/** The collection's name in the NFT contracts sheet (same entry mafia points scores). */
export const RARE_PIZZA_BOX_CONTRACT_NAME =
  MAFIA_POINT_SOURCES.find((s) => s.id === 'rare-pizza-box')?.contractName ?? 'Rare Pizza Box'

/** 'yes' / 'no' are answers; 'error' means we could not find out (never treated as 'no'). */
export type Lookup = 'yes' | 'no' | 'error'

export const BOX_TTL_SECONDS = { yes: 60 * 60, no: 2 * 60, error: 60 } as const

/**
 * Does this member hold a Rare Pizza Box on any of their EVM wallets? Never
 * throws. `cache: false` (the read-only report script) neither reads nor
 * writes the cache.
 */
export async function checkRarePizzaBox(memberId: string, opts: { cache?: boolean } = {}): Promise<Lookup> {
  const useCache = opts.cache !== false
  const key = `pizzabox:${memberId}`
  const remember = async (v: Lookup): Promise<Lookup> => {
    if (useCache) await cacheSet(key, v, BOX_TTL_SECONDS[v])
    return v
  }
  try {
    if (useCache) {
      const cached = await cacheGet<Lookup>(key)
      if (cached === 'yes' || cached === 'no' || cached === 'error') return cached
    }

    const wallets = await getEvmWalletsReadOnly(memberId)
    if (wallets.length === 0) return remember('no')

    const needle = RARE_PIZZA_BOX_CONTRACT_NAME.toLowerCase()
    const contracts = (await getNFTContracts()).filter((c) => c.name.toLowerCase().includes(needle))
    // The contract list comes from a sheet that swallows its own errors; none
    // means we cannot tell, so fail safe.
    if (contracts.length === 0) return remember('error')

    let succeeded = 0
    for (const contract of contracts) {
      for (const wallet of wallets) {
        try {
          if (await holdsNFTOfContract(wallet, contract)) return remember('yes')
          succeeded++
        } catch (e) {
          if (e instanceof UnsupportedChainError) {
            // A contract on a chain we have no endpoint for must not fail every lookup.
            console.warn(`[rare-pizza-box] skipping ${contract.name} on unsupported chain ${contract.chain}`)
            break
          }
          // A failed lookup (Alchemy down, bad response): try the others; error only if all fail.
        }
      }
    }
    // Error only when nothing could be checked at all; "no" needs at least one real answer.
    return remember(succeeded === 0 ? 'error' : 'no')
  } catch {
    return 'error'
  }
}
