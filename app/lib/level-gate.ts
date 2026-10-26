/**
 * The level gates (Community Call, 2026-10-26):
 *  - reaching level 4 needs at least one vouch RECEIVED from another member;
 *  - reaching level 5 needs a Rare Pizza Box NFT.
 * On top of completing every mission of the levels below, in order. Everything
 * about the two rules that is not pure lives here; the pure part
 * (applyLevelGate) is used by the one level computation in missions.ts.
 *
 * Box holdings use the existing NFT stack (the "Rare Pizza Box" contract from
 * the same sheet the NFT page and mafia points use, wallets from MemberWallet /
 * the members sheet, Alchemy), in strict mode so an Alchemy failure is an
 * 'error', never "owns none". Results are cached: a hit for an hour, a miss
 * for 5 minutes (so buying a box shows up quickly), an error not at all.
 * Vouches are read from the Vouch table (PizzaDAO-native only, no self-vouches,
 * the same defaults as the vouch_given verifier).
 */

import { cacheDel, cacheGet, cacheSet } from '../api/lib/cache'
import { prisma } from './db'
import { getNFTContracts } from './nft-config'
import { holdsNFTOfContract } from './nft'
import { fetchMemberIdByDiscordId } from './sheets/member-repository'
import { getEvmWalletsForMember, getWalletForMember } from './wallet-lookup'
import { MAFIA_POINT_SOURCES } from './mafia-points/config'

/** Reaching this level needs a vouch received. */
export const VOUCH_MIN_LEVEL = 4
/** Reaching this level needs a Rare Pizza Box. */
export const BOX_MIN_LEVEL = 5

/** Fallback where the site lists the NFT collections (the overview prefers the purchase link). */
export const PIZZA_BOX_LINK = '/nfts'

/** The collection's name in the NFT contracts sheet (same entry mafia points scores). */
export const RARE_PIZZA_BOX_CONTRACT_NAME =
  MAFIA_POINT_SOURCES.find((s) => s.id === 'rare-pizza-box')?.contractName ?? 'Rare Pizza Box'

/**
 * TODO(Snax): members who reached a gated level BEFORE this instant keep it
 * without meeting the requirement (grandfathered, see missions.ts
 * highestLevelPaidBefore). The gates only apply to level-ups after it. Move
 * the date (or set LEVEL_GATE_START) to the real deploy time, or drop
 * grandfathering once you decide what to do with existing members who lack a
 * vouch / box (scripts/missions/level-gate-report.mjs counts them).
 */
export const DEFAULT_LEVEL_GATE_START = '2026-10-27T00:00:00.000Z'

export function levelGateStart(): Date {
  const raw = process.env.LEVEL_GATE_START
  const d = new Date(raw || DEFAULT_LEVEL_GATE_START)
  return Number.isNaN(d.getTime()) ? new Date(DEFAULT_LEVEL_GATE_START) : d
}

/** 'yes' / 'no' are answers; 'error' means we could not find out (never treated as 'yes'). */
export type Lookup = 'yes' | 'no' | 'error'

/**
 * One requirement's standing:
 *  - not_needed: the member's missions are below the gated level (not looked up);
 *  - ok: met; grandfathered: not met but allowed (reached the level before the gate);
 *  - missing: not met; unknown: the lookup failed (the level is held back, show a retry).
 */
export type ReqState = 'not_needed' | 'ok' | 'grandfathered' | 'missing' | 'unknown'

export type LevelGate = { vouch: ReqState; box: ReqState }

const passes = (s: ReqState) => s !== 'missing' && s !== 'unknown'

/** One requirement's state from a lookup (null = not looked up). */
export function reqState(lookup: Lookup | null, grandfathered: boolean): ReqState {
  if (lookup === null) return grandfathered ? 'grandfathered' : 'not_needed'
  if (lookup === 'yes') return 'ok'
  if (grandfathered) return 'grandfathered'
  return lookup === 'error' ? 'unknown' : 'missing'
}

/**
 * Pure gate: the level a member is allowed to hold. Without a vouch received
 * they stay at level 3; without a Rare Pizza Box they stay at level 4.
 */
export function applyLevelGate(earnedLevel: number, gate: LevelGate): number {
  if (earnedLevel >= VOUCH_MIN_LEVEL && !passes(gate.vouch)) return VOUCH_MIN_LEVEL - 1
  if (earnedLevel >= BOX_MIN_LEVEL && !passes(gate.box)) return BOX_MIN_LEVEL - 1
  return earnedLevel
}

/**
 * Has this member received a vouch from another member? Never throws: a
 * failure is 'error'. PizzaDAO-native vouches only (imported Twitter /
 * Farcaster follows don't count, like vouch_given), and never self-vouches.
 */
export async function checkVouchReceived(discordId: string): Promise<Lookup> {
  try {
    const memberId = await fetchMemberIdByDiscordId(discordId)
    if (!memberId) return 'no'
    const n = await prisma.vouch.count({
      where: { followeeId: memberId, followerId: { not: memberId }, source: 'PIZZADAO' },
    })
    return n > 0 ? 'yes' : 'no'
  } catch {
    return 'error'
  }
}

/**
 * Does this member hold a Rare Pizza Box on any of their EVM wallets?
 * Never throws: any failure is 'error'.
 */
export async function checkRarePizzaBox(discordId: string): Promise<Lookup> {
  const key = `pizzabox:${discordId}`
  try {
    const cached = await cacheGet<Lookup>(key)
    if (cached === 'yes' || cached === 'no') return cached

    const memberId = await fetchMemberIdByDiscordId(discordId)
    // No member row at all: nothing to check, they cannot hold one (not a failure).
    if (!memberId) return 'no'

    await getWalletForMember(memberId) // caches a sheet-only wallet into the DB
    const wallets = await getEvmWalletsForMember(memberId)
    if (wallets.length === 0) {
      await cacheSet(key, 'no', 5 * 60)
      return 'no'
    }

    const needle = RARE_PIZZA_BOX_CONTRACT_NAME.toLowerCase()
    const contracts = (await getNFTContracts()).filter((c) => c.name.toLowerCase().includes(needle))
    // The contract list comes from a sheet that swallows its own errors; no
    // contract means we cannot tell, so fail safe.
    if (contracts.length === 0) return 'error'

    for (const wallet of wallets) {
      for (const contract of contracts) {
        if (await holdsNFTOfContract(wallet, contract)) {
          await cacheSet(key, 'yes', 60 * 60)
          return 'yes'
        }
      }
    }
    await cacheSet(key, 'no', 5 * 60)
    return 'no'
  } catch {
    return 'error'
  }
}

/** Forget a cached answer (the "I got one, check again" retry). */
export async function clearPizzaBoxCache(discordId: string): Promise<void> {
  await cacheDel(`pizzabox:${discordId}`)
}
