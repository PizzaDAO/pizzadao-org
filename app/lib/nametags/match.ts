/**
 * Identifier -> member for event name tags. Only identifiers a member proved match: the hash of a VERIFIED
 * profile email, the hash of the email they proved on rsv.pizza (account link), and (when the setting
 * allows) a linked EVM wallet. Unverified emails never match. Hashes are sha256 of the lower-cased,
 * trimmed address, hex (same contract as the events-attended lookup).
 */
import { prisma } from '@/app/lib/db'

export interface IdentifierMatch {
  memberId: string
  /** Which identifier matched, echoed back so the caller can pair a guest with a tag. */
  emailHash?: string
  wallet?: string
}

export const HEX64 = /^[0-9a-f]{64}$/
export const EVM_WALLET = /^0x[0-9a-fA-F]{40}$/

type Db = Pick<typeof prisma, '$queryRaw' | 'memberProfileExtras'>

export async function matchIdentifiers(
  input: { emailHashes: string[]; wallets: string[] },
  opts: { matchWallets: boolean },
  db: Db = prisma,
): Promise<IdentifierMatch[]> {
  const hashes = [...new Set(input.emailHashes.map((h) => h.toLowerCase()))]
  const wallets = opts.matchWallets ? [...new Set(input.wallets.map((w) => w.toLowerCase()))] : []
  const out: IdentifierMatch[] = []

  if (hashes.length) {
    const [linked, verified] = await Promise.all([
      db.memberProfileExtras.findMany({
        where: { rsvLinkedEmailHash: { in: hashes } },
        select: { memberId: true, rsvLinkedEmailHash: true },
      }),
      // The hash is computed in SQL over verified rows only, so an unverified address can never match.
      db.$queryRaw<{ memberId: string; hash: string }[]>`
        select "memberId", encode(sha256(convert_to(lower(btrim("email")), 'UTF8')), 'hex') as hash
        from "MemberProfileExtras"
        where "emailVerifiedAt" is not null and "email" is not null
          and encode(sha256(convert_to(lower(btrim("email")), 'UTF8')), 'hex') = any(${hashes}::text[])`,
    ])
    for (const r of linked) if (r.rsvLinkedEmailHash) out.push({ memberId: r.memberId, emailHash: r.rsvLinkedEmailHash.toLowerCase() })
    for (const r of verified) out.push({ memberId: r.memberId, emailHash: r.hash })
  }

  if (wallets.length) {
    const rows = await db.$queryRaw<{ memberId: string; wallet: string }[]>`
      select "memberId", lower("walletAddress") as wallet
      from "MemberWallet"
      where "chainType" = 'evm' and lower("walletAddress") = any(${wallets}::text[])`
    for (const r of rows) out.push({ memberId: r.memberId, wallet: r.wallet })
  }

  // One entry per (member, identifier).
  const seen = new Set<string>()
  return out.filter((m) => {
    const k = `${m.memberId}|${m.emailHash ?? ''}|${m.wallet ?? ''}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
