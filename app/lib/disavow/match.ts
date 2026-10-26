/**
 * Matching people to disavowals, in every direction:
 *  - identifiersForMember / viewerIdentifiers: everything we know that
 *    identifies a person (member id, Discord id, wallets, X handle);
 *  - resolveSubjectIdentifiers: at nomination time, expand whatever the
 *    nominator typed (a wallet, an X handle, a Discord id) to the member behind
 *    it, so the entry also carries their MEMBER_ID and DISCORD_ID;
 *  - discordIdsForIdentifiers: the Discord accounts behind an entry (for the
 *    vote tally and notifications);
 *  - findActiveListingFor: the LISTED entry for a profile.
 * Matching never uses a name (collisions). No access checks here.
 * Telegram handles can't be resolved (we store none), so they match only
 * themselves.
 */
import { prisma } from '@/app/lib/db'
import { fetchMemberById, fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { getAllWalletsForMember } from '@/app/lib/wallet-lookup'
import { normalizeWallet, normalizeXHandle, type IdentifierInput } from './identity'

function add(out: IdentifierInput[], kind: IdentifierInput['kind'], value: string | null | undefined) {
  if (!value) return
  if (!out.some(o => o.kind === kind && o.value === value)) out.push({ kind, value })
}

export async function identifiersForMember(memberId: string): Promise<IdentifierInput[]> {
  const out: IdentifierInput[] = []
  add(out, 'MEMBER_ID', memberId)
  try {
    const m = await fetchMemberById(memberId)
    if (m?.discordId) add(out, 'DISCORD_ID', String(m.discordId))
  } catch { /* partial match is fine */ }
  try {
    for (const w of await getAllWalletsForMember(memberId)) add(out, 'WALLET', normalizeWallet(w.walletAddress))
  } catch { /* ignore */ }
  try {
    const x = await prisma.xAccount.findFirst({ where: { memberId }, select: { xUsername: true } })
    if (x) add(out, 'X_HANDLE', normalizeXHandle(x.xUsername))
  } catch { /* ignore */ }
  return out
}

/** Everything that identifies this Discord user, including wallets and X handle. */
export async function viewerIdentifiers(discordId: string): Promise<IdentifierInput[]> {
  const out: IdentifierInput[] = []
  add(out, 'DISCORD_ID', discordId)
  let memberId: string | null = null
  try { memberId = await fetchMemberIdByDiscordId(discordId) } catch { /* ignore */ }
  if (memberId) for (const i of await identifiersForMember(memberId)) add(out, i.kind, i.value)
  try {
    const x = await prisma.xAccount.findUnique({ where: { discordId }, select: { xUsername: true } })
    if (x) add(out, 'X_HANDLE', normalizeXHandle(x.xUsername))
  } catch { /* ignore */ }
  try {
    for (const w of await prisma.memberWallet.findMany({ where: { discordId }, select: { walletAddress: true } })) {
      add(out, 'WALLET', normalizeWallet(w.walletAddress))
    }
  } catch { /* ignore */ }
  return out
}

/**
 * Expand typed identifiers to the member (and handles) behind them. Always
 * returns at least the input; looks wallets and X handles up in our own tables.
 */
export async function resolveSubjectIdentifiers(input: readonly IdentifierInput[]): Promise<IdentifierInput[]> {
  const out: IdentifierInput[] = []
  for (const i of input) add(out, i.kind, i.value)
  const memberIds = new Set<string>()
  for (const i of input) {
    try {
      if (i.kind === 'MEMBER_ID') memberIds.add(i.value)
      else if (i.kind === 'DISCORD_ID') {
        const id = await fetchMemberIdByDiscordId(i.value)
        if (id) memberIds.add(id)
      } else if (i.kind === 'WALLET') {
        const rows = await prisma.memberWallet.findMany({
          where: { walletAddress: { equals: i.value, mode: 'insensitive' } },
          select: { memberId: true, discordId: true },
        })
        for (const r of rows) {
          if (r.memberId) memberIds.add(r.memberId)
          add(out, 'DISCORD_ID', r.discordId)
        }
      } else if (i.kind === 'X_HANDLE') {
        const rows = await prisma.xAccount.findMany({
          where: { xUsername: { equals: i.value, mode: 'insensitive' } },
          select: { memberId: true, discordId: true },
        })
        for (const r of rows) {
          if (r.memberId) memberIds.add(r.memberId)
          add(out, 'DISCORD_ID', r.discordId)
          if (!r.memberId && r.discordId) {
            const id = await fetchMemberIdByDiscordId(r.discordId)
            if (id) memberIds.add(id)
          }
        }
      }
    } catch { /* best effort */ }
  }
  for (const id of memberIds) for (const e of await identifiersForMember(id)) add(out, e.kind, e.value)
  return out
}

/** Discord accounts behind an entry's identifiers. */
export async function discordIdsForIdentifiers(identifiers: ReadonlyArray<{ kind: string; value: string }>): Promise<string[]> {
  const typed = identifiers.filter(i => ['MEMBER_ID', 'DISCORD_ID', 'WALLET', 'X_HANDLE'].includes(i.kind)) as IdentifierInput[]
  const expanded = await resolveSubjectIdentifiers(typed)
  const ids = new Set<string>()
  for (const i of expanded) if (i.kind === 'DISCORD_ID') ids.add(i.value)
  return [...ids]
}

export async function findActiveListingFor(memberId: string): Promise<{ id: string } | null> {
  const ids = await identifiersForMember(memberId)
  const hit = await prisma.disavowIdentifier.findFirst({
    where: { OR: ids.map(i => ({ kind: i.kind, value: i.value })), disavowal: { status: 'LISTED' } } as never,
    select: { disavowalId: true },
  })
  return hit ? { id: hit.disavowalId } : null
}

/** Prisma `OR` clause matching any non-name identifier of this Discord user. */
export function identifierOr(ids: readonly IdentifierInput[]) {
  return ids.filter(i => i.kind !== 'NAME' && i.kind !== 'TELEGRAM').map(i => ({ kind: i.kind, value: i.value }))
}
